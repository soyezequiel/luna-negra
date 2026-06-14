/**
 * Formato de fechas para el chat, pensado para meter poca carga mental:
 * separadores de día agrupan los mensajes ("Hoy" / "Ayer" / fecha) y cada
 * mensaje lleva solo la hora (HH:mm). Así no se repite la fecha en cada burbuja.
 *
 * Los timestamps de Nostr vienen en segundos (no en milisegundos).
 */

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** ¿Dos timestamps (en segundos) caen el mismo día calendario local? */
export function sameDay(aSec: number, bSec: number): boolean {
  return startOfDay(new Date(aSec * 1000)) === startOfDay(new Date(bSec * 1000));
}

/** Etiqueta del separador de día: "Hoy", "Ayer" o una fecha corta. */
export function formatDayLabel(ts: number, nowMs: number = Date.now()): string {
  const date = new Date(ts * 1000);
  const today = startOfDay(new Date(nowMs));
  const day = startOfDay(date);
  const dayMs = 86_400_000;

  if (day === today) return "Hoy";
  if (day === today - dayMs) return "Ayer";

  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return date.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Hora local en formato corto (HH:mm). */
export function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
