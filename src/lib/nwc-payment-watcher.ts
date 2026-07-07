import { NWCClient, type Nip47Notification, type Nip47Transaction } from "@getalby/sdk";
import { prisma } from "@/lib/prisma";
import { checkAndSettleDepositV2 } from "@/lib/zap-bet";
import { lightningConfigured } from "@/lib/lightning";
import { BETS_V2_ENABLED } from "@/lib/escrow-v2-config";
import { notifyOperationalError } from "@/lib/discord";
import { settleNgpBetDepositByPaymentHash } from "@/lib/ngp-bet-deposit-sync";

const WATCHER_ENABLED = process.env.NWC_PAYMENT_WATCHER_ENABLED !== "false";
const POLL_INTERVAL_MS = Math.max(
  750,
  Number(process.env.NWC_PAYMENT_WATCHER_POLL_MS ?? 1000),
);
const ERROR_COOLDOWN_MS = 10 * 60_000;

const NWC_URLS = [
  process.env.NWC_CONNECTION_STRING,
  process.env.NWC_CONNECTION_STRING_FALLBACK,
].filter((u): u is string => Boolean(u));

type WatcherState = {
  started: boolean;
  stops: Array<() => void>;
  notificationIds: Set<string>;
  settlingHashes: Set<string>;
  polling: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
};

declare global {
  var lunaNwcPaymentWatcher: WatcherState | undefined;
}

function state(): WatcherState {
  globalThis.lunaNwcPaymentWatcher ??= {
    started: false,
    stops: [],
    notificationIds: new Set(),
    settlingHashes: new Set(),
    polling: false,
    pollTimer: null,
  };
  return globalThis.lunaNwcPaymentWatcher;
}

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

async function settleNotificationPayment(tx: Nip47Transaction): Promise<void> {
  const paymentHash = tx.payment_hash?.trim();
  if (!paymentHash) return;
  if (tx.state && tx.state !== "settled") return;

  const s = state();
  if (s.settlingHashes.has(paymentHash)) return;
  s.settlingHashes.add(paymentHash);
  try {
    const settled = await settleNgpBetDepositByPaymentHash(paymentHash, "webhook");
    if (settled) {
      console.log(`[nwc-payment-watcher] depósito ${shortHash(paymentHash)} confirmado por notification`);
    }
  } catch (error) {
    await notifyOperationalError({
      source: "nwc-payment-notification",
      error,
      fingerprint: `nwc-payment-notification:${paymentHash}`,
      cooldownMs: ERROR_COOLDOWN_MS,
      context: { paymentHash },
    });
  } finally {
    s.settlingHashes.delete(paymentHash);
  }
}

function handleNotification(notification: Nip47Notification): void {
  if (notification.notification_type !== "payment_received") return;
  const tx = notification.notification;
  const paymentHash = tx.payment_hash?.trim();
  if (!paymentHash) return;
  const id = `${notification.notification_type}:${paymentHash}:${tx.settled_at ?? tx.created_at ?? ""}`;
  const s = state();
  if (s.notificationIds.has(id)) return;
  s.notificationIds.add(id);
  if (s.notificationIds.size > 2000) {
    const first = s.notificationIds.values().next().value;
    if (first) s.notificationIds.delete(first);
  }
  void settleNotificationPayment(tx);
}

async function subscribeWalletNotifications(url: string, index: number): Promise<void> {
  const client = new NWCClient({ nostrWalletConnectUrl: url });
  const info = await client.getWalletServiceInfo().catch((error) => {
    console.warn(`[nwc-payment-watcher] no se pudo leer info de wallet#${index}:`, error);
    return null;
  });
  const supportsNotifications =
    info?.capabilities.includes("notifications") ||
    info?.notifications.includes("payment_received");
  if (!supportsNotifications) {
    console.warn(`[nwc-payment-watcher] wallet#${index} no anuncia notifications; queda polling fallback`);
    client.close();
    return;
  }

  const unsubscribe = await client.subscribeNotifications(handleNotification, ["payment_received"]);
  state().stops.push(() => {
    unsubscribe();
    client.close();
  });
  console.log(`[nwc-payment-watcher] escuchando payment_received en wallet#${index}`);
}

async function pollPendingDepositsOnce(): Promise<void> {
  const s = state();
  if (s.polling) return;
  s.polling = true;
  try {
    const pending = await prisma.zapBetParticipant.findMany({
      where: {
        depositStatus: "pending",
        depositPaymentHash: { not: null },
        bet: { status: "pending_deposits" },
      },
      select: { id: true, depositPaymentHash: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    for (const part of pending) {
      if (!part.depositPaymentHash || part.depositPaymentHash.startsWith("dev-")) continue;
      await checkAndSettleDepositV2(part.id).catch(async (error) => {
        await notifyOperationalError({
          source: "nwc-payment-watcher-poll",
          error,
          fingerprint: `nwc-payment-watcher-poll:${part.id}`,
          cooldownMs: ERROR_COOLDOWN_MS,
          context: { participantId: part.id },
        });
      });
    }
  } finally {
    s.polling = false;
  }
}

export async function startNwcPaymentWatcher(): Promise<void> {
  const s = state();
  if (s.started) return;
  if (!WATCHER_ENABLED || !BETS_V2_ENABLED || !lightningConfigured() || NWC_URLS.length === 0) return;
  s.started = true;

  await Promise.allSettled(
    NWC_URLS.map((url, index) => subscribeWalletNotifications(url, index)),
  );

  s.pollTimer = setInterval(() => {
    void pollPendingDepositsOnce();
  }, POLL_INTERVAL_MS);
  s.pollTimer.unref?.();
  setTimeout(() => void pollPendingDepositsOnce(), 1000).unref?.();
  console.log(`[nwc-payment-watcher] fallback polling cada ${POLL_INTERVAL_MS}ms`);
}

export function stopNwcPaymentWatcherForTests(): void {
  const s = state();
  for (const stop of s.stops.splice(0)) stop();
  if (s.pollTimer) clearInterval(s.pollTimer);
  s.pollTimer = null;
  s.started = false;
  s.notificationIds.clear();
  s.settlingHashes.clear();
  s.polling = false;
}
