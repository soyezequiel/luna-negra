export const APP_NAME = "Luna Negra";

// Tag `t` con el que Luna Negra marca toda la actividad (anuncio + respuestas)
// de un juego, para poder filtrarla por relay sin depender del id del evento.
export function gameTag(slug: string): string {
  return `lunanegra:game:${slug}`;
}

// Relays públicos para leer/publicar perfil, amigos, chat y actividad.
export const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

// Relays con soporte NIP-50 (búsqueda full-text de perfiles kind:0). nostr.band
// indexa nombres/about y es el que mejor responde a búsquedas de usuarios.
export const SEARCH_RELAYS = ["wss://relay.nostr.band"];
