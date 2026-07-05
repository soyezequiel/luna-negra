// Tipos, constantes y utilidades compartidas entre los tabs del admin.
// Extraído de src/app/admin/page.tsx para mantener cada tab limpio.

export type Row = {
  id: string;
  title: string;
  slug: string;
  priceSats: number;
  provider: { name: string };
};

// Juego en revisión: la API ya devuelve el objeto Game completo. Lo tipamos
// entero para poder mostrar todos los datos antes de aprobar/rechazar.
export type ReviewGame = Row & {
  description: string;
  categories: string[];
  revenueShare: number;
  betFeePct: number | null; // override del corte de apuestas de la casa; null = global
  gameUrl: string | null;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  screenshots: string; // JSON array de URLs
  createdAt: string;
  isBeta: boolean;
};

export type DraftGame = Omit<Row, "provider"> & {
  description: string;
  categories: string[];
  gameUrl: string | null;
  coverUrl: string | null;
  horizontalCoverUrl: string | null;
  createdAt: string;
  provider: {
    name: string;
    owner: { displayName: string | null; npub: string };
  };
};

export type CatalogRow = Row & {
  owners: number;
  revenueShare: number;
  betFeePct: number | null;
  isBeta: boolean;
};

export type Payout = {
  id: string;
  gameTitle: string;
  providerName: string;
  lightningAddress: string | null;
  share: number;
  payoutStatus: string;
};

export type BetPayout = {
  npub: string;
  payoutSats: number;
  payoutStatus: string;
  payoutDestination: string | null;
  payoutKind: string | null;
};

export type BetRow = {
  id: string;
  version: 1 | 2;
  gameTitle: string;
  status: string;
  stakeSats: number;
  paid: number;
  total: number;
  payouts: BetPayout[];
};

export type EconomySettings = {
  storeFeePct: number;
  providerRevenueShare: number;
  betFeePct: number;
  betDevFeeMaxPct: number;
  updatedAt: string | null;
  configured: boolean;
};

export type TreasurySettings = {
  minSats: number;
  maxSats: number;
  updatedAt: string | null;
  configured: boolean;
};

export type TreasuryInfo = {
  settings: TreasurySettings;
  balanceSats: number | null;
  lightningConfigured: boolean;
  address: string | null;
};

export const PAYOUT_LABEL: Record<string, string> = {
  pending: "En proceso",
  failed: "Falló",
  skipped: "Sin dirección",
};

export const ADMIN_DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeZone: "America/Argentina/Buenos_Aires",
});

export const BET_STATUS: Record<string, string> = {
  pending_deposits: "Esperando depósitos",
  ready: "En juego",
  settling: "Liquidando",
  settled: "Resuelta",
  refunding: "Reembolsando",
  cancelled_incomplete: "Cancelada (incompleta)",
  cancelled_admin: "Cancelada (admin)",
  refunded_timeout: "Reembolsada (timeout)",
};

export function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

export function draftAge(createdAt: string): string {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000),
  );
  if (days === 0) return "hoy";
  if (days === 1) return "hace 1 día";
  return `hace ${days} días`;
}

export function missingDraftFields(game: DraftGame): string[] {
  const missing: string[] = [];
  if (!game.gameUrl?.trim()) missing.push("URL del juego");
  if (!game.description.trim()) missing.push("descripción");
  if (game.categories.length === 0) missing.push("categoría");
  if (!game.coverUrl && !game.horizontalCoverUrl) missing.push("portada");
  return missing;
}

export function parseShots(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function storeFeeFromRevenueShare(revenueShare: number): number {
  return 100 - revenueShare;
}
