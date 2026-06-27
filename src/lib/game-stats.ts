/**
 * Builder de estadísticas por juego (estilo SteamDB). Lo reusan los endpoints
 * de proveedor (`/api/provider/stats`) y de admin (`/api/admin/stats`): la
 * autorización vive en las rutas; acá solo se arman las series y los totales.
 *
 * Todo se devuelve serializable (sats como `number`, nunca BigInt) para mandarlo
 * por JSON directo. Las apuestas trabajan en msat → se convierten en el borde con
 * `msatToSats` (R11). Ver src/lib/money.ts.
 */

import { prisma } from "@/lib/prisma";
import { msatToSats } from "@/lib/money";

export type StatsRange = "24h" | "7d" | "30d" | "all";
export type Granularity = "hour" | "day";

// Estados de apuesta considerados "activos" (escrow vivo). Igual criterio que el
// panel admin (src/app/admin/page.tsx).
const ACTIVE_BET_STATUSES = [
  "pending_deposits",
  "ready",
  "settling",
  "refunding",
];

export interface RevenueBucket {
  t: string;
  sats: number;
  share: number;
  count: number;
}
export interface VolumeBucket {
  t: string;
  volume: number;
  count: number;
}
export interface ZapBucket {
  t: string;
  sats: number;
  count: number;
}
export interface PlayerSample {
  t: string;
  count: number;
}

export interface GameStats {
  game: {
    id: string;
    title: string;
    slug: string;
    priceSats: number;
    providerId: string;
    providerName: string;
  };
  range: StatsRange;
  granularity: Granularity;
  windowStart: string;
  revenue: {
    totalSats: number;
    providerShareSats: number;
    salesCount: number;
    byBucket: RevenueBucket[];
    payout: { paid: number; pending: number; failed: number; none: number };
  };
  players: {
    now: number;
    peak: number;
    samples: PlayerSample[];
    /** El proveedor tiene >1 juego: la curva es compartida (limitación de presencia). */
    sharedAcrossGames: boolean;
  };
  bets: {
    totalVolumeSats: number;
    /** Tu corte de dev (proveedor) por apuestas liquidadas, del ledger (exacto). */
    devEarningsSats: number;
    devSettledSats: number; // ya cobrado a tu Lightning Address
    devPendingSats: number; // por cobrar (sin destino aún / retenido)
    devFailedSats: number; // pago falló (se reintenta)
    activeCount: number;
    settledCount: number;
    totalCount: number;
    byBucket: VolumeBucket[];
    /** Tus ganancias por apuestas por bucket (asientos dev_fee). */
    earningsByBucket: ZapBucket[];
  };
  zaps: {
    totalSats: number;
    count: number;
    byBucket: ZapBucket[];
    topZappers: { pubkey: string; sats: number; count: number }[];
  };
  /**
   * Ganancias de Luna Negra (la casa). Solo se calcula y devuelve para admin
   * (`includeHouse`); el endpoint de proveedor no la incluye. No cuenta forfeits
   * (premios no reclamados que quedan en la casa): son esporádicos y sin timestamp
   * limpio para la serie. = comisión de tienda (ventas) + corte de la casa (apuestas).
   */
  house?: {
    totalSats: number;
    storeFeeSats: number; // comisión de tienda sobre las ventas pagadas
    betFeeSats: number; // corte de la casa en apuestas (ledger kind:"fee")
    byBucket: ZapBucket[];
  };
}

function granularityFor(range: StatsRange): Granularity {
  return range === "24h" ? "hour" : "day";
}

function windowStartFor(range: StatsRange, now: Date, gameCreatedAt: Date): Date {
  switch (range) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60_000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    case "all":
      return gameCreatedAt;
  }
}

/** Clave de bucket: hora (YYYY-MM-DDTHH) o día (YYYY-MM-DD) en hora local. */
function bucketKey(date: Date, g: Granularity): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (g === "day") return `${y}-${m}-${d}`;
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

/** Lista ordenada de claves de bucket cubriendo [start, end] (sin huecos). */
function enumerateBuckets(start: Date, end: Date, g: Granularity): string[] {
  const keys: string[] = [];
  const cur = new Date(start);
  if (g === "hour") cur.setMinutes(0, 0, 0);
  else cur.setHours(0, 0, 0, 0);
  // Cap defensivo para no explotar con range "all" en juegos muy viejos.
  const MAX = g === "hour" ? 24 * 14 : 366 * 5;
  while (cur <= end && keys.length < MAX) {
    keys.push(bucketKey(cur, g));
    if (g === "hour") cur.setHours(cur.getHours() + 1);
    else cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

/**
 * Arma las estadísticas de un juego para la ventana pedida. Asume que el llamador
 * ya validó permisos sobre `gameId`. Devuelve null si el juego no existe.
 */
export async function buildGameStats(
  gameId: string,
  range: StatsRange = "30d",
  opts: { includeHouse?: boolean } = {},
): Promise<GameStats | null> {
  const now = new Date();
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { provider: { include: { _count: { select: { games: true } } } } },
  });
  if (!game) return null;

  const providerId = game.providerId;
  const g = granularityFor(range);
  const start = windowStartFor(range, now, game.createdAt);
  const buckets = enumerateBuckets(start, now, g);

  const [
    purchases,
    payoutGroups,
    presenceNow,
    samples,
    bets,
    activeCount,
    devFeeEntries,
    zaps,
  ] = await Promise.all([
    prisma.purchase.findMany({
      where: { gameId, status: "paid", paidAt: { gte: start } },
      select: { amountSats: true, paidAt: true },
    }),
    prisma.purchase.groupBy({
      by: ["payoutStatus"],
      where: { gameId, status: "paid", paidAt: { gte: start } },
      _count: { _all: true },
    }),
    prisma.gamePresence.count({
      where: { providerId, expiresAt: { gt: now } },
    }),
    prisma.playerCountSample.findMany({
      where: { providerId, sampledAt: { gte: start } },
      select: { count: true, sampledAt: true },
      orderBy: { sampledAt: "asc" },
    }),
    prisma.bet.findMany({
      where: { gameId, createdAt: { gte: start } },
      select: {
        status: true,
        stakeMsat: true,
        feePct: true,
        devFeePct: true,
        createdAt: true,
        participants: { select: { depositStatus: true } },
      },
    }),
    prisma.bet.count({ where: { gameId, status: { in: ACTIVE_BET_STATUSES } } }),
    // Tu corte de dev: asientos `dev_fee` del ledger de las apuestas de este juego.
    // Es la fuente de verdad de "tus ganancias por apuestas" (ver escrow-payout.ts).
    prisma.ledgerEntry.findMany({
      where: { kind: "dev_fee", bet: { gameId }, createdAt: { gte: start } },
      select: { amountMsat: true, status: true, createdAt: true },
    }),
    prisma.zap.findMany({
      where: { gameId, zappedAt: { gte: start } },
      select: { amountSats: true, zappedAt: true, zapperPubkey: true },
    }),
  ]);

  // ── Ingresos ──
  const revShare = game.revenueShare;
  const revByBucket = new Map<string, RevenueBucket>(
    buckets.map((t) => [t, { t, sats: 0, share: 0, count: 0 }]),
  );
  let revTotal = 0;
  let revShareTotal = 0;
  for (const p of purchases) {
    const at = p.paidAt ?? now;
    const share = Math.floor((p.amountSats * revShare) / 100);
    revTotal += p.amountSats;
    revShareTotal += share;
    const b = revByBucket.get(bucketKey(at, g));
    if (b) {
      b.sats += p.amountSats;
      b.share += share;
      b.count += 1;
    }
  }
  const payout = { paid: 0, pending: 0, failed: 0, none: 0 };
  for (const row of payoutGroups) {
    const k = row.payoutStatus as keyof typeof payout;
    if (k in payout) payout[k] = row._count._all;
  }

  // ── Jugadores ──
  const playerSamples: PlayerSample[] = samples.map((s) => ({
    t: s.sampledAt.toISOString(),
    count: s.count,
  }));
  const peak = playerSamples.reduce(
    (max, s) => Math.max(max, s.count),
    presenceNow,
  );

  // ── Apuestas ──
  const volByBucket = new Map<string, VolumeBucket>(
    buckets.map((t) => [t, { t, volume: 0, count: 0 }]),
  );
  let volTotal = 0;
  let settledCount = 0;
  for (const b of bets) {
    const paidPlayers = b.participants.filter(
      (p) => p.depositStatus === "paid",
    ).length;
    const stakeSats = Number(msatToSats(b.stakeMsat));
    const volume = stakeSats * paidPlayers; // sats que entraron al escrow
    volTotal += volume;
    if (b.status === "settled") settledCount += 1;
    const bucket = volByBucket.get(bucketKey(b.createdAt, g));
    if (bucket) {
      bucket.volume += volume;
      bucket.count += 1;
    }
  }

  // Tus ganancias por apuestas (corte de dev), exactas desde el ledger. Para
  // juegos gratis es la fuente principal de ingresos del proveedor. OJO: el corte
  // de dev por apuesta suele ser SUB-SAT (pozos chicos × pocos %), así que sumamos
  // en MSAT y convertimos a sats UNA sola vez al final; convertir por-asiento
  // perdería cada fracción <1 sat (134 apuestas chicas → la mayoría se evaporaría).
  const earnMsatByBucket = new Map<string, bigint>(buckets.map((t) => [t, 0n]));
  const earnCountByBucket = new Map<string, number>(buckets.map((t) => [t, 0]));
  let devMsat = 0n;
  let devSettledMsat = 0n;
  let devPendingMsat = 0n;
  let devFailedMsat = 0n;
  for (const e of devFeeEntries) {
    devMsat += e.amountMsat;
    if (e.status === "settled") devSettledMsat += e.amountMsat;
    else if (e.status === "failed") devFailedMsat += e.amountMsat;
    else devPendingMsat += e.amountMsat; // pending (retenido / sin destino aún)
    const k = bucketKey(e.createdAt, g);
    if (earnMsatByBucket.has(k)) {
      earnMsatByBucket.set(k, earnMsatByBucket.get(k)! + e.amountMsat);
      earnCountByBucket.set(k, earnCountByBucket.get(k)! + 1);
    }
  }
  const devEarnings = Number(msatToSats(devMsat));
  const devSettled = Number(msatToSats(devSettledMsat));
  const devPending = Number(msatToSats(devPendingMsat));
  const devFailed = Number(msatToSats(devFailedMsat));
  const earningsByBucket: ZapBucket[] = buckets.map((t) => ({
    t,
    sats: Number(msatToSats(earnMsatByBucket.get(t)!)),
    count: earnCountByBucket.get(t)!,
  }));

  // ── Zaps ──
  const zapByBucket = new Map<string, ZapBucket>(
    buckets.map((t) => [t, { t, sats: 0, count: 0 }]),
  );
  let zapTotal = 0;
  const zapperAgg = new Map<string, { sats: number; count: number }>();
  for (const z of zaps) {
    zapTotal += z.amountSats;
    const bucket = zapByBucket.get(bucketKey(z.zappedAt, g));
    if (bucket) {
      bucket.sats += z.amountSats;
      bucket.count += 1;
    }
    const prev = zapperAgg.get(z.zapperPubkey) ?? { sats: 0, count: 0 };
    prev.sats += z.amountSats;
    prev.count += 1;
    zapperAgg.set(z.zapperPubkey, prev);
  }
  const topZappers = [...zapperAgg.entries()]
    .map(([pubkey, v]) => ({ pubkey, sats: v.sats, count: v.count }))
    .sort((a, b) => b.sats - a.sats)
    .slice(0, 10);

  // ── Casa (Luna Negra) — solo admin ──
  let house: GameStats["house"] = undefined;
  if (opts.includeHouse) {
    // Corte de la casa en apuestas: asientos `fee` del ledger (userId null), ya
    // settled. Sumamos en msat y convertimos al final (mismo cuidado sub-sat).
    const houseFeeEntries = await prisma.ledgerEntry.findMany({
      where: { kind: "fee", bet: { gameId }, createdAt: { gte: start } },
      select: { amountMsat: true, createdAt: true },
    });
    const feeMsatByBucket = new Map<string, bigint>(buckets.map((t) => [t, 0n]));
    let betFeeMsat = 0n;
    for (const e of houseFeeEntries) {
      betFeeMsat += e.amountMsat;
      const k = bucketKey(e.createdAt, g);
      if (feeMsatByBucket.has(k))
        feeMsatByBucket.set(k, feeMsatByBucket.get(k)! + e.amountMsat);
    }
    const storeFeeSats = revTotal - revShareTotal; // comisión de tienda
    const betFeeSats = Number(msatToSats(betFeeMsat));
    const houseByBucket: ZapBucket[] = buckets.map((t) => {
      const rev = revByBucket.get(t)!;
      const betPart = Number(msatToSats(feeMsatByBucket.get(t)!));
      return { t, sats: rev.sats - rev.share + betPart, count: 0 };
    });
    house = {
      totalSats: storeFeeSats + betFeeSats,
      storeFeeSats,
      betFeeSats,
      byBucket: houseByBucket,
    };
  }

  return {
    game: {
      id: game.id,
      title: game.title,
      slug: game.slug,
      priceSats: game.priceSats,
      providerId,
      providerName: game.provider.name,
    },
    range,
    granularity: g,
    windowStart: start.toISOString(),
    revenue: {
      totalSats: revTotal,
      providerShareSats: revShareTotal,
      salesCount: purchases.length,
      byBucket: [...revByBucket.values()],
      payout,
    },
    players: {
      now: presenceNow,
      peak,
      samples: playerSamples,
      sharedAcrossGames: game.provider._count.games > 1,
    },
    bets: {
      totalVolumeSats: volTotal,
      devEarningsSats: devEarnings,
      devSettledSats: devSettled,
      devPendingSats: devPending,
      devFailedSats: devFailed,
      activeCount,
      settledCount,
      totalCount: bets.length,
      byBucket: [...volByBucket.values()],
      earningsByBucket,
    },
    zaps: {
      totalSats: zapTotal,
      count: zaps.length,
      byBucket: [...zapByBucket.values()],
      topZappers,
    },
    house,
  };
}

/** Valida y normaliza el query param `range`. */
export function parseRange(raw: string | null): StatsRange {
  return raw === "24h" || raw === "7d" || raw === "30d" || raw === "all"
    ? raw
    : "30d";
}
