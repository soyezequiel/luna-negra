"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  IntegrationMatrix,
  type IntegrationView,
  type ProbeResponse,
} from "@/components/provider/integration-matrix";

function Legend() {
  const items = [
    { dot: "bg-ln-aurora", label: "En uso (evento observado en relays)" },
    { dot: "bg-blue", label: "Declarado (integrado, no observable)" },
    { dot: "bg-blue/40", label: "Disponible / en diseño" },
    { dot: "bg-white/15", label: "No integrado" },
  ];
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-ln-muted">
          <span className={`inline-block h-2 w-2 rounded-full ${i.dot}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export default function ProviderIntegrationPage() {
  const { user, login, loading } = useSession();
  const [view, setView] = useState<IntegrationView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch("/api/provider/integracion")
      .then((r) => r.json())
      .catch(() => ({ view: null }));
    setView(d?.view ?? null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Carga inicial de datos al montar / cambiar de usuario.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void load();
  }, [user, load]);

  const onProbe = useCallback(async (): Promise<ProbeResponse> => {
    const d = await fetch("/api/provider/integracion/probe", { method: "POST" })
      .then((r) => r.json())
      .catch(() => ({ results: [], nostr: {} }));
    return { results: d?.results ?? [], nostr: d?.nostr ?? {} };
  }, []);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Integración</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para ver el estado de integración de tus juegos.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[920px] px-[22px] py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Integración
          </h1>
          <p className="mt-1 text-sm text-ln-muted">
            El estándar es <strong>Nostr Games Protocol (NGP)</strong> (NGP nativo: login NIP-07/46, marcador
            kind:31337, presencia NIP-38, reseñas NIP-23…), con <strong>Apuestas y escrow</strong> por zaps NIP-57 como
            opcional. El estado sale de los eventos Nostr observados en los relays. La <strong>interfaz Luna
            dependiente (1.0)</strong> se mantiene por compatibilidad: activá el toggle <em>«Interfaz Luna (1.0)»</em>{" "}
            para ver esa integración (REST, custodia, migración por capacidad).
          </p>
        </div>
        <Link href="/provider" className="btn btn-ghost shrink-0 self-start">
          Volver al panel
        </Link>
      </div>

      <div className="mt-5">
        <Legend />
      </div>

      <div className="mt-6">
        {!loaded ? (
          <p className="text-sm text-ln-faint">Cargando…</p>
        ) : !view ? (
          <p className="text-sm text-ln-faint">
            Creá tu perfil de proveedor en el{" "}
            <Link href="/provider" className="text-blue hover:underline">panel de proveedor</Link>{" "}
            para empezar.
          </p>
        ) : (
          <IntegrationMatrix view={view} onProbe={onProbe} editable />
        )}
      </div>

      <p className="mt-8 text-xs text-ln-faint">
        ¿Cómo integrar cada bloque? Mirá la{" "}
        <Link href="/dev" className="text-blue hover:underline">guía /dev</Link> y la{" "}
        <a href="/developers" className="text-blue hover:underline">referencia interactiva</a>.
      </p>
    </div>
  );
}
