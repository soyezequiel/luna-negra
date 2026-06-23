"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createNip07Signer,
  generateLocalSigner,
  importNsec,
  type LunaSigner,
  type StoredSigner,
} from "@/lib/signer";

type Tab = "email" | "extension" | "qr" | "bunker" | "local";

const TABS: { id: Tab; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "extension", label: "Extensión" },
  { id: "qr", label: "Escanear QR" },
  { id: "bunker", label: "Bunker" },
  { id: "local", label: "Clave local" },
];

/**
 * Modal de login con los 4 métodos (estilo figus): extensión NIP-07, Nostr
 * Connect por QR (Amber / nsec.app), bunker:// o NIP-05, y clave local
 * (generar o importar nsec). Se abre con `login()` del SessionProvider.
 */
export function LoginModal() {
  const { loginModalOpen, closeLoginModal, loginWithSigner, emailLoginEnabled } =
    useSession();
  // La pestaña de email solo se ofrece si el server la habilitó (config completa).
  const tabs = emailLoginEnabled ? TABS : TABS.filter((t) => t.id !== "email");
  // `tabChoice` = pestaña elegida por el usuario (null = ninguna todavía). La
  // pestaña activa se deriva: por defecto email si está disponible, si no extensión.
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const tab: Tab = tabChoice ?? (emailLoginEnabled ? "email" : "extension");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // En celular, escanear el QR con el mismo teléfono es incómodo: mejor abrir el
  // enlace nostrconnect:// directo y que el SO lo derive a la app de firma
  // instalada (Amber, Primal, nsec.app…). Se detecta tras montar para no romper SSR.
  const [isMobile, setIsMobile] = useState(false);

  // Estado del flujo email (magic link).
  const [emailInput, setEmailInput] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  // Estado del flujo QR (Nostr Connect).
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  // Líneas de diagnóstico del handshake NIP-46 (visibles en el celular).
  const [qrDebug, setQrDebug] = useState<string[]>([]);
  const qrAbort = useRef<AbortController | null>(null);

  // Inputs.
  const [bunkerInput, setBunkerInput] = useState("");
  const [nsecInput, setNsecInput] = useState("");
  // nsec recién generado: se muestra UNA vez para que el usuario lo respalde.
  const [generated, setGenerated] = useState<{
    signer: LunaSigner;
    nsec: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const finish = useCallback(
    async (signer: LunaSigner, stored: StoredSigner) => {
      setBusy(true);
      setError(null);
      try {
        await loginWithSigner(signer, stored);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de login");
      } finally {
        setBusy(false);
      }
    },
    [loginWithSigner],
  );

  // Detección de móvil (táctil + viewport angosto) para ofrecer el botón de
  // "abrir en la app" en lugar de solo el QR.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const narrow = window.innerWidth <= 880;
    setIsMobile(coarse && narrow);
  }, []);

  // El flujo QR arranca al entrar a esa pestaña y se cancela al salir/cerrar.
  useEffect(() => {
    if (!loginModalOpen || tab !== "qr") return;
    const ctrl = new AbortController();
    qrAbort.current = ctrl;
    let cancelled = false;

    void (async () => {
      // Reset asíncrono (la primera microtarea) para no llamar setState
      // sincrónicamente dentro del cuerpo del efecto.
      setQrDataUrl(null);
      setQrUri(null);
      setAuthUrl(null);
      setQrDebug([]);
      try {
        const { startNostrConnect } = await import("@/lib/signer-nip46");
        const { uri, established } = startNostrConnect({
          onauth: (url) => {
            if (!cancelled) setAuthUrl(url);
          },
          onDebug: (line) => {
            if (!cancelled) {
              const ts = new Date().toLocaleTimeString();
              setQrDebug((prev) => [...prev, `${ts}  ${line}`]);
            }
          },
          signal: ctrl.signal,
        });
        if (cancelled) return;
        setQrUri(uri);
        // El QR se dibuja con canvas; navegadores con anti-fingerprinting (Tor
        // Browser, LibreWolf) lo bloquean y `toDataURL` lanza. Eso NO es un fallo
        // de conexión: el usuario puede copiar el enlace nostrconnect:// y seguir.
        // Por eso lo envolvemos aparte y seguimos esperando `established`.
        try {
          setQrDataUrl(
            await QRCode.toDataURL(uri, {
              margin: 1,
              width: 240,
              errorCorrectionLevel: "M",
            }),
          );
        } catch {
          if (!cancelled) setQrDataUrl(null);
        }
        const { signer, stored } = await established;
        if (cancelled) {
          void signer.close?.();
          return;
        }
        await finish(signer, stored);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error && e.message
              ? e.message
              : "No se pudo conectar con el firmante remoto",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [loginModalOpen, tab, finish]);

  if (!loginModalOpen) return null;

  const hasExtension = typeof window !== "undefined" && Boolean(window.nostr);

  async function requestMagicLink() {
    if (!emailInput.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo enviar el email");
      setEmailSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el email");
    } finally {
      setBusy(false);
    }
  }

  async function loginExtension() {
    await finish(createNip07Signer(), { method: "nip07" });
  }

  async function loginBunker() {
    if (!bunkerInput.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { connectBunker } = await import("@/lib/signer-nip46");
      const { signer, stored } = await connectBunker(bunkerInput, (url) =>
        setAuthUrl(url),
      );
      await loginWithSigner(signer, stored);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo conectar al bunker");
    } finally {
      setBusy(false);
    }
  }

  function generateKey() {
    setError(null);
    setGenerated(generateLocalSigner());
    setCopied(false);
  }

  async function copyGenerated() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.nsec);
      setCopied(true);
    } catch {
      /* clipboard bloqueado: el usuario puede seleccionar el texto */
    }
  }

  async function loginGenerated() {
    if (!generated) return;
    await finish(generated.signer, { method: "local", nsec: generated.nsec });
  }

  async function loginImported() {
    if (!nsecInput.trim() || busy) return;
    try {
      const signer = importNsec(nsecInput);
      await finish(signer, { method: "local", nsec: nsecInput.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "nsec inválido");
    }
  }

  function close() {
    qrAbort.current?.abort();
    setError(null);
    setQrDebug([]);
    setGenerated(null);
    setNsecInput("");
    setEmailInput("");
    setEmailSent(false);
    setTabChoice(null);
    closeLoginModal();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-lg border border-line-2 bg-panel-2 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">Iniciar sesión</h3>
          <button
            onClick={close}
            className="text-faint hover:text-ink"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-md border border-line bg-black/20 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTabChoice(t.id);
                setError(null);
                setEmailSent(false);
              }}
              className={cn(
                "flex-1 rounded-sm px-2 py-1.5 text-xs font-medium",
                tab === t.id
                  ? "bg-blue/20 text-blue"
                  : "text-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5 min-h-[180px]">
          {tab === "email" ? (
            <div>
              {emailSent ? (
                <div className="text-center">
                  <p className="text-3xl">📬</p>
                  <p className="mt-3 text-sm text-ink">Revisá tu correo</p>
                  <p className="mt-1 text-sm text-muted">
                    Te enviamos un enlace de acceso a{" "}
                    <span className="text-ink">{emailInput.trim()}</span>. Es
                    válido por 15 minutos.
                  </p>
                  <button
                    onClick={() => setEmailSent(false)}
                    className="mt-4 text-xs text-blue hover:underline"
                  >
                    Usar otro correo
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted">
                    ¿No usás Nostr? Ingresá tu email y te mandamos un enlace para
                    entrar. Te creamos una identidad Nostr automáticamente (podés
                    exportar tu clave desde el perfil cuando quieras).
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void requestMagicLink();
                    }}
                  >
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="tu@correo.com"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className="mt-3 w-full rounded-sm border border-line bg-black/20 px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-blue/30"
                    />
                    <Button
                      variant="blue"
                      type="submit"
                      className="mt-3 w-full"
                      disabled={busy || !emailInput.trim()}
                    >
                      {busy ? "Enviando…" : "Enviar enlace de acceso"}
                    </Button>
                  </form>
                </div>
              )}
            </div>
          ) : null}

          {tab === "extension" ? (
            <div>
              <p className="text-sm text-muted">
                Usá tu extensión del navegador (nos2x, Alby). Solo se piden los
                permisos del login; el resto, recién cuando los uses.
              </p>
              <Button
                variant="blue"
                className="mt-4 w-full"
                onClick={loginExtension}
                disabled={busy || !hasExtension}
              >
                {busy ? "Conectando…" : "Conectar con la extensión"}
              </Button>
              {!hasExtension ? (
                <p className="mt-2 text-xs text-faint">
                  No se encontró una extensión Nostr. Instalá nos2x o Alby, o
                  usá otro método.
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "qr" ? (
            <div className="flex flex-col items-center">
              {/* En celular, abrir el enlace directo en la app de firma instalada
                  (Primal, Amber, nsec.app…) es mucho más cómodo que escanear el
                  QR con el mismo teléfono. Usamos un <a> con el esquema custom
                  para que cuente como gesto del usuario y el SO ofrezca la app. */}
              {isMobile && qrUri ? (
                <div className="w-full">
                  <a
                    href={qrUri}
                    className="flex w-full items-center justify-center rounded-md bg-blue/20 px-4 py-3 text-sm font-semibold text-blue"
                  >
                    Abrir en mi app de Nostr
                  </a>
                  <p className="mt-2 text-center text-xs text-faint">
                    Se abre <span className="text-muted">Primal</span>,{" "}
                    <span className="text-muted">Amber</span> u otra app de firma
                    instalada, y aprobás la conexión ahí.
                  </p>
                  <div className="my-4 flex items-center gap-3 text-xs text-faint">
                    <span className="h-px flex-1 bg-line" />o escaneá el QR
                    <span className="h-px flex-1 bg-line" />
                  </div>
                </div>
              ) : null}
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="Código QR de Nostr Connect"
                  className="rounded bg-white p-1"
                  width={240}
                  height={240}
                />
              ) : (
                <div className="flex h-[240px] w-[240px] items-center justify-center rounded bg-black/20 p-4 text-center text-sm text-faint">
                  {qrUri
                    ? "Este navegador bloquea el QR. Copiá el enlace de abajo y pegalo en tu firmante."
                    : "Generando QR…"}
                </div>
              )}
              <p className="mt-3 text-center text-sm text-muted">
                Escaneá con <span className="text-ink">Amber</span> o{" "}
                <span className="text-ink">nsec.app</span> y aprobá la conexión.
              </p>
              {qrUri ? (
                <button
                  onClick={() => navigator.clipboard.writeText(qrUri).catch(() => {})}
                  className="mt-1 text-xs text-blue hover:underline"
                >
                  Copiar enlace nostrconnect://
                </button>
              ) : null}
              {authUrl ? (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 text-xs text-blue hover:underline"
                >
                  Tu firmante pide autorización: abrir enlace ↗
                </a>
              ) : null}
              <p className="mt-2 text-xs text-faint">Esperando conexión…</p>
              {qrDebug.length > 0 ? (
                <div className="mt-3 w-full">
                  <p className="text-[10px] uppercase tracking-wide text-faint">
                    Diagnóstico
                  </p>
                  <div className="mt-1 max-h-32 overflow-auto rounded-sm border border-line bg-black/30 p-2 text-left font-mono text-[10px] leading-relaxed text-muted">
                    {qrDebug.map((line, i) => (
                      <div key={i} className="break-all">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "bunker" ? (
            <div>
              <p className="text-sm text-muted">
                Pegá la URL <span className="font-mono text-ink">bunker://…</span>{" "}
                de tu firmante remoto, o tu identificador NIP-05 (
                <span className="font-mono text-ink">usuario@dominio</span>).
              </p>
              <input
                type="text"
                autoComplete="off"
                placeholder="bunker://… o usuario@dominio"
                value={bunkerInput}
                onChange={(e) => setBunkerInput(e.target.value)}
                className="mt-3 w-full rounded-sm border border-line bg-black/20 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-blue/30"
              />
              <Button
                variant="blue"
                className="mt-3 w-full"
                onClick={loginBunker}
                disabled={busy || !bunkerInput.trim()}
              >
                {busy ? "Conectando…" : "Conectar"}
              </Button>
              {authUrl ? (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-xs text-blue hover:underline"
                >
                  Tu firmante pide autorización: abrir enlace ↗
                </a>
              ) : null}
            </div>
          ) : null}

          {tab === "local" ? (
            <div>
              {generated ? (
                <div>
                  <p className="text-sm text-muted">
                    Tu clave nueva. Guardala en un lugar seguro:{" "}
                    <span className="text-ink">
                      se muestra una sola vez y es la única forma de recuperar tu
                      cuenta.
                    </span>
                  </p>
                  <div className="mt-3 break-all rounded-sm border border-line bg-black/20 p-3 font-mono text-xs text-ink">
                    {generated.nsec}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="ghost" className="flex-1" onClick={copyGenerated}>
                      {copied ? "Copiado ✓" : "Copiar"}
                    </Button>
                    <Button
                      variant="blue"
                      className="flex-1"
                      onClick={loginGenerated}
                      disabled={busy}
                    >
                      {busy ? "Conectando…" : "Continuar"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted">
                    Generá una clave nueva o importá tu{" "}
                    <span className="font-mono text-ink">nsec</span>.
                  </p>
                  <p className="mt-2 text-xs text-[var(--lose)]">
                    ⚠ La clave queda guardada en este navegador (sin cifrar). No
                    uses tu identidad principal en una computadora compartida.
                  </p>
                  <Button
                    variant="ghost"
                    className="mt-3 w-full"
                    onClick={generateKey}
                    disabled={busy}
                  >
                    Generar clave nueva
                  </Button>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="nsec1…"
                      value={nsecInput}
                      onChange={(e) => setNsecInput(e.target.value)}
                      className="min-w-0 flex-1 rounded-sm border border-line bg-black/20 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-blue/30"
                    />
                    <Button
                      variant="blue"
                      onClick={loginImported}
                      disabled={busy || !nsecInput.trim()}
                    >
                      Importar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-sm text-[var(--lose)]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
