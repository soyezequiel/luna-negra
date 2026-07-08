"use client";

import { useEffect, useState } from "react";
import { nip19 } from "nostr-tools";
import { RELAYS } from "@/lib/constants";
import type {
  AdminBetDetail,
  AdminBetParticipant,
} from "@/lib/bet-detail";

// Detalle completo de una apuesta: contrato, tabla de participantes (quién
// depositó y cómo, quién ganó, cómo cobró), asientos del ledger y un árbol
// horizontal del flujo de la plata (apostadores → pozo → comisiones + ganador).
// Sirve v1 y v2; los campos de zap solo aparecen en v2.
//
// `BetDetailView` es la parte puramente presentacional (recibe el detalle ya
// armado): la usan el panel admin (vía el wrapper `BetDetail` que hace fetch) y
// la página pública /apuestas/[id] (que arma el detalle server-side).

function shortNpub(np: string) {
  return np.length > 20 ? `${np.slice(0, 12)}…${np.slice(-4)}` : np;
}
function shortId(id: string) {
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}
function nameOf(p: AdminBetParticipant) {
  return p.name?.trim() || shortNpub(p.npub);
}
function njump(eventId: string) {
  return `https://njump.me/${eventId}`;
}
// El evento de resultado se linkea como `nevent` con relay-hints y kind-hint:
// las apuestas nuevas firman kind:1341 (spec NGP) y las viejas el 30078 legado
// (app-data que el indexador de njump ignora sin el hint). El kind viene del
// detalle (resultEventKind).
function njumpResult(eventId: string, kind: number) {
  return `https://njump.me/${nip19.neventEncode({
    id: eventId,
    relays: RELAYS.slice(0, 3),
    kind,
  })}`;
}
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const DEPOSIT_LABEL: Record<string, string> = {
  paid: "pagó",
  pending: "pendiente",
  refunded: "reembolsado",
  failed: "falló",
};
const RESULT_LABEL: Record<string, string> = {
  won: "ganó",
  lost: "perdió",
  tie: "empate",
  pending: "sin resolver",
};
const PAYOUT_LABEL: Record<string, string> = {
  none: "—",
  pending: "pendiente",
  paid: "cobrado",
  failed: "falló",
  withdraw_pending: "retiro por QR",
  claimed: "cobrado (QR)",
  forfeited: "no reclamado",
};

// Wrapper del panel admin: trae el detalle del endpoint admin y lo pinta.
export function BetDetail({
  betId,
  version,
}: {
  betId: string;
  version: 1 | 2;
}) {
  const [d, setD] = useState<AdminBetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setD(null);
    setError(null);
    fetch(`/api/admin/bets/${betId}?v=${version}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se pudo cargar"))))
      .then((data) => alive && setD(data))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [betId, version]);

  if (error) return <p className="px-3 py-4 text-xs text-[var(--lose)]">{error}</p>;
  if (!d) return <p className="px-3 py-4 text-xs text-faint">Cargando detalle…</p>;

  return <BetDetailView d={d} />;
}

// Parte presentacional: recibe el detalle ya armado (sin fetch). `meNpub` marca
// al jugador que está mirando ("· vos") en la tabla de participantes.
export function BetDetailView({
  d,
  meNpub,
}: {
  d: AdminBetDetail;
  meNpub?: string | null;
}) {
  return (
    <div className="mt-3 space-y-4 border-t border-line pt-3">
      {/* Contrato / metadatos */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-3">
        <Field label="Pozo">
          <span className="font-mono text-btc">{d.potSats} sats</span>{" "}
          <span className="text-faint">({d.stakeSats} × {d.participants.length})</span>
        </Field>
        <Field label="Comisión">
          <span className="text-muted">
            casa {d.feePct}% · dev {d.devFeePct}%
          </span>
        </Field>
        <Field label="Sala">
          <span className="font-mono text-muted">{d.roomId ?? "—"}</span>
        </Field>
        <Field label="Creada">
          <span className="text-muted">{fmtTime(d.createdAt)}</span>
        </Field>
        <Field label="Liquidada">
          <span className="text-muted">{fmtTime(d.settledAt)}</span>
        </Field>
        <Field label="Gana">
          <span className="text-muted">{d.victoryCondition || "según el juego"}</span>
        </Field>
        <Field label="Contrato Nostr">
          {d.contractEventId ? (
            <a
              href={njump(d.contractEventId)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-blue hover:underline"
            >
              {shortId(d.contractEventId)} ↗
            </a>
          ) : (
            <span className="text-faint">—</span>
          )}
        </Field>
        <Field label="Resultado Nostr">
          {d.resultEventId ? (
            <a
              href={njumpResult(d.resultEventId, d.resultEventKind)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-blue hover:underline"
            >
              {shortId(d.resultEventId)} ↗
            </a>
          ) : (
            <span className="text-faint">—</span>
          )}
        </Field>
        <Field label="Hash términos">
          <span className="font-mono text-faint">
            {d.contractHash ? shortId(d.contractHash) : "—"}
          </span>
        </Field>
      </div>

      {/* Árbol de flujo */}
      <MoneyFlowTree d={d} />

      {/* Participantes */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[11px]">
          <thead className="text-faint">
            <tr className="border-b border-line">
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="py-1 pr-2 font-medium">Jugador</th>
              <th className="py-1 pr-2 font-medium">Depósito</th>
              <th className="py-1 pr-2 font-medium">Resultado</th>
              <th className="py-1 pr-2 font-medium">Cobro</th>
              <th className="py-1 font-medium">Destino / recibos</th>
            </tr>
          </thead>
          <tbody className="text-ink">
            {d.participants.map((p) => {
              const won = p.result === "won" || p.result === "tie";
              return (
                <tr key={p.npub} className="border-b border-line/50 align-top">
                  <td className="py-1.5 pr-2 text-faint">{p.seat}</td>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{nameOf(p)}</span>
                    {meNpub && p.npub === meNpub ? (
                      <span className="ml-1 text-[10px] text-btc">· vos</span>
                    ) : null}
                    <br />
                    <span className="font-mono text-[10px] text-faint">
                      {shortNpub(p.npub)}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Dot ok={p.deposit.status === "paid"} bad={p.deposit.status === "failed"} />
                    {DEPOSIT_LABEL[p.deposit.status] ?? p.deposit.status}
                    {p.deposit.kind ? (
                      <span className="ml-1 rounded bg-white/10 px-1 py-px text-[9px] text-muted">
                        {p.deposit.kind === "zap" ? "⚡ zap" : "invoice"}
                      </span>
                    ) : null}
                    {p.deposit.paidAt ? (
                      <div className="text-[10px] text-faint">{fmtTime(p.deposit.paidAt)}</div>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span
                      className={
                        won ? "text-[var(--win)]" : p.result === "lost" ? "text-faint" : "text-muted"
                      }
                    >
                      {won ? "🏆 " : ""}
                      {RESULT_LABEL[p.result] ?? p.result}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">
                    {p.payout.sats != null ? (
                      <span className="font-mono text-btc">{p.payout.sats} sats</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                    <div className="text-[10px] text-muted">
                      {PAYOUT_LABEL[p.payout.status] ?? p.payout.status}
                      {p.payout.kind ? ` · ${p.payout.kind}` : ""}
                    </div>
                  </td>
                  <td className="py-1.5">
                    {p.payout.destination &&
                    p.payout.destination !== "lnurl-withdraw" ? (
                      <div className="font-mono text-[10px] text-muted">
                        💸 {p.payout.destination}
                      </div>
                    ) : null}
                    {p.deposit.receiptId ? (
                      <a
                        href={njump(p.deposit.receiptId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block font-mono text-[10px] text-blue hover:underline"
                      >
                        depósito 9735: {shortId(p.deposit.receiptId)}
                        {p.deposit.receiptOk === false ? " ⚠" : ""} ↗
                      </a>
                    ) : null}
                    {p.payout.receiptId ? (
                      <a
                        href={njump(p.payout.receiptId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block font-mono text-[10px] text-blue hover:underline"
                      >
                        payout 9735: {shortId(p.payout.receiptId)} ↗
                      </a>
                    ) : null}
                    {p.payout.zapRequestId ? (
                      <div className="font-mono text-[10px] text-faint">
                        9734: {shortId(p.payout.zapRequestId)}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ledger */}
      {d.ledger.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium text-faint">Ledger</p>
          <div className="flex flex-wrap gap-1.5">
            {d.ledger.map((l, i) => (
              <span
                key={i}
                className="rounded border border-line bg-panel px-2 py-1 text-[10px]"
                title={`${l.status}${l.has9734 ? " · 9734" : ""}${l.has9735 ? " · 9735" : ""}`}
              >
                <span className="text-muted">{l.kind}</span>{" "}
                <span className="font-mono text-ink">{l.sats}</span>
                <Dot ok={l.status === "settled"} bad={l.status === "failed"} />
                {l.has9735 ? <span className="text-[var(--win)]">⚡</span> : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-faint">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Dot({ ok, bad }: { ok?: boolean; bad?: boolean }) {
  const color = bad ? "var(--lose)" : ok ? "var(--win)" : "var(--faint)";
  return (
    <span
      aria-hidden
      className="mx-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
      style={{ background: color }}
    />
  );
}

// ---------------------------------------------------------------------------
// Árbol horizontal del flujo de la plata: apostadores (izq) → pozo (centro) →
// comisiones + ganador(es) (der). Layout dinámico según cantidad de asientos.
// ---------------------------------------------------------------------------

type TreeNode = {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
  tone: "paid" | "pending" | "win" | "fee" | "pot";
};

function MoneyFlowTree({ d }: { d: AdminBetDetail }) {
  const NW = 190;
  const NH = 56;
  const VGAP = 12;
  const POT_W = 140;
  const POT_H = 92;
  const leftX = 6;
  const potX = 340;
  const rightX = 600;
  const margin = 10;

  const winners = d.participants.filter(
    (p) => p.result === "won" || p.result === "tie",
  );
  const fee = d.ledger.find((l) => l.kind === "fee");
  const devFee = d.ledger.find((l) => l.kind === "dev_fee");

  // Nodos derecha: ganador(es) grandes + comisiones chicas.
  const rightSpecs: { title: string; sub: string; tone: TreeNode["tone"]; h: number }[] = [];
  if (winners.length > 0) {
    for (const w of winners) {
      rightSpecs.push({
        title: `🏆 ${nameOf(w)}`,
        sub: w.payout.sats != null
          ? `cobró ${w.payout.sats} sats${w.payout.kind ? ` · ${w.payout.kind}` : ""}`
          : "sin cobrar aún",
        tone: "win",
        h: 62,
      });
    }
  } else {
    rightSpecs.push({ title: "Sin resolver", sub: "esperando resultado", tone: "pending", h: 62 });
  }
  if (fee) rightSpecs.push({ title: `Casa (${d.feePct}%)`, sub: `${fee.sats} sats`, tone: "fee", h: 42 });
  if (devFee)
    rightSpecs.push({ title: `Dev (${d.devFeePct}%)`, sub: `${devFee.sats} sats · ${d.providerName}`, tone: "fee", h: 42 });

  // Alturas de cada columna.
  const N = d.participants.length;
  const leftH = N * NH + (N - 1) * VGAP;
  const rightH = rightSpecs.reduce((s, r) => s + r.h, 0) + (rightSpecs.length - 1) * VGAP;
  const contentH = Math.max(leftH, rightH, POT_H);
  const svgH = contentH + margin * 2;
  const svgW = 800;

  // Posicionado vertical (centrado por columna).
  const leftNodes: TreeNode[] = d.participants.map((p, i) => ({
    x: leftX,
    y: margin + (contentH - leftH) / 2 + i * (NH + VGAP),
    w: NW,
    h: NH,
    title: nameOf(p),
    sub: `${d.stakeSats} sats · ${p.deposit.kind === "zap" ? "⚡ zap" : p.deposit.kind ?? "—"} · ${DEPOSIT_LABEL[p.deposit.status] ?? p.deposit.status}`,
    tone: p.deposit.status === "paid" ? "paid" : "pending",
  }));

  const pot: TreeNode = {
    x: potX,
    y: margin + (contentH - POT_H) / 2,
    w: POT_W,
    h: POT_H,
    title: `Pozo · ${d.potSats} sats`,
    sub: d.version === 2 ? "escrow · zaps NIP-57" : "escrow v1",
    tone: "pot",
  };

  let ry = margin + (contentH - rightH) / 2;
  const rightNodes: TreeNode[] = rightSpecs.map((r) => {
    const node: TreeNode = { x: rightX, y: ry, w: NW, h: r.h, title: r.title, sub: r.sub, tone: r.tone };
    ry += r.h + VGAP;
    return node;
  });

  const toneStroke: Record<TreeNode["tone"], string> = {
    paid: "var(--win)",
    pending: "var(--faint)",
    win: "var(--win)",
    fee: "var(--btc)",
    pot: "var(--btc)",
  };

  function edge(a: TreeNode, b: TreeNode, color: string, dashed: boolean, label: string) {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mx = (x1 + x2) / 2;
    const key = `${x1}-${y1}-${x2}-${y2}`;
    return (
      <g key={key}>
        <path
          d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 7},${y2}`}
          fill="none"
          stroke={color}
          strokeWidth={dashed ? 1.5 : 2.2}
          strokeDasharray={dashed ? "4 3" : undefined}
          markerEnd={color === "var(--win)" ? "url(#tw)" : "url(#tn)"}
        />
        {label ? (
          <text
            x={mx}
            y={(y1 + y2) / 2 - 4}
            textAnchor="middle"
            fontSize="10"
            fontFamily="var(--font-mono, monospace)"
            fill={color}
          >
            {label}
          </text>
        ) : null}
      </g>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel/50 p-2">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width="100%"
        style={{ maxWidth: svgW, minWidth: 560 }}
        role="img"
        aria-label="Árbol del flujo de la apuesta: apostadores, pozo, comisiones y ganador"
      >
        <defs>
          <marker id="tw" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--win)" />
          </marker>
          <marker id="tn" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--faint)" />
          </marker>
        </defs>

        {/* Edges: apostador → pozo */}
        {leftNodes.map((n, i) => {
          const p = d.participants[i];
          const paid = p.deposit.status === "paid";
          return edge(
            n,
            pot,
            paid ? "var(--win)" : "var(--faint)",
            !paid,
            `${d.stakeSats}`,
          );
        })}
        {/* Edges: pozo → ganador / comisiones */}
        {rightNodes.map((n, i) => {
          const spec = rightSpecs[i];
          const color = spec.tone === "win" ? "var(--win)" : "var(--faint)";
          const label =
            spec.tone === "win"
              ? winners[i]?.payout.sats != null
                ? `${winners[i].payout.sats}`
                : ""
              : spec.tone === "fee"
                ? spec.sub.split(" ")[0]
                : "";
          return edge(pot, n, color, spec.tone === "fee", label);
        })}

        {/* Nodos */}
        {[...leftNodes, pot, ...rightNodes].map((n, i) => (
          <g key={i}>
            <rect
              x={n.x}
              y={n.y}
              width={n.w}
              height={n.h}
              rx={10}
              fill={n.tone === "pot" ? "var(--panel-3)" : "var(--panel)"}
              stroke={toneStroke[n.tone]}
              strokeWidth={n.tone === "win" || n.tone === "pot" ? 2 : 1.4}
            />
            <text
              x={n.x + 12}
              y={n.y + (n.h > 50 ? 24 : 18)}
              fontSize="12.5"
              fontWeight={600}
              fill={n.tone === "win" ? "var(--win)" : "var(--ink)"}
            >
              {n.title}
            </text>
            <text
              x={n.x + 12}
              y={n.y + (n.h > 50 ? 42 : 34)}
              fontSize="10.5"
              fill="var(--muted)"
            >
              {n.sub}
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 px-1 text-[10px] text-faint">
        Verde = flujo del ganador (⚡ zap con recibo) · gris punteado = pendiente / comisiones
      </p>
    </div>
  );
}
