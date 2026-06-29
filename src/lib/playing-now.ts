import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

// Conteo aproximado de jugadores con presencia VIVA (GamePresence no expirada),
// distinct por npub para no contar dos veces a quien aparece en dos juegos. Es un
// dato "en vivo" para el hero del Home, no vale una query por render: se cachea
// brevemente (TTL corto) en el Data Cache de Next.
async function loadPlayingNow(): Promise<number> {
  const rows = await prisma.gamePresence.findMany({
    where: { expiresAt: { gt: new Date() } },
    select: { npub: true },
    distinct: ["npub"],
  });
  return rows.length;
}

const REVALIDATE_SECONDS = 20;

export const getPlayingNowCount = unstable_cache(loadPlayingNow, ["playing-now"], {
  revalidate: REVALIDATE_SECONDS,
});
