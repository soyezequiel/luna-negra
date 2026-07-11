import { prisma } from "@/lib/prisma";

/**
 * Ajuste global de la presencia "Jugando ahora". Vive en la fila singleton de
 * `PlatformSettings` (id="global"), igual que la economía y la tesorería.
 *
 * `clickPresenceEnabled` gobierna la presencia OPTIMISTA: la pestaña de la tienda
 * firma un estado NIP-38 "Jugando X" apenas el jugador toca "Jugar" y lo sostiene
 * ~30s aunque el juego nunca reporte que sigue en partida (ver playing-presence.ts).
 * Con la interfaz REST 1.0 retirada nada confirma esa presencia, así que en la
 * práctica hoy TODA presencia que publica la tienda es optimista. Apagándola, la
 * única señal de "jugando ahora" es la presencia NIP-38 que firma el propio juego
 * (NGP), detectada desde los relays por live-presence.ts.
 */

const SETTINGS_ID = "global";

export type PresenceSettings = {
  clickPresenceEnabled: boolean;
  updatedAt: Date | null;
};

function toSettings(
  row: { clickPresenceEnabled: boolean; updatedAt: Date } | null,
): PresenceSettings {
  return {
    // Sin config todavía = comportamiento actual (encendido).
    clickPresenceEnabled: row?.clickPresenceEnabled ?? true,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function getPresenceSettings(): Promise<PresenceSettings> {
  const row = await prisma.platformSettings.findUnique({
    where: { id: SETTINGS_ID },
  });
  return toSettings(row);
}

export async function updatePresenceSettings(input: {
  clickPresenceEnabled: boolean;
}): Promise<PresenceSettings> {
  const row = await prisma.platformSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, clickPresenceEnabled: input.clickPresenceEnabled },
    update: { clickPresenceEnabled: input.clickPresenceEnabled },
  });
  return toSettings(row);
}

export function presenceSettingsPayload(settings: PresenceSettings) {
  return {
    clickPresenceEnabled: settings.clickPresenceEnabled,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
  };
}
