import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { generateOracleKey } from "@/lib/oracle-keys";
import { revalidateCatalog } from "@/lib/store-catalog";
import { getEconomySettings, normalizePercent } from "@/lib/economy-settings";

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
  const { name, lightningAddress, imageUrl, betDevFeePct } = await req
    .json()
    .catch(() => ({}));
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  }

  // Corte del dev en apuestas: % válido, acotado al tope global del admin (la
  // misma cota se reaplica al crear cada apuesta). Si no se envía, no se toca.
  let devFee: number | undefined;
  if (betDevFeePct !== undefined) {
    try {
      const economy = await getEconomySettings();
      devFee = Math.min(
        normalizePercent(betDevFeePct, "Tu corte de apuestas"),
        economy.betDevFeeMaxPct,
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Porcentaje invalido" },
        { status: 400 },
      );
    }
  }

  const existing = await prisma.provider.findFirst({
    where: { ownerId: session.sub },
  });
  const data = {
    name: name.trim(),
    imageUrl:
      typeof imageUrl === "string" && imageUrl.trim() ? imageUrl.trim() : null,
    lightningAddress:
      typeof lightningAddress === "string" && lightningAddress.trim()
        ? lightningAddress.trim()
        : null,
    ...(devFee !== undefined ? { betDevFeePct: devFee } : {}),
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

  // La ficha de cada juego embebe los datos del proveedor (nombre/imagen) desde
  // el catálogo cacheado; invalidamos para que el cambio se vea al instante.
  revalidateCatalog();

  return NextResponse.json({ provider: publicProvider(provider) });
}
