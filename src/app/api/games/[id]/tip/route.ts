import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { lightningConfigured, requestInvoiceFromAddress } from "@/lib/lightning";
import { resolveTipDestination } from "@/lib/tip-destination";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

// Límites de una propina, en sats. El mínimo evita invoices de polvo; el máximo
// es un guard de cordura (una propina no es una compra).
const MIN_TIP_SATS = 1;
const MAX_TIP_SATS = 1_000_000;

/**
 * Crea un invoice para dejarle una propina al desarrollador de un juego. El
 * invoice lo emite DIRECTAMENTE el wallet del proveedor (cascada en
 * resolveTipDestination), así que el 100% va al dev y la tienda nunca custodia el
 * dinero: no hay payout, comisión ni entitlement. El cliente lo paga con su wallet
 * (NWC del navegador, extensión o QR) y la confirmación la da el propio wallet.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const rl = await checkRateLimit(`tip:${clientIp(req)}:${session.sub}`, 15, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const amountSats = Number(body?.amountSats);
  if (!Number.isInteger(amountSats) || amountSats < MIN_TIP_SATS || amountSats > MAX_TIP_SATS) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.status !== "published") {
    return NextResponse.json({ error: "Juego no encontrado" }, { status: 404 });
  }

  // Modo dev (sin wallet de tienda configurado): devolvemos un invoice fake para
  // poder probar la UI sin pedirle un cobro real al proveedor. Mismo convenio que
  // la compra (devMode + "simular pago").
  if (!lightningConfigured()) {
    return NextResponse.json({
      invoice: `lnbc-dev-tip-${randomBytes(12).toString("hex")}`,
      amountSats,
      devMode: true,
    });
  }

  const dest = await resolveTipDestination(game.providerId);
  if (!dest) {
    return NextResponse.json(
      { error: "Este desarrollador todavía no configuró una dirección para recibir propinas." },
      { status: 409 },
    );
  }

  try {
    const invoice = await requestInvoiceFromAddress(
      dest,
      amountSats,
      `Propina · ${game.title} (Luna Negra)`,
    );
    return NextResponse.json({ invoice, amountSats, devMode: false });
  } catch {
    return NextResponse.json(
      { error: "No se pudo generar el invoice de la propina. Probá de nuevo." },
      { status: 502 },
    );
  }
}
