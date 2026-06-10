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
