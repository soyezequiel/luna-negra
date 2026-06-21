import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { authRoomMember, readRoomState, writeRoomState, type RoomStateView } from "@/lib/room-state";
import { recordIntegration } from "@/lib/integration-telemetry";
import { apiOk, apiError, corsPreflight, bearerToken, CORS } from "@/lib/api";

// Estado compartido de una sala (tablero común + estado por jugador), para juegos
// SIN backend propio. Auth: Authorization: Bearer <invite token> de la sala.
//  - GET  → { data, version, members }. Polling barato vía ETag (304 si no cambió).
//  - POST { set?, self?, version? } → mezcla la bolsa compartida (last-write-wins
//    por clave; `version` = CAS opcional) y/o reemplaza la bolsa del jugador.
export function OPTIONS() {
  return corsPreflight();
}

function etagFor(view: RoomStateView): string {
  return `"${createHash("sha1").update(JSON.stringify(view)).digest("base64url")}"`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const auth = await authRoomMember(bearerToken(req), roomId);
  if (!auth.ok) return apiError(auth.code, auth.message, auth.status);
  void recordIntegration("rooms", { gameId: auth.gameId });

  const view = await readRoomState(roomId);
  const etag = etagFor(view);
  const headers = { "Cache-Control": "no-store", ETag: etag };
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...CORS, ...headers } });
  }
  return apiOk({ data: view.data, version: view.version, members: view.members }, headers);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const auth = await authRoomMember(bearerToken(req), roomId);
  if (!auth.ok) return apiError(auth.code, auth.message, auth.status);
  void recordIntegration("rooms", { gameId: auth.gameId });

  const body = await req.json().catch(() => ({}));
  const result = await writeRoomState(roomId, auth.npub, {
    set: (body as { set?: unknown })?.set,
    self: (body as { self?: unknown })?.self,
    version: (body as { version?: unknown })?.version,
  });
  if (!result.ok) return apiError(result.code, result.message, result.status);

  const { view } = result;
  return apiOk(
    { data: view.data, version: view.version, members: view.members },
    { "Cache-Control": "no-store", ETag: etagFor(view) },
  );
}
