import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { generateOracleKey } from "@/lib/oracle-keys";

// El secreto del oráculo nunca sale por la API: solo exponemos su pubkey.
function publicProvider<T extends { oracleSecretEnc?: unknown }>(p: T) {
  const rest = { ...p };
  delete rest.oracleSecretEnc;
  return rest;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const found = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  const provider = found ? publicProvider(found) : null;
  const games = provider
    ? await prisma.game.findMany({
        where: { providerId: provider.id },
        orderBy: { createdAt: "desc" },
      })
    : [];
  return NextResponse.json({ provider, games });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const { name, lightningAddress } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  }

  const existing = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  const data = {
    name: name.trim(),
    lightningAddress:
      typeof lightningAddress === "string" && lightningAddress.trim()
        ? lightningAddress.trim()
        : null,
  };

  // Provisiona la clave del oráculo gestionado al crear el proveedor. Si no hay
  // ORACLE_ENC_KEY (dev) se omite: el proveedor queda sin clave (el camino con
  // API key avisará ORACLE_NOT_PROVISIONED hasta configurarla y backfillear).
  let oracle: { oraclePubkey: string; oracleSecretEnc: string } | null = null;
  if (!existing) {
    try {
      const k = generateOracleKey();
      oracle = { oraclePubkey: k.pubkey, oracleSecretEnc: k.secretEnc };
    } catch {
      oracle = null;
    }
  }

  const provider = existing
    ? await prisma.provider.update({ where: { id: existing.id }, data })
    : await prisma.provider.create({
        data: {
          ...data,
          ownerId: session.sub,
          status: "approved",
          ...(oracle ?? {}),
        },
      });

  return NextResponse.json({ provider: publicProvider(provider) });
}
