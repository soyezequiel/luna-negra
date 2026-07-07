import { categoryLabel } from "@/lib/categories";

type DiscordEmbedField = { name: string; value: string; inline?: boolean };

type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
};

type OperationalErrorArgs = {
  source: string;
  error: unknown;
  context?: Record<string, unknown>;
  fingerprint?: string;
  cooldownMs?: number;
};

type NonSocialZapArgs = {
  /** Flujo donde ocurrió: "depósito", "payout al ganador", "refund", "corte del dev"… */
  flow: string;
  /** Explicación en lenguaje claro de por qué el zap NO fue social (sin recibo 9735). */
  reason: string;
  context?: Record<string, unknown>;
  fingerprint?: string;
  cooldownMs?: number;
};

type BetPaymentDiagnosticArgs = {
  source: string;
  stage: string;
  context?: Record<string, unknown>;
  fingerprint?: string;
  cooldownMs?: number;
};

const VIOLETA = 0x7c3aed;
const ROJO = 0xdc2626;
const AMBAR = 0xf59e0b;
const DEFAULT_ALERT_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_BET_PAYMENT_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1517597347767521360/gXXREmf8vApvoN1at3FDFn5Ir4skS_KRx8fJU_MJc6nhOgPY9_f0-BQzo-AWcJobS_Oe";
const alertTimestamps = new Map<string, number>();

function truncate(text: string, max: number): string {
  const value = text.trim();
  return value.length > max ? `${value.slice(0, max - 3).trimEnd()}...` : value;
}

function redactSecrets(text: string): string {
  return text
    .replace(
      /https:\/\/(?:canary\.)?(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[^\s"']+/gi,
      "[discord-webhook-redacted]",
    )
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:nsec1|ln_sk_)[a-z0-9_-]+/gi, "[secret-redacted]")
    .replace(/nostr\+walletconnect:\/\/[^\s"']+/gi, "[nwc-redacted]");
}

function serializeContext(context: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  try {
    return redactSecrets(
      JSON.stringify(
        context,
        (_key, value: unknown) => {
          if (typeof value === "bigint") return value.toString();
          if (value instanceof Error) {
            return { name: value.name, message: value.message };
          }
          if (value && typeof value === "object") {
            if (seen.has(value)) return "[circular]";
            seen.add(value);
          }
          return value;
        },
        2,
      ),
    );
  } catch {
    return redactSecrets(String(context));
  }
}

function errorDetails(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: redactSecrets(error.message || "Error sin mensaje"),
      stack: error.stack ? redactSecrets(error.stack) : undefined,
    };
  }
  if (typeof error === "string") {
    return { name: "Error", message: redactSecrets(error) };
  }
  return { name: "Error", message: truncate(serializeContext({ error }), 1_000) };
}

function shouldSendAlert(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const previous = alertTimestamps.get(key);
  if (previous != null && now - previous < cooldownMs) return false;
  alertTimestamps.set(key, now);

  if (alertTimestamps.size > 500) {
    const cutoff = now - Math.max(cooldownMs, DEFAULT_ALERT_COOLDOWN_MS) * 2;
    for (const [entryKey, timestamp] of alertTimestamps) {
      if (timestamp < cutoff) alertTimestamps.delete(entryKey);
    }
  }
  return true;
}

async function postDiscordWebhook(
  url: string,
  content: string,
  embeds?: DiscordEmbed[],
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        embeds,
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.error(
        `[discord] webhook respondio ${res.status}: ${await res.text().catch(() => "")}`,
      );
    }
  } catch (error) {
    console.error("[discord] error enviando webhook:", error);
  }
}

/** Envia un aviso general al webhook del equipo, si esta configurado. */
export async function sendDiscordNotification(
  content: string,
  embeds?: DiscordEmbed[],
): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`\n[discord] ${content}\n`);
    }
    return;
  }
  await postDiscordWebhook(url, content, embeds);
}

/**
 * Reporta fallos operativos sin propagar errores al flujo principal. Alertas con
 * la misma huella se agrupan durante cinco minutos para evitar tormentas.
 */
export async function notifyOperationalError(args: OperationalErrorArgs): Promise<void> {
  const details = errorDetails(args.error);
  const key = args.fingerprint ?? `${args.source}:${details.name}:${details.message}`;
  if (!shouldSendAlert(key, args.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS)) return;

  const url =
    process.env.DISCORD_ALERT_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[discord-alert] ${args.source}: ${details.message}`);
    }
    return;
  }

  const fields: DiscordEmbedField[] = [
    { name: "Origen", value: truncate(args.source, 1_024), inline: true },
    {
      name: "Entorno",
      value: truncate(
        process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "desconocido",
        1_024,
      ),
      inline: true,
    },
    {
      name: details.name,
      value: truncate(details.message, 1_024),
    },
  ];
  if (args.context && Object.keys(args.context).length > 0) {
    fields.push({
      name: "Contexto",
      value: `\`\`\`json\n${truncate(serializeContext(args.context), 950)}\n\`\`\``,
    });
  }
  if (details.stack) {
    fields.push({
      name: "Stack",
      value: `\`\`\`\n${truncate(details.stack, 950)}\n\`\`\``,
    });
  }

  await postDiscordWebhook(url, "Fallo operativo en Luna Negra", [
    {
      title: truncate(`${details.name} en ${args.source}`, 256),
      color: ROJO,
      fields,
      timestamp: new Date().toISOString(),
    },
  ]);
}

/**
 * Avisa que un pago que DEBÍA ser un zap social NIP-57 (recibo 9735 público)
 * terminó no siéndolo: cayó al riel LNURL normal, no se pudo publicar el recibo,
 * o nunca apareció en los relays. La plata igual se movió; lo que se pierde es la
 * visibilidad social. Va a un webhook dedicado (DISCORD_ZAP_WEBHOOK_URL) para no
 * mezclarse con los errores operativos; si no está, cae al de alertas y luego al
 * general. Mismo dedup/cooldown que notifyOperationalError.
 */
export async function notifyNonSocialZap(args: NonSocialZapArgs): Promise<void> {
  const key = args.fingerprint ?? `non-social-zap:${args.flow}:${args.reason}`;
  if (!shouldSendAlert(key, args.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS)) return;

  const url =
    process.env.DISCORD_ZAP_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_ALERT_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[zap-no-social] ${args.flow}: ${redactSecrets(args.reason)}`);
    }
    return;
  }

  const fields: DiscordEmbedField[] = [
    { name: "Flujo", value: truncate(args.flow, 1_024), inline: true },
    {
      name: "Entorno",
      value: truncate(
        process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "desconocido",
        1_024,
      ),
      inline: true,
    },
    { name: "Por qué no fue social", value: truncate(redactSecrets(args.reason), 1_024) },
  ];
  if (args.context && Object.keys(args.context).length > 0) {
    fields.push({
      name: "Contexto",
      value: `\`\`\`json\n${truncate(serializeContext(args.context), 950)}\n\`\`\``,
    });
  }

  await postDiscordWebhook(url, "⚡ Zap no social en Luna Negra", [
    {
      title: truncate(`Zap no social — ${args.flow}`, 256),
      color: AMBAR,
      fields,
      timestamp: new Date().toISOString(),
    },
  ]);
}

/** Aviso de un juego nuevo enviado a revisión. */
export async function notifyBetPaymentDiagnostic(args: BetPaymentDiagnosticArgs): Promise<void> {
  if (!shouldSendBetPaymentDiagnostic(args)) return;
  const key = args.fingerprint ?? `bet-payment:${args.source}:${args.stage}`;
  if (!shouldSendAlert(key, args.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS)) return;

  const url =
    process.env.DISCORD_BET_PAYMENT_WEBHOOK_URL?.trim() ||
    DEFAULT_BET_PAYMENT_WEBHOOK_URL ||
    process.env.DISCORD_ALERT_WEBHOOK_URL?.trim() ||
    process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[bet-payment-diagnostic] ${args.source}:${args.stage}`);
    }
    return;
  }

  const fields: DiscordEmbedField[] = [
    { name: "Origen", value: truncate(args.source, 1_024), inline: true },
    { name: "Etapa", value: truncate(args.stage, 1_024), inline: true },
    {
      name: "Entorno",
      value: truncate(
        process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "desconocido",
        1_024,
      ),
      inline: true,
    },
  ];
  if (args.context && Object.keys(args.context).length > 0) {
    fields.push({
      name: "Contexto",
      value: `\`\`\`json\n${truncate(serializeContext(args.context), 950)}\n\`\`\``,
    });
  }

  await postDiscordWebhook(url, "Diagnóstico automático de pago Luna Negra", [
    {
      title: truncate(`Pago ${args.stage} - ${args.source}`, 256),
      color: AMBAR,
      fields,
      timestamp: new Date().toISOString(),
    },
  ]);
}

function shouldSendBetPaymentDiagnostic(args: BetPaymentDiagnosticArgs): boolean {
  switch (args.stage) {
    case "invoice-reused":
    case "invoice-lost-race":
    case "invoice-issued":
    case "lnurl-invoice-response":
      return false;
    case "poll-checked":
    case "sync-checked":
      return Number(args.context?.settled ?? 0) > 0;
    default:
      return true;
  }
}

export async function notifyGameSubmitted(args: {
  title: string;
  providerName: string;
  priceSats: number;
  description: string;
  categories: string[];
  adminUrl: string;
}): Promise<void> {
  const price = args.priceSats === 0 ? "Gratis" : `${args.priceSats} sats`;
  const categorias = args.categories.length
    ? args.categories.map(categoryLabel).join(", ")
    : "Sin categoría";
  const descripcion = args.description.trim()
    ? truncate(args.description, 300)
    : "_(sin descripción)_";

  await sendDiscordNotification("🎮 Nuevo juego enviado a revisión", [
    {
      title: args.title,
      url: args.adminUrl,
      color: VIOLETA,
      description: descripcion,
      fields: [
        { name: "Proveedor", value: args.providerName, inline: true },
        { name: "Precio", value: price, inline: true },
        { name: "Categorías", value: categorias, inline: false },
        {
          name: "Revisar",
          value: `[Aprobar o rechazar en el panel](${args.adminUrl})`,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    },
  ]);
}
