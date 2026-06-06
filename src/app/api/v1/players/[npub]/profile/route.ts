import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { pubkeyFromNpub, npubOf } from "@/lib/nostr-social";
import { cacheProfile } from "@/lib/profile-cache";
import { fetchProfile, profileName } from "@/lib/nostr";
import { apiOk, apiError, corsPreflight } from "@/lib/api";

// Perfil público de un jugador (nombre + avatar) por npub. Permite al juego
// refrescar la presentación sin depender solo del invite token.
// Público (CORS abierto): lo llama el lobby del juego.
export function OPTIONS() {
  return corsPreflight();
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ npub: string }> },
) {
  const { npub: rawNpub } = await params;
  const pubkey = pubkeyFromNpub(rawNpub);
  if (!pubkey) {
    return apiError("INVALID_NPUB", "npub inválido", 400);
  }
  const npub = npubOf(pubkey); // normaliza (por si vino con mayúsculas/espacios)

  // Cache local (kind:0). Si existe, lo devolvemos y refrescamos en background.
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { displayName: true, avatarUrl: true },
  });

  if (user) {
    if (!user.displayName || !user.avatarUrl) {
      after(() => cacheProfile(pubkey).then(() => undefined));
    }
    return apiOk({
      npub,
      pubkey,
      displayName: user.displayName ?? null,
      avatarUrl: user.avatarUrl ?? null,
    });
  }

  // Jugador desconocido para Luna Negra: best-effort directo a relays (sin persistir).
  const p = await fetchProfile(pubkey).catch(() => null);
  return apiOk({
    npub,
    pubkey,
    displayName: profileName(p),
    avatarUrl: p?.picture ?? null,
  });
}
