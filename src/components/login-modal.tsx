"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
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

// Clases de presentación del rediseño "Eclipse" (tokens ln-*). Solo estilo: no
// alteran ningún handler ni la lógica de firmantes.
//  · primario → gradiente Luna con glow (acción: Conectar / Continuar / Enviar)
//  · secundario → superficie translúcida con borde (Generar / Copiar)
//  · input → fondo hundido ln-bg-deep con focus-ring Luna
const primaryBtn =
  "rounded-xl px-4 py-3 text-center font-semibold text-[#1a1430] bg-[linear-gradient(120deg,#c2b5ff,#9d8cff)] shadow-[0_14px_36px_-12px_rgba(157,140,255,.6)] transition hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-ln-luna/50 disabled:pointer-events-none disabled:opacity-50";
const secondaryBtn =
  "rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center font-semibold text-ln-soft transition hover:bg-white/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-ln-luna/40 disabled:pointer-events-none disabled:opacity-50";
const inputCls =
  "w-full rounded-[11px] border border-white/10 bg-ln-bg-deep px-3.5 py-3 text-sm text-ln-text placeholder:text-ln-faint outline-none transition focus:border-ln-luna/55 focus:ring-2 focus:ring-ln-luna/15";
const linkCls =
  "rounded text-ln-luna-bright transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ln-luna/40";

/**
 * Avisa al server (que reenvía a Discord) cuando el login por Nostr Connect
 * falla, con el timeline de diagnóstico. Best-effort: si el reporte falla, se
 * ignora en silencio para no encadenar errores en el flujo de login.
 */
function reportLoginFailure(error: string, lines: string[]) {
  try {
    void fetch("/api/debug/login-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        error,
        lines,
        ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
      }),
    }).catch(() => {});
  } catch {
    /* noop */
  }
}

/**
 * Modal de login con los 4 métodos (estilo figus): extensión NIP-07, Nostr
 * Connect por QR (Amber / nsec.app), bunker:// o NIP-05, y clave local
 * (generar o importar nsec). Se abre con `login()` del SessionProvider.
 */
export function LoginModal() {
  const { loginModalOpen, closeLoginModal, loginWithSigner, emailLoginEnabled } =
    useSession();
  // En celular, escanear el QR con el mismo teléfono es incómodo: mejor abrir el
  // enlace nostrconnect:// directo y que el SO lo derive a la app de firma
  // instalada (Amber, Primal, nsec.app…). Se detecta tras montar para no romper SSR.
  const [isMobile, setIsMobile] = useState(false);
  // Pestañas visibles: "email" solo si el server lo habilitó; "extension" se
  // oculta en celular (las extensiones NIP-07 no existen en navegadores móviles).
  const tabs = TABS.filter((t) => {
    if (t.id === "email") return emailLoginEnabled;
    if (t.id === "extension") return !isMobile;
    return true;
  });
  // `tabChoice` = pestaña elegida por el usuario (null = ninguna todavía). La
  // pestaña activa se deriva: email si está disponible; en celular, QR (no hay
  // extensión); en escritorio, extensión.
  const [tabChoice, setTabChoice] = useState<Tab | null>(null);
  const tab: Tab =
    tabChoice ?? (emailLoginEnabled ? "email" : isMobile ? "qr" : "extension");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado del flujo email (magic link).
  const [emailInput, setEmailInput] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  // Estado del flujo QR (Nostr Connect).
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  // En celular el QR arranca oculto (el método cómodo es "Abrir en mi app"); el
  // usuario lo revela si quiere escanear con otro dispositivo. En escritorio
  // siempre se muestra.
  const [revealQr, setRevealQr] = useState(false);
  // Timeline de diagnóstico del handshake NIP-46. No se muestra al usuario: se
  // junta acá y, si el flujo falla, se manda a Discord para que el dev lo vea.
  const qrDebug = useRef<string[]>([]);
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
      qrDebug.current = [];
      try {
        const { startNostrConnect } = await import("@/lib/signer-nip46");
        const { uri, established } = startNostrConnect({
          onauth: (url) => {
            if (!cancelled) setAuthUrl(url);
          },
          onDebug: (line) => {
            const ts = new Date().toLocaleTimeString();
            qrDebug.current.push(`${ts}  ${line}`);
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
        // `cancelled` = el usuario cerró el modal / cambió de pestaña: no es un
        // fallo real, no reportamos. Solo avisamos a Discord en errores genuinos.
        if (!cancelled) {
          const msg =
            e instanceof Error && e.message
              ? e.message
              : "No se pudo conectar con el firmante remoto";
          setError(msg);
          reportLoginFailure(msg, qrDebug.current);
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
    qrDebug.current = [];
    setRevealQr(false);
    setGenerated(null);
    setNsecInput("");
    setEmailInput("");
    setEmailSent(false);
    setTabChoice(null);
    closeLoginModal();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Iniciar sesión"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[22px] border border-white/10 bg-ln-panel/70 p-7 shadow-[0_40px_100px_-30px_rgba(0,0,0,.9)] backdrop-blur animate-ln-rise motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-2xl font-bold tracking-[-.02em] text-ln-text">
              Iniciar sesión
            </h3>
            <p className="mt-0.5 text-[13px] text-ln-muted">
              Entrá con tu identidad Nostr.
            </p>
          </div>
          <button
            onClick={close}
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-ln-faint transition hover:text-ln-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ln-luna/40"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 flex gap-1 rounded-xl border border-white/[0.06] bg-ln-bg-deep p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              aria-pressed={tab === t.id}
              onClick={() => {
                setTabChoice(t.id);
                setError(null);
                setEmailSent(false);
                setRevealQr(false);
              }}
              className={cn(
                "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ln-luna/40",
                tab === t.id
                  ? "bg-ln-luna/15 text-ln-luna-bright shadow-[inset_0_0_0_1px_rgba(157,140,255,.25)]"
                  : "text-ln-muted hover:text-ln-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-5 min-h-[196px]">
          {tab === "email" ? (
            <div>
              {emailSent ? (
                <div className="text-center">
                  <p className="text-3xl">📬</p>
                  <p className="mt-3 text-sm text-ln-text">Revisá tu correo</p>
                  <p className="mt-1 text-sm text-ln-muted">
                    Te enviamos un enlace de acceso a{" "}
                    <span className="text-ln-text">{emailInput.trim()}</span>. Es
                    válido por 15 minutos.
                  </p>
                  <button
                    onClick={() => setEmailSent(false)}
                    className={cn("mt-4 text-xs", linkCls)}
                  >
                    Usar otro correo
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-ln-muted">
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
                      className={cn("mt-3", inputCls)}
                    />
                    <button
                      type="submit"
                      className={cn(primaryBtn, "mt-3 w-full")}
                      disabled={busy || !emailInput.trim()}
                    >
                      {busy ? "Enviando…" : "Enviar enlace de acceso"}
                    </button>
                  </form>
                </div>
              )}
            </div>
          ) : null}

          {tab === "extension" ? (
            <div>
              <p className="text-sm text-ln-muted">
                Usá tu extensión del navegador (nos2x, Alby). Solo se piden los
                permisos del login; el resto, recién cuando los uses.
              </p>
              <button
                className={cn(primaryBtn, "mt-4 w-full")}
                onClick={loginExtension}
                disabled={busy || !hasExtension}
              >
                {busy ? "Conectando…" : "Conectar con la extensión"}
              </button>
              {!hasExtension ? (
                <p className="mt-2 text-xs text-ln-faint">
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
                  para que cuente como gesto del usuario y el SO ofrezca la app.
                  El QR queda oculto detrás de un botón "Mostrar QR". */}
              {isMobile && qrUri ? (
                <div className="w-full">
                  <a
                    href={qrUri}
                    className={cn(
                      primaryBtn,
                      "flex w-full items-center justify-center gap-2 no-underline",
                    )}
                  >
                    <span aria-hidden>⚡</span> Abrir en mi app de Nostr
                  </a>
                  <p className="mt-2 text-center text-xs text-ln-faint">
                    Se abre <span className="text-ln-muted">Primal</span>,{" "}
                    <span className="text-ln-muted">Amber</span> u otra app de
                    firma instalada, y aprobás la conexión ahí.
                  </p>
                  {!revealQr ? (
                    <button
                      onClick={() => setRevealQr(true)}
                      className={cn("mt-4 w-full text-center text-xs", linkCls)}
                    >
                      ¿Escaneás con otro dispositivo? Mostrar código QR
                    </button>
                  ) : (
                    <div className="my-4 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[.16em] text-ln-faint">
                      <span className="h-px flex-1 bg-white/10" />o escaneá el QR
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                  )}
                </div>
              ) : null}

              {/* El QR (y su texto) solo se renderiza en escritorio o cuando el
                  usuario lo pidió en celular. */}
              {!isMobile || revealQr ? (
                <>
                  {qrDataUrl ? (
                    <div className="rounded-2xl bg-white p-3.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrDataUrl}
                        alt="Código QR de Nostr Connect"
                        className="block h-[208px] w-[208px]"
                        width={208}
                        height={208}
                      />
                    </div>
                  ) : (
                    <div className="flex h-[239px] w-[239px] items-center justify-center rounded-2xl border border-white/10 bg-ln-bg-deep p-5 text-center text-sm text-ln-faint">
                      {qrUri
                        ? "Este navegador bloquea el QR. Copiá el enlace de abajo y pegalo en tu firmante."
                        : "Generando QR…"}
                    </div>
                  )}
                  <p className="mt-3 text-center text-sm text-ln-muted">
                    Escaneá con <span className="text-ln-text">Amber</span> o{" "}
                    <span className="text-ln-text">nsec.app</span> y aprobá la
                    conexión.
                  </p>
                  {qrUri ? (
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(qrUri).catch(() => {})
                      }
                      className={cn(
                        "mt-1 font-mono text-[10px] uppercase tracking-[.16em]",
                        linkCls,
                      )}
                    >
                      Copiar enlace nostrconnect://
                    </button>
                  ) : null}
                </>
              ) : null}

              {authUrl ? (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("mt-2 text-xs", linkCls)}
                >
                  Tu firmante pide autorización: abrir enlace ↗
                </a>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ln-aurora opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-ln-aurora" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[.16em] text-ln-aurora-bright">
                  Esperando conexión…
                </span>
              </div>
            </div>
          ) : null}

          {tab === "bunker" ? (
            <div>
              <p className="text-sm text-ln-muted">
                Pegá la URL{" "}
                <span className="font-mono text-ln-text">bunker://…</span> de tu
                firmante remoto, o tu identificador NIP-05 (
                <span className="font-mono text-ln-text">usuario@dominio</span>).
              </p>
              <input
                type="text"
                autoComplete="off"
                placeholder="bunker://… o usuario@dominio"
                value={bunkerInput}
                onChange={(e) => setBunkerInput(e.target.value)}
                className={cn("mt-3 font-mono", inputCls)}
              />
              <button
                className={cn(primaryBtn, "mt-3 w-full")}
                onClick={loginBunker}
                disabled={busy || !bunkerInput.trim()}
              >
                {busy ? "Conectando…" : "Conectar"}
              </button>
              {authUrl ? (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("mt-2 block text-xs", linkCls)}
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
                  <p className="text-sm text-ln-muted">
                    Tu clave nueva. Guardala en un lugar seguro:{" "}
                    <span className="text-ln-text">
                      se muestra una sola vez y es la única forma de recuperar tu
                      cuenta.
                    </span>
                  </p>
                  <div className="mt-3 break-all rounded-[11px] border border-ln-corona/35 bg-ln-bg-deep p-3 font-mono text-xs text-ln-corona-bright">
                    {generated.nsec}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className={cn(secondaryBtn, "flex-1")}
                      onClick={copyGenerated}
                    >
                      {copied ? "Copiado ✓" : "Copiar"}
                    </button>
                    <button
                      className={cn(primaryBtn, "flex-1")}
                      onClick={loginGenerated}
                      disabled={busy}
                    >
                      {busy ? "Conectando…" : "Continuar"}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-ln-muted">
                    Generá una clave nueva o importá tu{" "}
                    <span className="font-mono text-ln-text">nsec</span>.
                  </p>
                  <p className="mt-2 rounded-[11px] border border-ln-danger/[0.28] bg-ln-danger/[0.08] px-3 py-2 text-xs text-[#e8a99a]">
                    ⚠ La clave queda guardada en este navegador (sin cifrar). No
                    uses tu identidad principal en una computadora compartida.
                  </p>
                  <button
                    className={cn(secondaryBtn, "mt-3 w-full")}
                    onClick={generateKey}
                    disabled={busy}
                  >
                    Generar clave nueva
                  </button>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="nsec1…"
                      value={nsecInput}
                      onChange={(e) => setNsecInput(e.target.value)}
                      className={cn("min-w-0 flex-1 font-mono", inputCls)}
                    />
                    <button
                      className={cn(primaryBtn, "shrink-0")}
                      onClick={loginImported}
                      disabled={busy || !nsecInput.trim()}
                    >
                      Importar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-sm text-ln-danger">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
