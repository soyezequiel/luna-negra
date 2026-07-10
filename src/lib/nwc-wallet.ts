"use client";

// Wallet NWC (Nostr Wallet Connect) del lado del navegador. Paralelo a
// `src/lib/webln.ts`: el string de conexión es SECRETO y vive sólo en este
// navegador (localStorage); nunca se manda al servidor. Con él, el cliente paga
// invoices (gastar saldo), consulta el saldo y reclama retiros LNURL-withdraw
// (cobrar premios). Usa `NWCClient` de @getalby/sdk, que funciona en el browser.

import { NWCClient } from "@getalby/sdk";

const STORAGE_KEY = "ln_nwc_url";

export class NwcError extends Error {}

/** ¿El string tiene forma de conexión NWC válida? */
export function isValidNwcUrl(url: string): boolean {
  return /^nostr\+walletconnect:\/\/[0-9a-f]{64}\?/i.test(url.trim());
}

export function getStoredNwcUrl(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredNwcUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, url.trim());
}

export function clearStoredNwcUrl(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  // Invalida el cliente cacheado.
  cached = null;
}

// Cliente cacheado por URL: abrir la conexión al relay (WebSocket + handshake
// NWC) tarda, así que la reusamos entre llamadas (igual que `getClient()` en
// `src/lib/lightning.ts`).
let cached: { url: string; client: NWCClient } | null = null;

function getClient(): NWCClient {
  const url = getStoredNwcUrl();
  if (!url) throw new NwcError("No hay wallet NWC conectado.");
  if (!cached || cached.url !== url) {
    cached = { url, client: new NWCClient({ nostrWalletConnectUrl: url }) };
  }
  return cached.client;
}

/** Devuelve el saldo del wallet en sats (NWC trabaja en msat). */
export async function getNwcBalanceSats(): Promise<number> {
  const client = getClient();
  const res = await client.getBalance();
  return Math.floor((res.balance ?? 0) / 1000);
}

/** Valida la conexión y devuelve el saldo en sats. Útil al conectar. */
export async function probeNwc(url: string): Promise<number> {
  const client = new NWCClient({ nostrWalletConnectUrl: url.trim() });
  const res = await client.getBalance();
  return Math.floor((res.balance ?? 0) / 1000);
}

/** Paga un invoice BOLT11 con el saldo del wallet. Devuelve el preimage. */
export async function payInvoiceWithNwc(bolt11: string): Promise<string> {
  const client = getClient();
  try {
    const res = await client.payInvoice({ invoice: bolt11 });
    return res.preimage;
  } catch (e) {
    throw new NwcError(
      e instanceof Error && e.message ? e.message : "El pago con el wallet NWC falló.",
    );
  }
}

type WithdrawParams = {
  callback: string;
  k1: string;
  maxWithdrawable: number; // msat
};

/**
 * Cobra un retiro LNURL-withdraw con el wallet NWC, a partir de la URL del
 * endpoint (`https://…/api/escrow/lnurlw/{token}`): pide los params, genera un
 * invoice por el monto exacto y lo manda al callback. Reusa la misma infra que
 * el cobro con extensión (WebLN), sin tocar el servidor.
 */
export async function withdrawWithNwc(withdrawUrl: string): Promise<void> {
  const client = getClient();
  let params: WithdrawParams;
  try {
    const res = await fetch(withdrawUrl);
    const data = (await res.json()) as Partial<WithdrawParams> & { reason?: string };
    if (!data.callback || !data.k1 || !data.maxWithdrawable) {
      throw new NwcError(data.reason ?? "El retiro no está disponible.");
    }
    params = data as WithdrawParams;
  } catch (e) {
    throw e instanceof NwcError
      ? e
      : new NwcError("No se pudieron leer los datos del retiro.");
  }

  let invoice: string;
  try {
    const inv = await client.makeInvoice({
      amount: params.maxWithdrawable, // ya está en msat
      description: "Cobro de premio — Luna Negra",
    });
    invoice = inv.invoice;
  } catch (e) {
    throw new NwcError(
      e instanceof Error && e.message ? e.message : "El wallet no pudo generar el invoice.",
    );
  }

  const cbUrl = new URL(params.callback);
  cbUrl.searchParams.set("k1", params.k1);
  cbUrl.searchParams.set("pr", invoice);
  const cb = await fetch(cbUrl.toString()).then((r) => r.json());
  if (cb?.status !== "OK") {
    throw new NwcError(cb?.reason ?? "El servicio no pudo pagar el invoice.");
  }
}
