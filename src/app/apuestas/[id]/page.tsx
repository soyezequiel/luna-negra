import { notFound } from "next/navigation";
import Link from "next/link";
import { nip19 } from "nostr-tools";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { computeEconomics, publicBetStatus } from "@/lib/escrow-math";
import { BET_FEE_MIN_MSAT } from "@/lib/escrow-v2-config";
import { RELAYS } from "@/lib/constants";
import { msatToSats } from "@/lib/money";
import { ZapDepositCard } from "@/components/zap-deposit-card";
import { BetLiveRefresh } from "@/components/bet-live-refresh";
import { BetDetailView } from "@/components/admin/bet-detail";
import { betDetailInclude, buildZapBetDetail } from "@/lib/bet-detail";
import { signWithdrawToken } from "@/lib/auth";

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
    include: betDetailInclude,
  });
  if (!bet) notFound();

  // Mismo detalle auditable que arma el panel admin (árbol de flujo de la plata,
  // tabla de participantes, ledger), pero server-side y sin gate: todos los datos
  // ya son públicos (zaps NIP-57). Alimenta el <BetDetailView> compartido.
  const detail = buildZapBetDetail(bet);

  const session = await getSession();
  const me = session
    ? bet.participants.find((p) => p.pubkey === session.pubkey)
    : undefined;
  const withdrawHref =
    me?.payoutStatus === "withdraw_pending" &&
    me.withdrawDeadline &&
    me.withdrawDeadline > new Date()
      ? `/retiro/${await signWithdrawToken(
          me.id,
          Math.floor(me.withdrawDeadline.getTime() / 1000),
        )}`
      : null;

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

  // Mientras la apuesta esté en curso (juntando depósitos o en juego), o
  // liquidada con premios aún por pagar/retirar, refrescamos el RSC cada pocos
  // segundos para que el estado de los participantes se actualice solo.
  const live =
    ["created", "pending_deposits", "ready", "settling"].includes(bet.status) ||
    (status === "settled" &&
      bet.participants.some((p) =>
        ["pending", "withdraw_pending", "failed"].includes(p.payoutStatus ?? ""),
      ));

  // El evento de resultado se linkea como `nevent` con relay-hints + autor +
  // kind-hint: las apuestas nuevas firman kind:1341 (spec NGP, regular); las
  // viejas el 30078 legado (app-data que el indexador de njump no levanta sin
  // el hint). El kind firmado quedó guardado en resultEventKind.
  const resultNevent = bet.resultEventId
    ? nip19.neventEncode({
        id: bet.resultEventId,
        relays: RELAYS.slice(0, 3),
        author: bet.provider.oraclePubkey ?? undefined,
        kind: bet.resultEventKind ?? 30078,
      })
    : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <BetLiveRefresh active={live} />

      {/* En desktop: resumen + acción a la izquierda (angosto), detalle ancho a
          la derecha. En móvil/tablet colapsa a una sola columna apilada. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* ── Columna izquierda: resumen del contrato + acción del jugador ── */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <div className="rounded-ln-xl border border-ln-border bg-ln-card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ln-faint">Apuesta ⚡ v2</p>
                <h1 className="mt-1 font-display text-xl font-bold text-white">
                  {bet.game.title}
                </h1>
              </div>
              <span className="shrink-0 rounded-ln-lg border border-ln-corona/40 bg-ln-corona/10 px-3 py-1 text-xs font-semibold text-ln-corona-bright">
                {STATUS_LABEL[status] ?? status}
              </span>
            </div>

            <p className="mt-3 text-sm text-ln-muted">
              {bet.victoryCondition || "Gana según el juego."} El ganador se lleva el pozo
              menos {bet.feePct}% de la casa
              {bet.devFeePct > 0 ? ` + ${bet.devFeePct}% del desarrollador` : ""}. Todo se
              mueve por zaps públicos.
            </p>

            {/* Economía: tarjetas de 2×2 para que respiren en la columna angosta */}
            <dl className="mt-4 grid grid-cols-2 gap-2.5 text-sm">
              {[
                { k: "Stake", v: `${sats(bet.stakeMsat)} sats` },
                { k: "Pozo", v: `${sats(econ.potMsat)} sats` },
                { k: "Premio neto", v: `${sats(econ.netMsat)} sats`, hi: true },
                { k: "Depósitos", v: `${paidCount}/${bet.participants.length}` },
              ].map((s) => (
                <div
                  key={s.k}
                  className="rounded-ln-lg border border-ln-border bg-ln-bg-deep/50 px-3 py-2"
                >
                  <dt className="text-[11px] text-ln-faint">{s.k}</dt>
                  <dd
                    className={`mt-0.5 font-semibold ${s.hi ? "text-ln-corona-bright" : "text-ln-text"}`}
                  >
                    {s.v}
                  </dd>
                </div>
              ))}
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
            <ZapDepositCard betId={bet.id} stakeSats={sats(bet.stakeMsat)} />
          ) : null}
          {me && me.depositStatus === "paid" && bet.status === "pending_deposits" ? (
            <p className="rounded-ln-lg border border-ln-corona/40 bg-ln-corona/10 p-3 text-center text-sm text-ln-corona-bright">
              ✅ Ya depositaste. Esperando al resto de los jugadores.
            </p>
          ) : null}
          {withdrawHref ? (
            <section className="rounded-ln-xl border border-ln-corona/40 bg-ln-corona/10 p-4 text-center shadow-ln-corona">
              <p className="font-display text-lg font-bold text-ln-corona-bright">
                🎟️ Tenés un premio para cobrar
              </p>
              <p className="mt-1 text-sm text-ln-muted">
                Luna Negra puede mostrarte el QR aunque el juego no lo implemente.
              </p>
              <Link href={withdrawHref} className="btn btn-corona mt-3 w-full">
                Mostrar QR de retiro
              </Link>
            </section>
          ) : null}
        </div>

        {/* ── Columna derecha: detalle completo (flujo de la plata, tabla de
            participantes con depósitos/cobros, ledger). Mismo componente que el
            panel admin, alimentado con datos públicos. Acá tiene el ancho que
            necesita el árbol/tabla en vez de scrollear apretado. ── */}
        <div className="min-w-0 rounded-ln-xl border border-ln-border bg-ln-card p-5 sm:p-6">
          <h2 className="font-display text-sm font-bold text-white">Detalle</h2>
          <BetDetailView d={detail} meNpub={me?.npub} />

          {(status === "settled" || status === "refunded") &&
          (bet.settleNoteId || resultNevent) ? (
            <div className="mt-3 flex flex-wrap gap-3 border-t border-ln-border pt-3 text-xs">
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
              {resultNevent ? (
                <a
                  href={njump(resultNevent)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ln-corona-bright hover:underline"
                >
                  📣 Evento de resultado
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-6 text-center">
        <Link href={`/game/${bet.game.slug}`} className="text-xs text-ln-faint hover:text-ln-text">
          ← Volver al juego
        </Link>
      </div>
    </main>
  );
}
