import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSession } from "@/lib/auth";
import {
  getPresenceSettings,
  presenceSettingsPayload,
  updatePresenceSettings,
} from "@/lib/presence-settings";

async function requireAdmin() {
  const session = await getSession();
  return session && isAdmin(session.pubkey);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const settings = await getPresenceSettings();
  return NextResponse.json({ settings: presenceSettingsPayload(settings) });
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.clickPresenceEnabled !== "boolean") {
    return NextResponse.json(
      { error: "clickPresenceEnabled debe ser booleano" },
      { status: 400 },
    );
  }
  const settings = await updatePresenceSettings({
    clickPresenceEnabled: body.clickPresenceEnabled,
  });
  return NextResponse.json({ settings: presenceSettingsPayload(settings) });
}
