"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inputCls } from "@/components/provider/game-form-fields";

// ── Credenciales server-to-server: claves de API y webhooks ──
// Claves de API (Bearer para crear apuestas v2 por zaps en /api/v2/bets) y
// webhooks firmados (notificaciones de compra/apuesta/payout). La vieja interfaz
// REST 1.0 dependiente de Luna Negra fue retirada; lo social va por NGP/NGE (ver
// /provider → Integración y /provider/integracion). Self-contenida: hace sus
// propios fetch.

type Game = { id: string; title: string };
type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  gameId: string | null;
  gameTitle: string | null;
};

export default function ProviderCompatPage() {
  const { user, login, loading } = useSession();
  const [hasProvider, setHasProvider] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [keyName, setKeyName] = useState("");
  // Juego al que acotar la clave nueva ("" = todos los juegos / a nivel proveedor).
  const [keyGameId, setKeyGameId] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [envGameId, setEnvGameId] = useState("");

  useEffect(() => {
    // Se lee tras montar (no en el initializer) para no provocar un mismatch de
    // hidratación: el server no conoce window.location.origin.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    const [d, k] = await Promise.all([
      fetch("/api/provider").then((r) => r.json()).catch(() => null),
      fetch("/api/provider/api-keys").then((r) => r.json()).catch(() => ({ keys: [] })),
    ]);
    if (d?.provider) {
      setHasProvider(true);
      setWebhookUrl(d.provider.webhookUrl ?? "");
      setWebhookSecret(d.provider.webhookSecret ?? null);
    }
    setGames(d?.games ?? []);
    setApiKeys(k?.keys ?? []);
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

  async function createKey() {
    setMsg(null);
    const r = await fetch("/api/provider/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: keyName.trim() || "Clave de API",
        ...(keyGameId ? { gameId: keyGameId } : {}),
      }),
    });
    const d = await r.json();
    if (!r.ok) return setMsg(d.error ?? "No se pudo crear la clave");
    setCreatedKey(d.key); // se muestra una sola vez
    setKeyName("");
    setKeyGameId("");
    load();
  }

  async function revokeKey(id: string) {
    if (!confirm("¿Revocar esta clave? Dejará de funcionar al instante.")) return;
    await fetch(`/api/provider/api-keys/${id}`, { method: "DELETE" });
    load();
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
        <h1 className="text-2xl font-bold text-white">Claves de API y webhooks</h1>
        <p className="mt-2 text-muted">Conectá tu Nostr para ver las claves y webhooks.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="blue" onClick={login}>
            Conectar con Nostr
          </Button>
        </div>
      </div>
    );
  }

  const selectedGameId = envGameId || games[0]?.id || "";
  const envText = [
    `LUNA_NEGRA_BASE=${origin || "https://tu-deploy"}`,
    `LUNA_NEGRA_API_KEY=${createdKey ?? "ln_sk_…"}`,
    `LUNA_NEGRA_WEBHOOK_SECRET=${webhookSecret ?? "whsec_…"}`,
    `LUNA_NEGRA_GAME_ID=${selectedGameId || "game_…"}`,
  ].join("\n");

  return (
    <div className="mx-auto max-w-[1040px] px-[22px] py-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="ln-label mb-2">Server-to-server</p>
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-white ln:text-[40px]">
            Claves de API y webhooks
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ln-muted">
            Credenciales para tu game server: claves de API (Bearer) que crean
            apuestas v2 por zaps en <code>/api/v2/bets</code> y webhooks firmados
            para las notificaciones.
          </p>
        </div>
        <Link href="/provider" className="btn btn-ghost shrink-0 self-start">
          Volver al panel
        </Link>
      </div>

      {/* Aviso de deprecación */}
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
              La vieja interfaz REST 1.0 dependiente de Luna Negra (login, verificación
              de compra, presencia y salas por REST) <strong>ya no existe</strong>. Estas
              credenciales siguen sirviendo a la <strong>API de apuestas v2 por zaps</strong>{" "}
              y a los webhooks. Para lo social, integrá desde{" "}
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
          {/* env vars */}
          <div className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-ink">Variables de entorno</h2>
              <button
                type="button"
                onClick={() => copy(envText, "Variables de entorno copiadas.")}
                className="text-xs text-blue hover:underline"
              >
                Copiar todo
              </button>
            </div>
            <p className="mt-1 text-xs text-faint">
              Todo lo que tu <strong>game server</strong> necesita para crear{" "}
              <strong>apuestas v2 por zaps</strong> en <code>/api/v2/bets</code> y
              recibir <strong>webhooks</strong> firmados. Pegalo en el archivo{" "}
              <code>.env</code> de tu servidor. La API key solo se ve al crearla (en{" "}
              <strong>Claves de API</strong>, abajo); el resto lo podés copiar
              cuando quieras.
            </p>

            {games.length > 1 ? (
              <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                Juego para <code>LUNA_NEGRA_GAME_ID</code>:
                <select
                  className={cn(inputCls, "max-w-xs")}
                  value={selectedGameId}
                  onChange={(e) => setEnvGameId(e.target.value)}
                >
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <pre className="mt-3 overflow-x-auto rounded-ln-md bg-black/40 px-3 py-3 font-mono text-xs text-ink">{envText}</pre>

            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex flex-col gap-0.5">
                <dt>
                  <code className="text-ink">LUNA_NEGRA_BASE</code>
                </dt>
                <dd className="text-faint">
                  URL de este deploy: base de las llamadas a <code>/api/v2/bets</code>,{" "}
                  <strong>siempre requerida</strong>.
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt>
                  <code className="text-ink">LUNA_NEGRA_API_KEY</code>
                </dt>
                <dd className="text-faint">
                  Llave secreta server-to-server (<code>ln_sk_…</code>) para crear
                  apuestas v2 por zaps. <strong>Nunca va al navegador.</strong>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt>
                  <code className="text-ink">LUNA_NEGRA_WEBHOOK_SECRET</code>
                </dt>
                <dd className="text-faint">
                  Verifica la firma HMAC de los webhooks entrantes. Opcional: solo
                  si escuchás eventos (compras, apuestas liquidadas, payouts).
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="flex items-center gap-2">
                  <code className="text-ink">LUNA_NEGRA_GAME_ID</code>
                  <span className="rounded-full bg-green/15 px-2 py-0.5 text-[10px] font-semibold text-green">
                    opcional
                  </span>
                </dt>
                <dd className="text-faint">
                  El <code>gameId</code> para crear apuestas desde el backend.{" "}
                  <strong>No hace falta si creás una clave acotada a un juego</strong>{" "}
                  (abajo, en <strong>Claves de API</strong>): esa clave ya sabe a
                  qué juego pertenece.
                </dd>
              </div>
            </dl>
            <p className="mt-3 rounded-ln-md border border-green/25 bg-green/5 px-3 py-2 text-xs text-muted">
              <strong className="text-green">Mínimo para apuestas/escrow:</strong>{" "}
              <code>LUNA_NEGRA_BASE</code> + <code>LUNA_NEGRA_API_KEY</code> (con la
              clave acotada a un juego). <code>GAME_ID</code> y{" "}
              <code>WEBHOOK_SECRET</code> quedan opcionales.
            </p>
          </div>

          {/* api keys */}
          <div id="api-keys" className="scroll-mt-20 rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
            <h2 className="font-semibold">Claves de API</h2>
            <p className="mb-3 mt-1 text-xs text-faint">
              Para que tu game server cree apuestas v2 por zaps (Bearer). Solo en
              tu backend, nunca en el navegador.{" "}
              <strong>Acotala a un juego</strong> y tu server no necesita mandar{" "}
              <code>gameId</code> (una env var menos).
            </p>

            {createdKey ? (
              <div className="mb-3 rounded-ln-md border border-green/30 bg-green/10 p-4">
                <p className="text-sm text-green">
                  Copiá tu clave ahora — no se vuelve a mostrar:
                </p>
                <code className="mt-2 block break-all rounded bg-black/40 px-3 py-2 font-mono text-xs text-ink">
                  {createdKey}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdKey);
                    setMsg("Clave copiada.");
                  }}
                  className="mt-2 text-xs text-blue hover:underline"
                >
                  Copiar
                </button>
                <button
                  onClick={() => setCreatedKey(null)}
                  className="ml-4 text-xs text-faint hover:text-ink"
                >
                  Listo
                </button>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <input
                className={cn(inputCls, "min-w-[160px] flex-1")}
                placeholder="Nombre (ej. servidor-prod)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
              <select
                className={cn(inputCls, "max-w-[200px]")}
                value={keyGameId}
                onChange={(e) => setKeyGameId(e.target.value)}
                title="Acotar la clave a un juego (opcional)"
              >
                <option value="">Todos los juegos</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" onClick={createKey}>
                Crear
              </Button>
            </div>
            <p className="mt-1 text-xs text-faint">
              Acotada a un juego, tu server puede omitir <code>gameId</code> al
              crear apuestas. «Todos los juegos» = clave a nivel proveedor (el body
              debe mandar <code>gameId</code>).
            </p>

            {apiKeys.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {apiKeys.map((k) => (
                  <li
                    key={k.id}
                    className="flex items-center justify-between rounded-ln-md border border-ln-border px-4 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{k.name}</span>{" "}
                      <code className="text-xs text-faint">{k.prefix}…</code>
                      <span className="ml-2 text-xs text-faint">
                        {k.lastUsedAt ? "usada" : "sin usar"}
                      </span>
                      <span
                        className={cn(
                          "ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          k.gameId
                            ? "bg-ln-luna/15 text-ln-luna"
                            : "bg-white/10 text-ln-muted",
                        )}
                      >
                        {k.gameId ? k.gameTitle ?? "juego" : "todos los juegos"}
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => revokeKey(k.id)}>
                      Revocar
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

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
        </section>
      )}
    </div>
  );
}
