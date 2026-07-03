import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import { getWalletBalanceSats, lightningConfigured } from "@/lib/lightning";
import { siteUrl, treasuryLightningAddress } from "@/lib/site-url";
import {
  getTreasurySettings,
  treasurySettingsPayload,
  updateTreasurySettings,
} from "@/lib/treasury-settings";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  return session && isAdmin(session.pubkey);
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const settings = await getTreasurySettings();
  // El saldo es informativo (para explicar la reserva de payouts); si el NWC no
  // responde queda null y la UI lo dice, sin bloquear la edición de límites.
  const balanceSats = await getWalletBalanceSats().catch(() => null);
  return NextResponse.json({
    settings: treasurySettingsPayload(settings),
    balanceSats,
    lightningConfigured: lightningConfigured(),
    address: treasuryLightningAddress(siteUrl(req)),
  });
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const settings = await updateTreasurySettings({
      minSats: body.minSats,
      maxSats: body.maxSats,
    });
    return NextResponse.json({ settings: treasurySettingsPayload(settings) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Límite inválido" },
      { status: 400 },
    );
  }
}
