// Pago con extensión Lightning (WebLN): Alby y otras extensiones inyectan
// `window.webln`, lo que permite pagar un invoice BOLT11 con un click sin tener
// que escanear el QR ni copiar/pegar. Ver https://www.webln.guide/

export interface WebLNProvider {
  enable(): Promise<void>;
  sendPayment(bolt11: string): Promise<{ preimage: string }>;
  // Método LUD-17 (LNURL): Alby y compatibles resuelven el flujo (withdraw, pay,
  // auth) a partir del string LNURL bech32. Opcional: no todas lo implementan.
  lnurl?(lnurl: string): Promise<unknown>;
}

/** Devuelve el proveedor WebLN inyectado por la extensión, o null si no hay. */
export function getWebLNProvider(): WebLNProvider | null {
  if (typeof window === "undefined") return null;
  const provider = (window as unknown as { webln?: WebLNProvider }).webln;
  return provider && typeof provider.sendPayment === "function" ? provider : null;
}

export class WebLNError extends Error {}

/**
 * Habilita la extensión y paga el invoice. Lanza WebLNError con un mensaje claro
 * si no hay extensión o si el usuario cancela / el pago falla. El éxito se debe
 * confirmar igual por el polling del estado (la extensión no es fuente de verdad).
 */
export async function payWithExtension(bolt11: string): Promise<void> {
  const provider = getWebLNProvider();
  if (!provider) {
    throw new WebLNError(
      "No se detectó una extensión Lightning. Instalá Alby (u otra compatible con WebLN).",
    );
  }
  try {
    await provider.enable();
    await provider.sendPayment(bolt11);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "El pago con la extensión falló.";
    throw new WebLNError(message);
  }
}

/**
 * Cobra un retiro (LNURL-withdraw) con la extensión a partir del string LNURL
 * bech32. Lanza WebLNError si no hay extensión, si no soporta `lnurl`, o si el
 * usuario cancela / falla. El estado real lo confirma el polling.
 */
export async function withdrawWithExtension(lnurl: string): Promise<void> {
  const provider = getWebLNProvider();
  if (!provider || typeof provider.lnurl !== "function") {
    throw new WebLNError(
      "No se detectó una extensión Lightning compatible con LNURL. Instalá Alby (u otra) o escaneá el QR.",
    );
  }
  try {
    await provider.enable();
    await provider.lnurl(lnurl);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "El cobro con la extensión falló.";
    throw new WebLNError(message);
  }
}
