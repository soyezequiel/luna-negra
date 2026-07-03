import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  createDescriptionHashInvoiceMsat,
  lightningConfigured,
} from "@/lib/lightning";
import {
  siteUrl,
  treasuryLightningAddress,
  treasuryLnurlUrl,
} from "@/lib/site-url";
import { getTreasurySettings } from "@/lib/treasury-settings";
import { notifyOperationalError } from "@/lib/discord";

// LNURL-pay de DEPÓSITO LIBRE a la tesorería (tesoreria@<dominio>). A diferencia de
// /.well-known/lnurlp/luna —que solo cobra depósitos de apuestas anclados a un
// contrato y con zap request firmado— este endpoint acepta un pago LNURL-pay normal
// de CUALQUIER monto (entre min y max) y el invoice lo emite el NWC del store, así
// que los sats caen directo a la tesorería. No toca DB ni ledger: es una recarga.
export const dynamic = "force-dynamic";

const LNURL_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};

const lnurlError = (reason: string) =>
  NextResponse.json({ status: "ERROR", reason }, { headers: LNURL_HEADERS });

export async function GET(req: Request) {
  if (!lightningConfigured()) {
    return lnurlError("Lightning no está configurado en el servidor");
  }

  // Límites configurables por el admin (con fallback al entorno).
  const limits = await getTreasurySettings();
  const minSendableMsat = limits.minSats * 1_000;
  const maxSendableMsat = limits.maxSats * 1_000;

  const baseUrl = siteUrl(req);
  const callback = treasuryLnurlUrl(baseUrl);
  const identifier = treasuryLightningAddress(baseUrl);
  // La metadata DEBE ser idéntica entre la respuesta payRequest y el hash que
  // compromete el invoice (LUD-06): el wallet lo verifica.
  const metadata = JSON.stringify([
    ["text/plain", "Depósito a la tesorería de Luna Negra"],
    ...(identifier ? [["text/identifier", identifier]] : []),
  ]);

  const amount = new URL(req.url).searchParams.get("amount");

  // 1ª llamada (sin amount): describimos el LNURL-pay.
  if (amount == null) {
    return NextResponse.json(
      {
        tag: "payRequest",
        callback,
        minSendable: minSendableMsat,
        maxSendable: maxSendableMsat,
        metadata,
      },
      { headers: LNURL_HEADERS },
    );
  }

  // 2ª llamada (con amount en msat): emitimos el invoice por ese monto exacto.
  const amountMsat = Number(amount);
  if (!Number.isInteger(amountMsat) || amountMsat <= 0) {
    return lnurlError("Monto inválido");
  }
  if (amountMsat < minSendableMsat || amountMsat > maxSendableMsat) {
    return lnurlError(
      `El monto debe estar entre ${limits.minSats} y ${limits.maxSats} sats`,
    );
  }

  try {
    const descriptionHash = createHash("sha256").update(metadata).digest("hex");
    const inv = await createDescriptionHashInvoiceMsat(amountMsat, descriptionHash);
    return NextResponse.json(
      { pr: inv.invoice, routes: [] },
      { headers: LNURL_HEADERS },
    );
  } catch (error) {
    await notifyOperationalError({
      source: "lnurl-treasury-invoice",
      error,
      fingerprint: "lnurl-treasury-invoice",
      cooldownMs: 10 * 60_000,
      context: { amountMsat },
    });
    return lnurlError(
      error instanceof Error ? error.message : "No se pudo generar el invoice",
    );
  }
}
