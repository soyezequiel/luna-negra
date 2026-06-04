import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Formato básico de Lightning Address (lud16): usuario@dominio.tld
const LUD16_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cachea el perfil Nostr (kind:0) del usuario en la DB, para mostrar nombre/avatar
// sin tener que consultar relays en cada render del lado servidor.
// También permite configurar manualmente la Lightning Address (lud16) de cobro.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  // Update parcial: solo tocamos los campos presentes en el body, para que el
  // caché de login (displayName/avatarUrl) no pise un lud16 configurado a mano.
  const data: { displayName?: string | null; avatarUrl?: string | null; lud16?: string | null } = {};

  if ("displayName" in body || "avatarUrl" in body) {
    data.displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim().slice(0, 80)
        : null;
    data.avatarUrl =
      typeof body.avatarUrl === "string" && body.avatarUrl.trim()
        ? body.avatarUrl.trim().slice(0, 500)
        : null;
  }

  if ("lud16" in body) {
    const raw = typeof body.lud16 === "string" ? body.lud16.trim() : "";
    if (raw && !LUD16_RE.test(raw)) {
      return NextResponse.json(
        { error: "Lightning Address inválida. Formato: usuario@dominio.com" },
        { status: 400 },
      );
    }
    data.lud16 = raw ? raw.toLowerCase().slice(0, 255) : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true });
  }

  await prisma.user.update({
    where: { id: session.sub },
    data,
  });
  return NextResponse.json({ ok: true });
}
