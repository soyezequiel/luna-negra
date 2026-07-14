"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  getBalSignerStatusServerSnapshot,
  getBalSignerStatusSnapshot,
  subscribeBalSignerStatus,
  type BalSignerPhase,
} from "@/lib/bal-signer-status";

const PHASE_COPY: Record<Exclude<BalSignerPhase, "idle">, string> = {
  connecting: "Conectando signer",
  reconnecting: "Reconectando signer",
  awaiting_approval: "Esperando permiso",
  connected: "Signer conectado",
  signing: "Firmando evento",
  encrypting: "Cifrando datos",
  decrypting: "Descifrando datos",
  signed: "Firma lista",
  disconnecting: "Desconectando",
  disconnected: "Signer desconectado",
  rejected: "Solicitud rechazada",
  error: "Error del signer",
};

function SignerGlyph({ phase }: { phase: Exclude<BalSignerPhase, "idle"> }) {
  const spinning = phase === "connecting" || phase === "reconnecting" || phase === "signing"
    || phase === "encrypting" || phase === "decrypting" || phase === "disconnecting";
  const connected = phase === "connected" || phase === "signed";
  const alert = phase === "rejected" || phase === "error";

  return (
    <span className="relative grid size-5 shrink-0 place-items-center" aria-hidden>
      {connected ? (
        <span className="absolute inset-0 rounded-full border border-current opacity-70 motion-safe:animate-ping" />
      ) : null}
      {spinning ? (
        <span className="absolute inset-0 rounded-full border border-current border-r-transparent motion-safe:animate-spin" />
      ) : (
        <span className={cn(
          "absolute inset-0 rounded-full border border-current opacity-55",
          phase === "awaiting_approval" && "motion-safe:animate-pulse",
        )} />
      )}
      <span className={cn(
        "relative size-1.5 rounded-full bg-current",
        phase === "awaiting_approval" && "motion-safe:animate-pulse",
        alert && "size-auto bg-transparent text-[10px] font-black leading-none motion-safe:animate-bounce",
      )}>
        {alert ? "!" : null}
      </span>
    </span>
  );
}

/** Indicador global: sólo aparece cuando un juego usa (o intenta usar) a Luna como signer. */
export function BalSignerStatusIndicator() {
  const status = useSyncExternalStore(
    subscribeBalSignerStatus,
    getBalSignerStatusSnapshot,
    getBalSignerStatusServerSnapshot,
  );

  if (status.phase === "idle") return null;

  const phaseLabel = PHASE_COPY[status.phase];
  const isAlert = status.phase === "rejected" || status.phase === "error";
  const label = isAlert && status.detail ? status.detail : phaseLabel;
  const title = [phaseLabel, status.gameName, status.detail].filter(Boolean).join(" · ");
  const isWorking = status.phase === "connecting" || status.phase === "reconnecting"
    || status.phase === "signing" || status.phase === "encrypting"
    || status.phase === "decrypting" || status.phase === "disconnecting";
  const isHealthy = status.phase === "connected" || status.phase === "signed";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={title}
      title={title}
      className={cn(
        "flex h-8 min-w-8 shrink-0 items-center gap-2 rounded-full border px-1.5 text-[11px] font-semibold transition-colors min-[430px]:px-2.5",
        isHealthy && "border-ln-aurora/35 bg-ln-aurora/10 text-ln-aurora-bright",
        isWorking && "border-ln-luna/40 bg-ln-luna/10 text-ln-luna-bright",
        status.phase === "awaiting_approval" && "border-ln-corona/45 bg-ln-corona/10 text-ln-corona-bright",
        status.phase === "disconnected" && "border-ln-border-strong bg-white/[0.035] text-ln-muted",
        isAlert && "border-ln-danger/45 bg-ln-danger/10 text-ln-danger",
      )}
    >
      <SignerGlyph key={status.phase} phase={status.phase} />
      <span className="hidden max-w-[190px] truncate min-[430px]:inline">{label}</span>
      {status.activeSessions > 1 ? (
        <span className="hidden min-w-4 rounded-full bg-current/15 px-1 text-center font-mono text-[9px] ln:inline">
          {status.activeSessions}
        </span>
      ) : null}
    </div>
  );
}
