import { getStorePubkey } from "@/lib/nostr-server";

// Pubkey (hex) de la tienda: es el firmante de los artículos de juego kind:30023
// y, por ende, el `<pubkey>` de toda coordenada `30023:<pubkey>:<slug>`. Es
// información PÚBLICA (aparece en cada artículo del catálogo). El riel de amigos
// (cliente) lo consulta para reconocer la presencia 2.0 anclada por coordenada:
// un kind:30315 con tag `a` = `30023:<esta-pubkey>:<slug>` es "jugando un juego de
// ESTA tienda", sin necesitar la etiqueta privada `l:luna-negra`.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ pubkey: getStorePubkey() });
}
