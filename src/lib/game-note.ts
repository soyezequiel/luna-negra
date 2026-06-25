// Helpers de comentarios de juego (kind:1) seguros para el SERVIDOR: sin
// dependencias de relays ni del firmador del navegador. Viven aquí (y no en
// nostr-social.ts) para poder usarlos en rutas/jobs server-side sin arrastrar
// SimplePool ni el signer. `nostr-social` los re-exporta para el cliente.

// Marca que separa el texto del usuario del pie de contexto (modo fallback,
// cuando el juego aún no tiene anuncio raíz). Empezar el pie con este string
// permite recortarlo al mostrar la nota dentro de Luna Negra.
export const GAME_NOTE_FOOTER_MARK = "\n\n🎮 Sobre «";

/** Texto del comentario sin el pie de contexto (si lo tiene). */
export function gameNoteText(content: string): string {
  const i = content.indexOf(GAME_NOTE_FOOTER_MARK);
  return i === -1 ? content : content.slice(0, i);
}
