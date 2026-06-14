import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildWebhookUpdate } from "@/lib/webhooks";

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
  const data = buildWebhookUpdate(body.webhookUrl, {
    regenerate: body.regenerate === true,
    currentSecret: provider.webhookSecret,
  });
  if (!data) {
    return NextResponse.json(
      { error: "URL inválida: usá una URL pública http(s):// (no direcciones internas)" },
      { status: 400 },
    );
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
