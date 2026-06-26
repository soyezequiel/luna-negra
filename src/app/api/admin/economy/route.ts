import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import {
  economySettingsPayload,
  getEconomySettings,
  updateEconomySettings,
} from "@/lib/economy-settings";

async function requireAdmin() {
  const session = await getSession();
  return session && isAdmin(session.pubkey);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const settings = await getEconomySettings();
  return NextResponse.json({ settings: economySettingsPayload(settings) });
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  try {
    const settings = await updateEconomySettings({
      storeFeePct: body.storeFeePct,
      betFeePct: body.betFeePct,
      betDevFeeMaxPct: body.betDevFeeMaxPct,
    });
    return NextResponse.json({ settings: economySettingsPayload(settings) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Porcentaje invalido" },
      { status: 400 },
    );
  }
}
