// Notificaciones a Discord vía webhook entrante. Se usa para avisar al equipo de
// eventos operativos (p. ej. un juego nuevo enviado a revisión).
//
// Patrón igual que email.ts: si no hay `DISCORD_WEBHOOK_URL`, en dev se loguea a
// la consola y en prod es un no-op. NUNCA lanza: una notificación que falla no
// debe romper la acción del usuario que la disparó.

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

const VIOLETA = 0x7c3aed; // acento de marca de Luna Negra

/** Envía un mensaje con embeds al webhook de Discord, si está configurado. */
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
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds }),
    });
    if (!res.ok) {
      console.error(
        `[discord] webhook respondió ${res.status}: ${await res.text().catch(() => "")}`,
      );
    }
  } catch (err) {
    console.error("[discord] error enviando webhook:", err);
  }
}

/** Recorta texto largo para que entre en un embed sin romper el límite. */
function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Aviso de un juego nuevo enviado a revisión. */
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
