"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";

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
  const [qr, setQr] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [withdrawQr, setWithdrawQr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/escrow/bets/${betId}`);
    if (r.status === 404) return setNotFound(true);
    if (r.ok) setBet(await r.json());
  }, [betId]);

  useEffect(() => {
    load();
  }, [load]);

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
      setQr(await QRCode.toDataURL(d.invoice, { margin: 1, width: 220 }));
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    await fetch(`/api/escrow/bets/${betId}/dev-deposit`, { method: "POST" });
    setInvoice(null);
    setQr(null);
    load();
  }

  if (loading) return null;
  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Apuesta</h1>
        <p className="mt-2 text-zinc-400">Conectá tu Nostr para ver la apuesta.</p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }
  if (notFound) return <p className="px-4 py-16 text-center text-zinc-400">Apuesta no encontrada.</p>;
  if (!bet) return <p className="px-4 py-16 text-center text-zinc-500">Cargando…</p>;

  const paidCount = bet.participants.filter((p) => p.paid).length;
  const total = bet.participants.length;
  const secsLeft = bet.depositDeadline
    ? Math.max(0, Math.floor((new Date(bet.depositDeadline).getTime() - now) / 1000))
    : 0;
  const mmss = `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      {/* Contrato */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h1 className="text-xl font-bold">Apuesta · {bet.gameTitle}</h1>
        <dl className="mt-3 space-y-1 text-sm text-zinc-300">
          <div className="flex justify-between"><dt className="text-zinc-500">Monto por jugador</dt><dd>{bet.stakeSats} sats</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Gana</dt><dd className="text-right">{bet.victoryCondition || "según el juego"}</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Comisión</dt><dd>{bet.feePct}% · empate = se divide</dd></div>
          <div className="flex justify-between"><dt className="text-zinc-500">Resuelve</dt><dd>{bet.providerName}</dd></div>
        </dl>
        <div className="mt-2 text-xs text-zinc-500">
          Participantes: {bet.participants.map((p) => p.name ?? shortNpub(p.npub)).join(", ")}
        </div>
        {bet.contractEventId ? (
          <a
            href={`https://njump.me/${bet.contractEventId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs text-sky-400 hover:underline"
          >
            Ver contrato en Nostr ↗
          </a>
        ) : null}
      </div>

      {/* Estado */}
      <div className="mt-6">
        {!bet.me ? (
          <p className="text-sm text-zinc-400">No sos participante de esta apuesta.</p>
        ) : ["cancelled_incomplete", "refunded_timeout", "cancelled_admin"].includes(bet.status) ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
            Apuesta cancelada/reembolsada. {bet.me.paid ? "Te devolvimos tu depósito." : ""}
          </p>
        ) : bet.status === "settled" ? (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
            {bet.me.result === "won" ? (
              <p className="text-lg font-semibold text-emerald-400">🎉 ¡Ganaste!</p>
            ) : bet.me.result === "tie" ? (
              <p className="text-lg font-semibold text-sky-400">Empate — te tocó parte del pozo</p>
            ) : (
              <p className="text-lg font-semibold text-zinc-400">Perdiste esta vez</p>
            )}
            {bet.me.payoutStatus === "paid" || bet.me.payoutStatus === "claimed" ? (
              <p className="mt-1 text-sm text-emerald-400">Cobrado ✓</p>
            ) : bet.me.payoutStatus === "withdraw_pending" && bet.me.withdrawUrl ? (
              <div className="mt-3">
                {!withdrawQr ? (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const u = bet.me?.withdrawUrl;
                      if (u) setWithdrawQr(await QRCode.toDataURL(u, { margin: 1, width: 220 }));
                    }}
                  >
                    Retirar (mostrar QR)
                  </Button>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={withdrawQr} alt="QR de retiro" className="mx-auto rounded-lg bg-white p-2" />
                    <p className="mt-2 text-xs text-amber-400">
                      Escaneá con tu wallet. Tenés 60 min o los sats quedan en el pozo.
                    </p>
                  </>
                )}
              </div>
            ) : bet.me.payoutStatus === "forfeited" ? (
              <p className="mt-1 text-sm text-zinc-500">
                No reclamaste a tiempo; los sats quedaron en el pozo.
              </p>
            ) : bet.me.payoutStatus === "failed" ? (
              <p className="mt-1 text-sm text-red-400">
                Hubo un problema con el cobro; se reintentará.
              </p>
            ) : null}
          </div>
        ) : !bet.me.paid && bet.status === "pending_deposits" ? (
          <div>
            {!accepted ? (
              <label className="flex items-start gap-2 text-sm text-zinc-300">
                <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                Entiendo que esto es una apuesta en beta, que los pagos en Lightning son irreversibles y que Luna Negra no se hace responsable.
              </label>
            ) : !invoice ? (
              <Button onClick={deposit} disabled={busy}>
                {busy ? "Generando…" : `Depositar ${bet.stakeSats} sats`}
              </Button>
            ) : (
              <div className="text-center">
                <p className="text-sm text-zinc-400">Pagá con Lightning · {mmss} restantes</p>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR" className="mx-auto mt-3 rounded-lg bg-white p-2" />
                ) : null}
                <button
                  onClick={() => navigator.clipboard.writeText(invoice)}
                  className="mt-3 w-full truncate rounded-md border border-white/15 px-3 py-2 font-mono text-xs text-zinc-300 hover:bg-white/5"
                >
                  {invoice}
                </button>
                {devMode ? (
                  <Button variant="outline" className="mt-3 w-full" onClick={simulate}>
                    Simular depósito (dev)
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : bet.status === "pending_deposits" ? (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
            <p className="text-sm text-zinc-300">Esperando jugadores…</p>
            <p className="mt-1 text-2xl font-bold text-sky-400">{paidCount} / {total}</p>
            <p className="mt-1 text-xs text-zinc-500">{mmss} para completar</p>
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
            <p className="text-sm font-medium text-emerald-400">¡Todos depositaron — a jugar!</p>
            <p className="mt-1 text-xs text-zinc-500">Esperando el resultado del juego…</p>
          </div>
        )}
      </div>
    </div>
  );
}
