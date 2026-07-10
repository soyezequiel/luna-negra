import { notFound } from "next/navigation";
import { getPublishedGameBySlug } from "@/lib/store-catalog";
import { LaunchGate } from "./launch-gate";

// Cold-open SSO de "Luna Room Link" (ver docs/luna-room-link.md §"Handoff de
// identidad"). Un enlace crudo `<gameUrl>?lnRoom=…` reenviado por WhatsApp/Discord
// cae en el juego SIN identidad; el juego rebota acá con `returnTo` = su URL
// original. Luna autentica (reusa la sesión o pide login), mintea un entitlement
// fresco y redirige de vuelta al dominio del juego con `lnToken` + `lnRoom`
// intactos.
export const dynamic = "force-dynamic";

// Anti-open-redirect: `returnTo` SOLO puede apuntar al dominio registrado del
// juego (`Game.gameUrl`). Nunca a un host arbitrario.
function returnsToGame(returnTo: string, gameUrl: string): boolean {
  try {
    const dest = new URL(returnTo);
    if (dest.protocol !== "https:" && dest.protocol !== "http:") return false;
    return dest.host.toLowerCase() === new URL(gameUrl).host.toLowerCase();
  } catch {
    return false;
  }
}

export default async function LaunchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  let game: Awaited<ReturnType<typeof getPublishedGameBySlug>>;
  try {
    game = await getPublishedGameBySlug(slug);
  } catch {
    game = null;
  }
  if (!game) notFound();

  const returnTo = typeof sp.returnTo === "string" ? sp.returnTo.trim() : "";
  // `returnTo` validado server-side: el cliente solo puede APENDER `lnToken` a este
  // destino, nunca cambiar el host. Si es inválido → `null` y la puerta muestra error.
  const validReturnTo =
    game.gameUrl && returnsToGame(returnTo, game.gameUrl) ? returnTo : null;

  return (
    <LaunchGate
      gameId={game.id}
      slug={game.slug}
      title={game.title}
      returnTo={validReturnTo}
    />
  );
}
