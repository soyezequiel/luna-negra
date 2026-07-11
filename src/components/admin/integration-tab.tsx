"use client";

import { useCallback } from "react";
import {
  IntegrationMatrix,
  type IntegrationView,
  type ProbeResponse,
} from "@/components/provider/integration-matrix";

export function IntegrationTab({
  integrations,
  probeProvider,
}: {
  integrations: IntegrationView[];
  probeProvider: (providerId: string) => Promise<ProbeResponse>;
}) {
  const getProbe = useCallback(
    (providerId: string) => () => probeProvider(providerId),
    [probeProvider],
  );

  return (
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
  );
}
