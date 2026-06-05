import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { generateWebhookSecret } from "@/lib/webhooks";

// Configura la URL de webhook del proveedor y (re)genera su secreto de firma.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const provider = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  if (!provider) {
    return NextResponse.json(
      { error: "Creá tu perfil de proveedor primero" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const url = typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";
  if (url && !/^https?:\/\//.test(url)) {
    return NextResponse.json(
      { error: "La URL debe empezar con http(s)://" },
      { status: 400 },
    );
  }

  const data: { webhookUrl: string | null; webhookSecret?: string | null } = {
    webhookUrl: url || null,
  };
  if (!url) {
    data.webhookSecret = null; // sin URL, no hace falta secreto
  } else if (body.regenerate === true || !provider.webhookSecret) {
    data.webhookSecret = generateWebhookSecret();
  }

  const updated = await prisma.provider.update({
    where: { id: provider.id },
    data,
  });
  return NextResponse.json({
    webhookUrl: updated.webhookUrl,
    webhookSecret: updated.webhookSecret,
  });
}
