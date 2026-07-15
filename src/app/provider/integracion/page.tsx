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

// ── Verificación de integración: NGP + NGE ──
// La página responde UNA pregunta por juego: ¿está integrado o no? La regla es
// "con evidencia se considera detectado":
//   · NGP → eventos observados (relays + DB) + evidencia persistida del probador
//     + inferencias (login desde el marcador firmado). Lo cifrado se declara.
//   · NGE → cualquier RPC autenticado recibido por el escrow (get_info alcanza).
// Los webhooks server-to-server viven en /provider/integracion/compat. La vieja
// interfaz REST 1.0 dependiente de Luna (login, compra, presencia, salas, claves
// de API) fue retirada; los juegos se integran por NGP/NGE.

function Legend() {
  const items = [
    { dot: "bg-ln-aurora", label: "Detectado (evidencia observada)" },
    { dot: "bg-blue", label: "Declarado / esperando señal" },
    { dot: "bg-blue/40", label: "Disponible / en diseño" },
    { dot: "bg-white/15", label: "No detectado" },
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
      .catch(() => ({ nostr: {} }));
    // El probador PERSISTE lo que encuentra como evidencia: recargamos la vista
    // para que los badges pasen a "Detectado" sin refrescar la página.
    void load();
    return { nostr: d?.nostr ?? {} };
  }, [load]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Verificación de integración</h1>
        <p className="mt-2 text-muted">
          Iniciá sesión para verificar la integración NGP y NGE de tus juegos.
        </p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>Iniciar sesión</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[920px] px-[22px] py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="ln-label mb-2">Verificación</p>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Integración NGP · NGE
          </h1>
          <p className="mt-1 text-sm text-ln-muted">
            Acá verificás si tu juego <strong>está integrado o no</strong>. La regla:{" "}
            <strong>con evidencia se considera detectado</strong>. Para{" "}
            <strong>NGP</strong> la evidencia son los eventos Nostr del juego
            (marcador kind:31339, reseñas, zaps, presencia NIP-38) observados en
            relays o en la DB; el login NIP-07/46 se <em>infiere</em> del marcador
            firmado. Para <strong>NGE</strong> (apuestas y escrow) alcanza con que
            tu game server mande <strong>un RPC autenticado</strong> — pegá{" "}
            <code>NGE_CONNECTION</code>, mandá <code>get_info</code> y listo. Lo que
            va cifrado E2E (invitaciones NIP-17) no se puede observar:
            eso lo declarás manualmente.
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
          <IntegrationMatrix view={view} onProbe={onProbe} onRefresh={load} editable />
        )}
      </div>

      <p className="mt-8 text-xs text-ln-faint">
        ¿Cómo integrar cada bloque? Mirá la{" "}
        <Link href="/dev" className="text-blue hover:underline">guía /dev</Link>.
        Los webhooks server-to-server (notificaciones firmadas) viven en{" "}
        <Link href="/provider/integracion/compat" className="text-blue hover:underline">
          /provider/integracion/compat
        </Link>
        .
      </p>
    </div>
  );
}
