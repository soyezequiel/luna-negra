export function priceLabel(sats: number): string {
  return sats === 0 ? "Gratis" : `${sats.toLocaleString("es-AR")} sats`;
}
