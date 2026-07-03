import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { computeEconomics, publicBetStatus } from "@/lib/escrow-math";
import { BET_FEE_MIN_MSAT } from "@/lib/escrow-v2-config";
import { msatToSats } from "@/lib/money";
import { ZapDepositCard } from "@/components/zap-deposit-card";

// Página de una apuesta v2 (namespace propio, no choca con /bets/[id] de v1).
// Depósitos: zaps públicos anclados al contrato. Premio: profile-zap al ganador.
// Acá se ve el contrato, el estado del pozo, la tarjeta de depósito del propio
// jugador y, al liquidarse, links a los recibos 9735 y a la nota de liquidación.

const STATUS_LABEL: Record<string, string> = {
  pending_deposits: "Esperando depósitos",
  funded: "Pozo completo · en juego",
  settled: "Liquidada",
  refunded: "Reembolsada",
  cancelled: "Cancelada",
  expired: "Expirada",
};

const njump = (id: string) => `https://njump.me/${id}`;
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;

export default async function ApuestaV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bet = await prisma.zapBet.findUnique({
    where: { id },
    include: {
      game: { select: { title: true, slug: true } },
      participants: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!bet) notFound();

  const session = await getSession();
  const me = session
    ? bet.participants.find((p) => p.pubkey === session.pubkey)
    : undefined;

  const sats = (msat: bigint) => Number(msatToSats(msat));
  const econ = computeEconomics({
    stakeMsat: bet.stakeMsat,
    participantCount: bet.participants.length,
    feePct: bet.feePct,
    devFeePct: bet.devFeePct,
    feeMinMsat: BET_FEE_MIN_MSAT,
  });
  const status = publicBetStatus(bet.status);
  const paidCount = bet.participants.filter((p) => p.depositStatus === "paid").length;
  const depositOpen =
    bet.status === "pending_deposits" &&
    (bet.depositDeadline == null || bet.depositDeadline > new Date());
  const anchorReal = !!bet.anchorEventId && !bet.anchorEventId.startsWith("dev-anchor-");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-ln-xl border border-ln-border bg-ln-card p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-ln-faint">Apuesta ⚡ v2</p>
            <h1 className="mt-1 font-display text-xl font-bold text-white">
              {bet.game.title}
            </h1>
          </div>
          <span className="rounded-ln-lg border border-ln-corona/40 bg-ln-corona/10 px-3 py-1 text-xs font-semibold text-ln-corona-bright">
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        <p className="mt-3 text-sm text-ln-muted">
          {bet.victoryCondition || "Gana según el juego."} El ganador se lleva el pozo
          menos {bet.feePct}% de la casa
          {bet.devFeePct > 0 ? ` + ${bet.devFeePct}% del desarrollador` : ""}. Todo se
          mueve por zaps públicos.
        </p>

        {/* Economía */}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-ln-faint">Stake</dt>
            <dd className="font-semibold text-ln-text">{sats(bet.stakeMsat)} sats</dd>
          </div>
          <div>
            <dt className="text-ln-faint">Pozo</dt>
            <dd className="font-semibold text-ln-text">{sats(econ.potMsat)} sats</dd>
          </div>
          <div>
            <dt className="text-ln-faint">Premio neto</dt>
            <dd className="font-semibold text-ln-text">{sats(econ.netMsat)} sats</dd>
          </div>
          <div>
            <dt className="text-ln-faint">Depósitos</dt>
            <dd className="font-semibold text-ln-text">
              {paidCount}/{bet.participants.length}
            </dd>
          </div>
        </dl>

        {anchorReal ? (
          <a
            href={njump(bet.anchorEventId!)}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-xs text-ln-corona-bright hover:underline"
          >
            📜 Ver contrato en Nostr ({short(bet.anchorEventId!)})
          </a>
        ) : null}
      </div>

      {/* Tarjeta de depósito del propio jugador */}
      {me && depositOpen && me.depositStatus !== "paid" ? (
        <div className="mt-4">
          <ZapDepositCard betId={bet.id} stakeSats={sats(bet.stakeMsat)} />
        </div>
      ) : null}
      {me && me.depositStatus === "paid" && bet.status === "pending_deposits" ? (
        <p className="mt-4 rounded-ln-lg border border-ln-corona/40 bg-ln-corona/10 p-3 text-center text-sm text-ln-corona-bright">
          ✅ Ya depositaste. Esperando al resto de los jugadores.
        </p>
      ) : null}

      {/* Participantes */}
      <div className="mt-4 rounded-ln-xl border border-ln-border bg-ln-card p-6">
        <h2 className="font-display text-sm font-bold text-white">Participantes</h2>
        <ul className="mt-3 space-y-2">
          {bet.participants.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-ln-lg border border-ln-border/60 px-3 py-2 text-sm"
            >
              <span className="truncate font-mono text-xs text-ln-muted">
                {short(p.npub)}
                {me?.id === p.id ? " (vos)" : ""}
              </span>
              <span className="flex items-center gap-2">
                {p.result === "won" ? (
                  <span className="text-ln-corona-bright">🏆 ganó</span>
                ) : p.result === "tie" ? (
                  <span className="text-ln-muted">= empate</span>
                ) : p.result === "lost" ? (
                  <span className="text-ln-faint">perdió</span>
                ) : null}
                <span
                  className={
                    p.depositStatus === "paid"
                      ? "text-ln-corona-bright"
                      : "text-ln-faint"
                  }
                >
                  {p.depositStatus === "paid" ? "✅ depositó" : "⏳ pendiente"}
                </span>
                {p.depositReceiptId ? (
                  <a
                    href={njump(p.depositReceiptId)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-ln-corona-bright hover:underline"
                    title="Recibo del zap de depósito"
                  >
                    ⚡
                  </a>
                ) : null}
                {p.commentEventId ? (
                  <a
                    href={njump(p.commentEventId)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-ln-muted hover:underline"
                    title="Comentario de participación (el premio se zapea acá si gana)"
                  >
                    💬
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Liquidación */}
      {status === "settled" || status === "refunded" ? (
        <div className="mt-4 rounded-ln-xl border border-ln-border bg-ln-card p-6">
          <h2 className="font-display text-sm font-bold text-white">
            {status === "settled" ? "🏆 Resultado" : "↩️ Reembolso"}
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {bet.participants
              .filter((p) => p.payoutMsat != null)
              .map((p) => (
                <li key={p.id} className="rounded-ln-lg border border-ln-border/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-xs text-ln-muted">
                      {short(p.npub)}
                    </span>
                    <span className="flex items-center gap-2 text-ln-text">
                      {sats(p.payoutMsat as bigint)} sats
                      <span className="text-xs text-ln-faint">
                        {p.payoutStatus === "paid"
                          ? `vía ${p.payoutKind}`
                          : p.payoutStatus === "withdraw_pending"
                            ? "· retiro por QR"
                            : `· ${p.payoutStatus}`}
                      </span>
                      {p.payoutReceiptId ? (
                        <a
                          href={njump(p.payoutReceiptId)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ln-corona-bright hover:underline"
                          title="Recibo del zap de premio"
                        >
                          ⚡
                        </a>
                      ) : null}
                    </span>
                  </div>
                  {p.payoutStatus === "paid" && p.payoutDestination ? (
                    <p className="mt-1 text-xs text-ln-faint">
                      💸 Llegó a{" "}
                      <span className="font-mono text-ln-muted">{p.payoutDestination}</span>
                      {p.payoutKind === "zap" ? (
                        <span className="text-ln-faint"> · zap NIP-57 (recibo público)</span>
                      ) : p.payoutKind === "lnurl" ? (
                        <span className="text-ln-faint"> · pago LNURL (sin recibo Nostr)</span>
                      ) : null}
                    </p>
                  ) : p.payoutStatus === "withdraw_pending" ? (
                    <p className="mt-1 text-xs text-ln-faint">
                      🎟️ Sin wallet configurada: el premio espera retiro por QR.
                    </p>
                  ) : null}
                </li>
              ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            {bet.settleNoteId ? (
              <a
                href={njump(bet.settleNoteId)}
                target="_blank"
                rel="noreferrer"
                className="text-ln-corona-bright hover:underline"
              >
                🧾 Nota de liquidación
              </a>
            ) : null}
            {bet.resultEventId ? (
              <a
                href={njump(bet.resultEventId)}
                target="_blank"
                rel="noreferrer"
                className="text-ln-corona-bright hover:underline"
              >
                📣 Evento de resultado
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6 text-center">
        <Link href={`/game/${bet.game.slug}`} className="text-xs text-ln-faint hover:text-ln-text">
          ← Volver al juego
        </Link>
      </div>
    </main>
  );
}
