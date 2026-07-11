"use client";

import { useCallback } from "react";
import {
  IntegrationMatrix,
  type IntegrationView,
  type ProbeResponse,
} from "@/components/provider/integration-matrix";
import type { PresenceSettings } from "./admin-types";

export function IntegrationTab({
  integrations,
  probeProvider,
  presence,
  presenceMsg,
  onTogglePresence,
  busy,
}: {
  integrations: IntegrationView[];
  probeProvider: (providerId: string) => Promise<ProbeResponse>;
  presence: PresenceSettings | null;
  presenceMsg: string | null;
  onTogglePresence: (enabled: boolean) => void;
  busy: string | null;
}) {
  const getProbe = useCallback(
    (providerId: string) => () => probeProvider(providerId),
    [probeProvider],
  );

  return (
    <div className="space-y-6">
      <PresenceCard
        presence={presence}
        presenceMsg={presenceMsg}
        onToggle={onTogglePresence}
        busy={busy}
      />

      <div>
        <h2 className="mb-1 font-semibold text-ink">Integración de juegos</h2>
        <p className="mb-4 text-xs text-faint">
          Qué tiene cableada cada juego en Nostr Games Protocol (NGP) y NGE.
          Verde = en uso reciente; naranja = visto hace tiempo; azul =
          declarado/disponible; gris = diseño o no integrado.
        </p>
        {integrations.length === 0 ? (
          <p className="text-muted">No hay proveedores.</p>
        ) : (
          <div className="space-y-6">
            {integrations.map((view) => (
              <div key={view.provider.id}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    {view.provider.name}
                    <span className="ml-2 text-xs font-normal text-faint">
                      {view.games.length} juego(s)
                      {view.provider.webhookConfigured ? " · webhook ✓" : ""}
                    </span>
                  </p>
                </div>
                <IntegrationMatrix
                  view={view}
                  compact
                  onProbe={getProbe(view.provider.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Interruptor de la presencia "optimista" al abrir un juego. Encendida (default),
 * la tienda firma un estado NIP-38 "Jugando X" apenas el jugador toca "Jugar" y lo
 * sostiene ~30s aunque el juego no reporte nada. Apagada, la única señal de
 * "jugando ahora" es la presencia NIP-38 que firma el propio juego (NGP).
 */
function PresenceCard({
  presence,
  presenceMsg,
  onToggle,
  busy,
}: {
  presence: PresenceSettings | null;
  presenceMsg: string | null;
  onToggle: (enabled: boolean) => void;
  busy: string | null;
}) {
  const enabled = presence?.clickPresenceEnabled ?? true;
  const saving = busy === "presence";

  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="font-semibold text-ink">Presencia «Jugando ahora»</h2>
      <p className="mt-1 text-xs text-faint">
        Con la presencia optimista, la tienda te marca como «Jugando X» apenas
        tocás «Jugar», por unos segundos, aunque el juego no confirme que seguís en
        partida. Si la apagás, la única señal es la presencia NIP-38 que firma el
        propio juego (NGP).
      </p>

      {presence ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={saving}
            onClick={() => onToggle(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              enabled ? "bg-[var(--win)]" : "bg-line"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-sm text-ink">
            Presencia optimista al abrir un juego:{" "}
            <span className="font-semibold">
              {saving ? "Guardando…" : enabled ? "Activada" : "Desactivada"}
            </span>
          </span>
          {presenceMsg ? (
            <span className="basis-full text-xs text-btc">{presenceMsg}</span>
          ) : null}
          {presence.updatedAt ? (
            <span className="basis-full text-[11px] text-faint">
              Actualizado {new Date(presence.updatedAt).toLocaleString("es-AR")}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-faint">Cargando ajuste…</p>
      )}
    </section>
  );
}
