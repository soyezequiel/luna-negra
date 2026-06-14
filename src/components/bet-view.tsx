"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { LightningInvoiceModal } from "@/components/lightning-invoice-modal";
import { payWithExtension, withdrawWithExtension, WebLNError } from "@/lib/webln";

type Participant = { npub: string; name: string | null; paid: boolean; refunded: boolean };
type BetData = {
  id: string;
  status: string;
  stakeSats: number;
  feePct: number;
  victoryCondition: string;
  depositDeadline: string | null;
  contractEventId: string | null;
  gameTitle: string;
  providerName: string;
  participants: Participant[];
  me: {
    paid: boolean;
    result: string;
    payoutStatus: string;
    depositInvoice: string | null;
    withdrawUrl: string | null;
  } | null;
};

const ACTIVE = new Set(["pending_deposits", "ready", "settling", "refunding"]);

function shortNpub(np: string) {
  return np.length > 16 ? `${np.slice(0, 12)}…` : np;
}

export function BetView({ betId }: { betId: string }) {
  const { user, login, loading } = useSession();
  const [bet, setBet] = useState<BetData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [withdrawQr, setWithdrawQr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [weblnPaying, setWeblnPaying] = useState(false);
  const [weblnError, setWeblnError] = useState<string | null>(null);
  const [weblnWithdrawing, setWeblnWithdrawing] = useState(false);
  const [weblnWithdrawError, setWeblnWithdrawError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, startLoadTransition] = useTransition();

  const load = useCallback(async () => {
    const r = await fetch(`/api/escrow/bets/${betId}`);
    if (r.status === 404) return setNotFound(true);
    if (r.ok) setBet(await r.json());
  }, [betId]);

  useEffect(() => {
    startLoadTransition(() => {
      void load();
    });
  }, [load, startLoadTransition]);

  // Ticker 1s (countdown) + polling 3s mientras está activa.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (bet && ACTIVE.has(bet.status)) {
      pollRef.current = setInterval(load, 3000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [bet, load]);

  async function deposit() {
    setBusy(true);
    try {
      const r = await fetch(`/api/escrow/bets/${betId}/deposit`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) return alert(d.error ?? "Error");
      setInvoice(d.invoice);
      setDevMode(Boolean(d.devMode));
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    await fetch(`/api/escrow/bets/${betId}/dev-deposit`, { method: "POST" });
    setInvoice(null);
    load();
  }

  async function payExtension() {
    if (!invoice) return;
    setWeblnError(null);
    setWeblnPaying(true);
    try {
      await payWithExtension(invoice);
      // El polling de 3s detecta el depósito y actualiza el estado.
    } catch (e) {
      setWeblnError(e instanceof WebLNError ? e.message : "No se pudo pagar con la extensión.");
    } finally {
      setWeblnPaying(false);
    }
  }

  async function withdrawExtension() {
    const url = bet?.me?.withdrawUrl;
    if (!url) return;
    setWeblnWithdrawError(null);
    setWeblnWithdrawing(true);
    try {
      await withdrawWithExtension(url);
      // El polling de 3s detecta el cobro y actualiza payoutStatus.
      load();
    } catch (e) {
      setWeblnWithdrawError(e instanceof WebLNError ? e.message : "No se pudo cobrar con la extensión.");
    } finally {
      setWeblnWithdrawing(false);
    }
  }

  if (loading) return null;
  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Apuesta</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para ver la apuesta.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      </div>
    );
  }
  if (notFound) return <p className="px-4 py-16 text-center text-muted">Apuesta no encontrada.</p>;
  if (!bet) return <p className="px-4 py-16 text-center text-faint">Cargando…</p>;

  const paidCount = bet.participants.filter((p) => p.paid).length;
  const total = bet.participants.length;
  const rival = bet.participants.find((p) => p.npub !== user.npub);
  const rivalName = rival ? (rival.name ?? shortNpub(rival.npub)) : null;
  const secsLeft = bet.depositDeadline
    ? Math.max(0, Math.floor((new Date(bet.depositDeadline).getTime() - now) / 1000))
    : 0;
  const mmss = `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      {/* Contrato */}
      <div className="rounded-lg border border-line bg-panel p-5">
        <h1 className="text-xl font-bold text-white">Apuesta · {bet.gameTitle}</h1>
        <dl className="mt-3 space-y-1 text-sm text-ink">
          <div className="flex justify-between"><dt className="text-faint">Monto por jugador</dt><dd className="font-mono text-btc">{bet.stakeSats} sats</dd></div>
          <div className="flex justify-between"><dt className="text-faint">Gana</dt><dd className="text-right">{bet.victoryCondition || "según el juego"}</dd></div>
          <div className="flex justify-between"><dt className="text-faint">Comisión</dt><dd>{bet.feePct}% · empate = se divide</dd></div>
          <div className="flex justify-between"><dt className="text-faint">Resuelve</dt><dd>{bet.providerName}</dd></div>
        </dl>
        <div className="mt-2 text-xs text-faint">
          Participantes: {bet.participants.map((p) => p.name ?? shortNpub(p.npub)).join(", ")}
        </div>
        {bet.contractEventId ? (
          <a
            href={`https://njump.me/${bet.contractEventId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs text-blue hover:underline"
          >
            Ver contrato en Nostr ↗
          </a>
        ) : null}
      </div>

      {/* Estado */}
      <div className="mt-6">
        {!bet.me ? (
          <p className="text-sm text-muted">No sos participante de esta apuesta.</p>
        ) : ["cancelled_incomplete", "refunded_timeout", "cancelled_admin", "voided"].includes(bet.status) ? (
          <p className="rounded border border-btc/30 bg-btc/10 p-4 text-sm text-btc">
            Apuesta cancelada/reembolsada. {bet.me.paid ? "Te devolvimos tu depósito." : ""}
          </p>
        ) : bet.status === "settled" ? (
          <div className="rounded-lg border border-line bg-panel p-4 text-center">
            {bet.me.result === "won" ? (
              <p className="text-lg font-semibold text-green">🎉 ¡Ganaste!</p>
            ) : bet.me.result === "tie" ? (
              <p className="text-lg font-semibold text-blue">Empate — te tocó parte del pozo</p>
            ) : (
              <p className="text-lg font-semibold text-muted">Perdiste esta vez</p>
            )}
            {bet.me.payoutStatus === "paid" || bet.me.payoutStatus === "claimed" ? (
              <p className="mt-1 text-sm text-green">Cobrado ✓</p>
            ) : bet.me.payoutStatus === "withdraw_pending" && bet.me.withdrawUrl ? (
              <div className="mt-3">
                <Button
                  variant="btc"
                  className="w-full"
                  onClick={withdrawExtension}
                  disabled={weblnWithdrawing}
                >
                  {weblnWithdrawing ? "Cobrando…" : "⚡ Cobrar con extensión (Alby)"}
                </Button>
                {weblnWithdrawError ? (
                  <p className="mt-2 text-sm text-[var(--lose)]">{weblnWithdrawError}</p>
                ) : null}
                {!withdrawQr ? (
                  <Button
                    variant="ghost"
                    className="mt-2 w-full"
                    onClick={async () => {
                      const u = bet.me?.withdrawUrl;
                      if (u) setWithdrawQr(await QRCode.toDataURL(u, { margin: 1, width: 220 }));
                    }}
                  >
                    Cobrar con QR
                  </Button>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={withdrawQr} alt="QR de retiro" className="mx-auto mt-2 rounded-lg bg-white p-2" />
                    <p className="mt-2 text-xs text-btc">
                      Escaneá con tu wallet. Tenés 60 min o los sats quedan en el pozo.
                    </p>
                  </>
                )}
              </div>
            ) : bet.me.payoutStatus === "forfeited" ? (
              <p className="mt-1 text-sm text-faint">
                No reclamaste a tiempo; los sats quedaron en el pozo.
              </p>
            ) : bet.me.payoutStatus === "failed" ? (
              <p className="mt-1 text-sm text-[var(--lose)]">
                Hubo un problema con el cobro; se reintentará.
              </p>
            ) : null}
          </div>
        ) : !bet.me.paid && bet.status === "pending_deposits" ? (
          <div>
            {!accepted ? (
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                Entiendo que esto es una apuesta en beta, que los pagos en Lightning son irreversibles y que Luna Negra no se hace responsable.
              </label>
            ) : (
              <>
                <Button
                  variant="corona"
                  className="w-full"
                  onClick={deposit}
                  disabled={busy || Boolean(invoice)}
                >
                  {busy
                    ? "Generando…"
                    : invoice
                      ? "Factura abierta…"
                      : `⚡ Depositar ${bet.stakeSats} sats`}
                </Button>
                {invoice ? (
                  <LightningInvoiceModal
                    bolt11={invoice}
                    amountSats={bet.stakeSats}
                    title={bet.gameTitle}
                    subtitle={rivalName ? `vs ${rivalName}` : undefined}
                    countdown={bet.depositDeadline ? mmss : null}
                    onPayExtension={payExtension}
                    paying={weblnPaying}
                    payError={weblnError}
                    devMode={devMode}
                    onSimulate={simulate}
                    onConfirm={() => load()}
                    onClose={() => setInvoice(null)}
                  />
                ) : null}
              </>
            )}
          </div>
        ) : bet.status === "pending_deposits" ? (
          <div className="rounded-lg border border-line bg-panel p-4 text-center">
            <p className="text-sm text-ink">Esperando jugadores…</p>
            <p className="mt-1 text-2xl font-bold text-btc">{paidCount} / {total}</p>
            <p className="mt-1 text-xs text-faint">{mmss} para completar</p>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-panel p-4 text-center">
            <p className="text-sm font-medium text-green">¡Todos depositaron — a jugar!</p>
            <p className="mt-1 text-xs text-faint">Esperando el resultado del juego…</p>
          </div>
        )}
      </div>
    </div>
  );
}
