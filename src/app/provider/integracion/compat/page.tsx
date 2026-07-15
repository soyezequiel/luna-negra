"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/components/provider/game-form-fields";

// ── Webhooks server-to-server ──
// Notificaciones firmadas (compra/apuesta/payout) al game server del proveedor.
// La vieja interfaz REST 1.0 dependiente de Luna Negra —incluidas las claves de
// API server-to-server— fue retirada; lo social/escrow va por NGP/NGE (ver
// /provider → Integración). Self-contenida: hace sus propios fetch.

export default function ProviderCompatPage() {
  const { user, login, loading } = useSession();
  const [hasProvider, setHasProvider] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // Se lee tras montar (no en el initializer) para no provocar un mismatch de
    // hidratación: el server no conoce window.location.origin.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    const d = await fetch("/api/provider").then((r) => r.json()).catch(() => null);
    if (d?.provider) {
      setHasProvider(true);
      setWebhookUrl(d.provider.webhookUrl ?? "");
      setWebhookSecret(d.provider.webhookSecret ?? null);
    }
  }, []);

  useEffect(() => {
    // Carga inicial al montar / cambiar de usuario.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void load();
  }, [user, load]);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setMsg(label);
  }

  async function saveWebhook(regenerate = false) {
    if (
      regenerate &&
      !confirm(
        "Regenerar el secreto invalida el anterior: los webhooks firmados con el viejo dejarán de validar hasta que actualices tu game server. ¿Continuar?",
      )
    ) {
      return;
    }
    setMsg(null);
    const r = await fetch("/api/provider/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: webhookUrl.trim(), regenerate }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "No se pudo guardar el webhook");
    setWebhookSecret(d.webhookSecret ?? null);
    setMsg("Webhook guardado.");
  }

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Webhooks</h1>
        <p className="mt-2 text-muted">Iniciá sesión para ver tus webhooks.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Iniciar sesión
          </Button>
        </div>
      </div>
    );
  }

  const envText = [
    `LUNA_NEGRA_BASE=${origin || "https://tu-deploy"}`,
    `LUNA_NEGRA_WEBHOOK_SECRET=${webhookSecret ?? "whsec_…"}`,
  ].join("\n");

  return (
    <div className="mx-auto max-w-[1040px] px-[22px] py-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="ln-label mb-2">Server-to-server</p>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Webhooks
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ln-muted">
            Notificaciones firmadas para tu game server: compras, apuestas
            liquidadas y payouts. La única credencial que necesitás es el secreto
            de firma.
          </p>
        </div>
        <Link href="/provider" className="btn btn-ghost shrink-0 self-start">
          Volver al panel
        </Link>
      </div>

      {/* Aviso */}
      <div className="mt-5 rounded-ln-lg border border-ln-corona/40 bg-ln-corona/[.06] p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-lg leading-none">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-ln-corona">
              La vieja interfaz REST 1.0 fue retirada
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ln-muted">
              El estándar hoy es <strong>Nostr Games Protocol (NGP)</strong> y, para
              apuestas/escrow, <strong>NGE</strong> (credencial <code>NGE_CONNECTION</code>).
              La interfaz REST 1.0 dependiente de Luna Negra —login, verificación de
              compra, presencia, salas y las <strong>claves de API</strong> server-to-server—
              <strong> ya no existe</strong>: los juegos se integran por eventos Nostr. Lo
              único que queda acá son los <strong>webhooks</strong>. Integrá desde{" "}
              <Link href="/provider/integracion" className="text-blue hover:underline">
                Integración
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      {msg ? <p className="mt-3 text-sm text-ln-luna">{msg}</p> : null}

      {!hasProvider ? (
        <p className="mt-6 text-sm text-ln-faint">
          Creá tu perfil de proveedor en el{" "}
          <Link href="/provider" className="text-blue hover:underline">
            panel de proveedor
          </Link>{" "}
          para empezar.
        </p>
      ) : (
        <section className="mt-6 grid items-start gap-3.5 lg:grid-cols-2">
          {/* webhooks */}
          <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
            <h2 className="font-semibold">Webhooks</h2>
            <p className="mb-3 mt-1 text-xs text-faint">
              Luna Negra notifica a esta URL los eventos{" "}
              <code>purchase.completed</code>, <code>bet.settled</code> y{" "}
              <code>payout.sent</code> (firmados con HMAC). Las apuestas v2 por
              zaps llegan por acá también, con <code>apiVersion: 2</code>.
            </p>
            <div className="flex gap-2">
              <input
                className={inputCls}
                placeholder="https://tu-server.com/webhooks/luna"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => saveWebhook()}>
                Guardar
              </Button>
            </div>
            {webhookSecret ? (
              <div className="mt-3 rounded-ln-md border border-ln-border bg-ln-bg-deep/60 p-3">
                <p className="text-xs text-muted">
                  Secreto de firma (verificá la cabecera{" "}
                  <code>X-LunaNegra-Signature</code>):
                </p>
                <code className="mt-1 block break-all font-mono text-xs text-ink">
                  {webhookSecret}
                </code>
                <button
                  onClick={() => saveWebhook(true)}
                  className="mt-2 text-xs text-blue hover:underline"
                >
                  Regenerar secreto
                </button>
              </div>
            ) : null}
          </div>

          {/* env vars */}
          <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-ink">Variables de entorno</h2>
              <button
                type="button"
                onClick={() => copy(envText, "Variables de entorno copiadas.")}
                className="text-xs text-blue hover:underline"
              >
                Copiar
              </button>
            </div>
            <p className="mt-1 text-xs text-faint">
              Lo que tu <strong>game server</strong> necesita para verificar los
              webhooks entrantes.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-ln-md bg-black/40 px-3 py-3 font-mono text-xs text-ink">{envText}</pre>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex flex-col gap-0.5">
                <dt>
                  <code className="text-ink">LUNA_NEGRA_BASE</code>
                </dt>
                <dd className="text-faint">URL de este deploy.</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt>
                  <code className="text-ink">LUNA_NEGRA_WEBHOOK_SECRET</code>
                </dt>
                <dd className="text-faint">
                  Verifica la firma HMAC de los webhooks entrantes (cabecera{" "}
                  <code>X-LunaNegra-Signature</code>).
                </dd>
              </div>
            </dl>
          </div>
        </section>
      )}
    </div>
  );
}
