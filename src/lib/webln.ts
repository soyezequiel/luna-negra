// Pago con extensión Lightning (WebLN): Alby y otras extensiones inyectan
// `window.webln`, lo que permite pagar un invoice BOLT11 con un click sin tener
// que escanear el QR ni copiar/pegar. Ver https://www.webln.guide/

export interface WebLNProvider {
  enable(): Promise<void>;
  sendPayment(bolt11: string): Promise<{ preimage: string }>;
}

/** Devuelve el proveedor WebLN inyectado por la extensión, o null si no hay. */
export function getWebLNProvider(): WebLNProvider | null {
  if (typeof window === "undefined") return null;
  const provider = (window as unknown as { webln?: WebLNProvider }).webln;
  return provider && typeof provider.sendPayment === "function" ? provider : null;
}

/** ¿Hay una extensión WebLN disponible en este navegador? */
export function isWebLNAvailable(): boolean {
  return getWebLNProvider() !== null;
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
