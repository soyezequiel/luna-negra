"use client";

import { useCallback, useEffect, useState } from "react";
import type { BalAuthorization } from "nostr-game-protocol/bal";
import {
  BAL_AUTHORIZATIONS_CHANGED,
  listBalAuthorizations,
  revokeBalAuthorization,
} from "@/lib/bal-launcher";

export function BalAuthorizationsSection() {
  const [records, setRecords] = useState<BalAuthorization[]>(() =>
    listBalAuthorizations().filter((record) => record.expiresAt > Date.now()),
  );
  const refresh = useCallback(() => setRecords(listBalAuthorizations().filter((record) => record.expiresAt > Date.now())), []);

  useEffect(() => {
    queueMicrotask(refresh);
    window.addEventListener(BAL_AUTHORIZATIONS_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(BAL_AUTHORIZATIONS_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  return (
    <section className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
      <h2 className="text-[15px] font-semibold text-ln-text">Inicio automático en juegos</h2>
      <p className="mt-1 text-sm text-ln-muted">
        Autorizaciones BAL recordadas. Revocarlas cierra también las sesiones activas.
      </p>
      {records.length === 0 ? (
        <p className="mt-4 text-sm text-ln-faint">No hay juegos autorizados.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {records.map((record) => (
            <li key={record.id} className="flex items-start justify-between gap-3 border-t border-ln-border pt-3 first:border-0 first:pt-0">
              <div className="min-w-0">
                <p className="font-medium text-ln-text">{record.gameName}</p>
                <p className="truncate text-xs text-ln-faint">{record.origin}</p>
                <p className="mt-1 text-xs text-ln-muted">
                  {record.permissions.length} permisos · vence {new Date(record.expiresAt).toLocaleDateString("es-AR")}
                </p>
              </div>
              <button type="button" className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => void revokeBalAuthorization(record.id).then(refresh)}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
