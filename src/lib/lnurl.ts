import { bech32 } from "bech32";

/**
 * Codifica una URL https como LNURL bech32 (LNURL1...). Es el formato universal
 * que entienden las wallets (WoS, Phoenix, etc.) — a diferencia del esquema
 * `lnurlw://` (LUD-17) que muchas no soportan.
 */
export function encodeLnurl(url: string): string {
  const words = bech32.toWords(new TextEncoder().encode(url));
  return bech32.encode("lnurl", words, 2000).toUpperCase();
}
