"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  IntegrationMatrix,
  type IntegrationView,
  type ProbeResult,
} from "@/components/provider/integration-matrix";

function Legend() {
  const items = [
    { dot: "bg-ln-aurora", label: "Integrado (con tráfico reciente)" },
    { dot: "bg-ln-corona", label: "Sin tráfico reciente / configurado sin uso" },
    { dot: "bg-white/20", label: "No integrado" },
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

  const onProbe = useCallback(async (): Promise<ProbeResult[]> => {
    const d = await fetch("/api/provider/integracion/probe", { method: "POST" })
      .then((r) => r.json())
      .catch(() => ({ results: [] }));
    return d?.results ?? [];
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
            Qué interfaces de Luna Negra (§1–§8) tiene cableada cada juego. Test
            visual: el estado sale del tráfico real que recibimos de tu game server.
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
          <IntegrationMatrix view={view} onProbe={onProbe} />
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
