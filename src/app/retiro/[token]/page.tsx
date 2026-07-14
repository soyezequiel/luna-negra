import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyWithdrawToken } from "@/lib/auth";
import { msatToSats } from "@/lib/money";
import { createWithdrawClaimLinks } from "@/lib/withdraw-claim";
import {
  WithdrawClaimCard,
  WithdrawStatusRefresh,
} from "@/components/withdraw-claim-card";

async function requestBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const proto = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function ClaimState({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-ln-xl border border-ln-border bg-ln-card p-6 text-center shadow-ln-modal">
      <p className="ln-label">Retiro Lightning</p>
      <h1 className="mt-1 font-display text-2xl font-extrabold text-white">{title}</h1>
      <p className="mt-2 text-sm text-ln-muted">{body}</p>
      <Link href="/bets" className="btn btn-ghost mt-5 w-full">
        Ver mis apuestas
      </Link>
    </section>
  );
}

export default async function WithdrawPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const participantId = await verifyWithdrawToken(token);
  if (!participantId) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <ClaimState
          title="Retiro vencido o inválido"
          body="Este enlace ya no está disponible. Revisá el estado de la apuesta en Luna Negra."
        />
      </main>
    );
  }

  const select = {
    payoutStatus: true,
    payoutMsat: true,
    withdrawDeadline: true,
  } as const;
  const participant =
    (await prisma.betParticipant.findUnique({ where: { id: participantId }, select })) ??
    (await prisma.zapBetParticipant.findUnique({ where: { id: participantId }, select }));

  if (!participant) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <ClaimState title="Retiro no encontrado" body="No encontramos el premio asociado a este enlace." />
      </main>
    );
  }

  if (participant.payoutStatus === "claimed") {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <ClaimState title="Premio cobrado ✓" body="La wallet recibió correctamente los sats de este retiro." />
      </main>
    );
  }

  if (participant.payoutStatus === "withdraw_claiming") {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <WithdrawStatusRefresh />
        <ClaimState
          title="Enviando tu premio…"
          body="Tu wallet entregó el invoice. Luna Negra está completando el pago Lightning."
        />
      </main>
    );
  }

  const deadline = participant.withdrawDeadline;
  if (
    participant.payoutStatus !== "withdraw_pending" ||
    !participant.payoutMsat ||
    !deadline ||
    deadline <= new Date()
  ) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <ClaimState title="Retiro no disponible" body="El premio no está pendiente de retiro o la ventana ya terminó." />
      </main>
    );
  }

  const links = await createWithdrawClaimLinks(participantId, deadline, await requestBaseUrl());
  if (!links) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-12">
        <ClaimState title="Retiro vencido" body="La ventana para cobrar este premio terminó." />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <WithdrawClaimCard
        token={links.token}
        lnurl={links.withdrawLnurl}
        amountSats={Number(msatToSats(participant.payoutMsat))}
        deadline={deadline.toISOString()}
      />
      <p className="mt-4 text-center text-xs text-ln-faint">
        Retiro servido por Luna Negra, aunque el juego no tenga pantalla de cobro.
      </p>
    </main>
  );
}
