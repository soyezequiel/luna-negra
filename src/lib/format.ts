export function priceLabel(sats: number): string {
  return sats === 0 ? "Gratis" : `${sats.toLocaleString("es-AR")} sats`;
}

/** Hue 0–360 derivado del slug, para portadas generadas por color (dopamina). */
export function hueFromSlug(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Formatea sats con separador de miles (sin sufijo). */
export function satsLabel(sats: number): string {
  return sats.toLocaleString("es-AR");
}

/** Formatea una duración en ms como "Xh Ym" / "Ym" (sin horas si no llega a una). */
export function formatDurationMs(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (totalMin > 0) return `${totalMin} min`;
  return "menos de 1 min";
}

export function timeAgo(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}
