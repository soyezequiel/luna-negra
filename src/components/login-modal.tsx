"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useSession } from "@/providers/session-provider";
import { cn } from "@/lib/utils";
import { detectAuthDevice, needsProfileOnboarding } from "@/lib/auth-flow";
import { fetchProfile } from "@/lib/nostr";
import {
  createNip07Signer,
  generateLocalSigner,
  importNsec,
  type LunaSigner,
  type StoredSigner,
} from "@/lib/signer";

type AdvancedMethod = "extension" | "qr" | "bunker" | "nsec" | "temporary";

const NOS2X_URL =
  "https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp";
const ALBY_URL =
  "https://chromewebstore.google.com/detail/alby-bitcoin-wallet-for-l/iokeahhehimjnekafflcihljlcjccdbe";
const PRIMAL_URL = "https://primal.net/downloads";
const PRIMAL_PLAY_URL =
  "https://play.google.com/store/apps/details?id=net.primal.android";

// Clases de presentación del rediseño "Eclipse" (tokens ln-*). Solo estilo: no
// alteran ningún handler ni la lógica de firmantes.
//  · primario → gradiente Luna con glow (acción: Iniciar / Continuar / Enviar)
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
  const router = useRouter();
  const [device, setDevice] = useState<"desktop" | "mobile" | null>(null);
  const isMobile = device === "mobile";
  const isDesktop = device === "desktop";
  const [hasExtension, setHasExtension] = useState(false);
  const [view, setView] = useState<"main" | "advanced">("main");
  const [method, setMethod] = useState<AdvancedMethod | null>(null);
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
        const pubkey = await signer.getPublicKey();
        await loginWithSigner(signer, stored);
        if (stored.method === "local") {
          const profile =
            stored.source === "generated" ? null : await fetchProfile(pubkey);
          if (
            needsProfileOnboarding({
              source: stored.source === "generated" ? "generated" : "imported",
              profile,
            })
          ) {
            router.push("/profile/editar?onboarding=1");
          }
          setNsecInput("");
          setGenerated(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de login");
      } finally {
        setBusy(false);
      }
    },
    [loginWithSigner, router],
  );

  // Detección de móvil (táctil + viewport angosto) para ofrecer el botón de
  // "abrir en la app" en lugar de solo el QR.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    // Microtarea para no llamar setState sincrónicamente dentro del efecto
    // (evita el cascading render y mantiene el primer render SSR-safe en false).
    void Promise.resolve().then(() =>
      setDevice(
        detectAuthDevice({
          userAgent: navigator.userAgent,
          width: window.innerWidth,
          coarsePointer: coarse,
        }),
      ),
    );
  }, []);

  useEffect(() => {
    if (!loginModalOpen || !isDesktop) return;
    const detect = () => setHasExtension(Boolean(window.nostr));
    detect();
    const timer = window.setInterval(detect, 250);
    const stop = window.setTimeout(() => window.clearInterval(timer), 3000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [loginModalOpen, isDesktop]);

  // El flujo QR arranca al entrar a esa pestaña y se cancela al salir/cerrar.
  useEffect(() => {
    if (!loginModalOpen || method !== "qr") return;
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
              margin: 2,
              width: 288,
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
  }, [loginModalOpen, method, finish]);

  if (!loginModalOpen) return null;

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
    await finish(generated.signer, { method: "local", nsec: generated.nsec, source: "generated" });
  }

  async function loginImported() {
    if (!nsecInput.trim() || busy) return;
    try {
      const signer = importNsec(nsecInput);
      await finish(signer, { method: "local", nsec: nsecInput.trim(), source: "imported" });
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
    setView("main");
    setMethod(null);
    closeLoginModal();
  }

  const chooseMethod = (next: AdvancedMethod) => {
    setMethod(next);
    setError(null);
    setAuthUrl(null);
    setRevealQr(false);
    setGenerated(null);
  };

  const methodButton = (
    id: AdvancedMethod,
    icon: string,
    title: string,
    description: string,
  ) => (
    <button
      type="button"
      onClick={() => chooseMethod(id)}
      className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] p-3.5 text-left transition hover:border-ln-luna/35 hover:bg-ln-luna/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-ln-luna/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ln-luna/12 text-lg" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ln-text">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ln-muted">
          {description}
        </span>
      </span>
      <span className="text-ln-faint" aria-hidden>›</span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-[24px] border border-white/10 bg-ln-panel/95 p-5 shadow-[0_40px_100px_-30px_rgba(0,0,0,.9)] backdrop-blur animate-ln-rise motion-reduce:animate-none sm:max-w-lg sm:rounded-[24px] sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {view === "advanced" ? (
              <button
                type="button"
                onClick={() => {
                  if (method) setMethod(null);
                  else setView("main");
                  setError(null);
                }}
                className={cn("mb-2 inline-flex items-center gap-1 text-xs", linkCls)}
              >
                ← Volver
              </button>
            ) : null}
            <h2 id="login-title" className="font-display text-2xl font-bold text-ln-text">
              {view === "main"
                ? "Iniciar sesión"
                : method
                  ? "Otra forma de iniciar sesión"
                  : "Opciones avanzadas"}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ln-muted">
              {view === "main"
                ? "Entrá a Luna Negra de la forma que te resulte más cómoda."
                : "Estas opciones son para personas que ya usan una identidad Nostr."}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="-mr-1 -mt-1 rounded-lg p-2 text-ln-faint transition hover:text-ln-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ln-luna/40"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {view === "main" ? (
          <div className="mt-5 space-y-4">
            <section className="rounded-2xl border border-ln-luna/35 bg-ln-luna/[0.08] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-ln-text">Continuar con email</p>
                  <p className="mt-0.5 text-xs text-ln-muted">Sin contraseña. Te enviamos un enlace seguro.</p>
                </div>
                <span className="rounded-full bg-ln-luna/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-ln-luna-bright">
                  Recomendado
                </span>
              </div>

              {emailSent ? (
                <div className="mt-4 rounded-xl bg-ln-bg-deep/60 p-4 text-center">
                  <p className="text-2xl" aria-hidden>📬</p>
                  <p className="mt-2 text-sm font-semibold text-ln-text">Revisá tu correo</p>
                  <p className="mt-1 text-xs leading-relaxed text-ln-muted">
                    Enviamos un enlace a <span className="text-ln-text">{emailInput.trim()}</span>.
                    Es válido por 15 minutos.
                  </p>
                  <button type="button" onClick={() => setEmailSent(false)} className={cn("mt-3 text-xs", linkCls)}>
                    Usar otro email
                  </button>
                </div>
              ) : emailLoginEnabled ? (
                <form
                  className="mt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void requestMagicLink();
                  }}
                >
                  <label htmlFor="login-email" className="sr-only">Email</label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    placeholder="tu@correo.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className={inputCls}
                  />
                  <button type="submit" className={cn(primaryBtn, "mt-3 w-full")} disabled={busy || !emailInput.trim()}>
                    {busy ? "Enviando…" : "Recibir enlace para entrar"}
                  </button>
                  <p className="mt-2 text-center text-[11px] leading-relaxed text-ln-faint">
                    Si es tu primera vez, preparamos tu cuenta automáticamente.
                  </p>
                </form>
              ) : (
                <p className="mt-4 rounded-xl border border-ln-corona/25 bg-ln-corona/[0.07] p-3 text-xs leading-relaxed text-ln-corona-bright">
                  El acceso por email está temporalmente fuera de servicio. Podés usar otra opción mientras lo restablecemos.
                </p>
              )}
            </section>

            {isDesktop && hasExtension ? (
              <button
                type="button"
                onClick={loginExtension}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-2xl border border-ln-aurora/30 bg-ln-aurora/[0.07] p-4 text-left transition hover:border-ln-aurora/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-ln-aurora/40 disabled:opacity-50"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ln-aurora/15 text-xl" aria-hidden>◈</span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-ln-text">Entrar con tu extensión</span>
                  <span className="mt-0.5 block text-xs text-ln-muted">Detectamos una extensión compatible en este navegador.</span>
                </span>
                <span className="text-sm font-semibold text-ln-aurora-bright">{busy ? "Entrando…" : "Continuar"}</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setView("advanced");
                setMethod(null);
                setError(null);
              }}
              className={cn(secondaryBtn, "w-full")}
            >
              Ver otras opciones
            </button>
          </div>
        ) : (
          <div className="mt-5">
            {!method ? (
              <div className="space-y-2.5">
                {isDesktop
                  ? methodButton(
                      "extension",
                      "◈",
                      "Extensión del navegador",
                      hasExtension ? "Usar la extensión detectada." : "Instalar o usar nos2x o Alby.",
                    )
                  : null}
                {methodButton("qr", "▦", "Escanear un código QR", "Aprobá el acceso desde una app compatible en tu celular.")}
                {methodButton("bunker", "⌁", "Conectarse con un bunker", "Pegá los datos de Nostr Connect de tu firmante remoto.")}
                {methodButton("nsec", "⌨", "Introducir una clave privada", "Usá una nsec existente sólo durante esta sesión.")}
                {methodButton("temporary", "＋", "Crear una identidad temporal", "Generá una clave nueva para probar la tienda.")}
              </div>
            ) : null}

            {method === "extension" && isDesktop ? (
              <div>
                {hasExtension ? (
                  <>
                    <p className="text-sm leading-relaxed text-ln-muted">
                      La extensión firma el acceso sin compartir tu clave privada con Luna Negra.
                    </p>
                    <button type="button" className={cn(primaryBtn, "mt-4 w-full")} onClick={loginExtension} disabled={busy}>
                      {busy ? "Iniciando sesión…" : "Iniciar sesión con la extensión"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-ln-muted">
                      No detectamos una extensión compatible. Instalá una, configurala y volvé a abrir esta opción.
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <a href={NOS2X_URL} target="_blank" rel="noopener noreferrer" className={cn(secondaryBtn, "text-sm no-underline")}>Instalar nos2x ↗</a>
                      <a href={ALBY_URL} target="_blank" rel="noopener noreferrer" className={cn(secondaryBtn, "text-sm no-underline")}>Instalar Alby ↗</a>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {method === "qr" ? (
              <div className="flex flex-col items-center">
                <p className="mb-4 text-center text-sm leading-relaxed text-ln-muted">
                  Escaneá el código desde una aplicación compatible con Nostr Connect. Te recomendamos <span className="font-semibold text-ln-text">Primal</span> en el celular.
                </p>
                <div className="mb-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
                  <a href={PRIMAL_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>Descargar Primal ↗</a>
                  <a href={PRIMAL_PLAY_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>Ver en Google Play ↗</a>
                </div>

                {isMobile && qrUri ? (
                  <div className="mb-4 w-full">
                    <a href={qrUri} className={cn(primaryBtn, "flex w-full items-center justify-center no-underline")}>Abrir en mi app</a>
                    {!revealQr ? (
                      <button type="button" onClick={() => setRevealQr(true)} className={cn("mt-3 w-full text-center text-xs", linkCls)}>
                        Mostrar QR para otro dispositivo
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {!isMobile || revealQr ? (
                  <>
                    {qrDataUrl ? (
                      <div className="rounded-2xl bg-white p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrDataUrl} alt="Código QR para iniciar sesión" className="block h-[240px] w-[240px]" width={240} height={240} />
                      </div>
                    ) : (
                      <div className="flex h-[240px] w-[240px] items-center justify-center rounded-2xl border border-white/10 bg-ln-bg-deep p-5 text-center text-sm text-ln-faint">
                        {qrUri ? "Este navegador bloquea la imagen. Copiá el enlace de conexión." : "Generando código…"}
                      </div>
                    )}
                    {qrUri ? (
                      <button type="button" onClick={() => navigator.clipboard.writeText(qrUri).catch(() => {})} className={cn("mt-3 font-mono text-[10px] uppercase tracking-[.12em]", linkCls)}>
                        Copiar enlace de conexión
                      </button>
                    ) : null}
                  </>
                ) : null}
                {authUrl ? <a href={authUrl} target="_blank" rel="noopener noreferrer" className={cn("mt-2 text-xs", linkCls)}>Abrir autorización ↗</a> : null}
                <p className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.14em] text-ln-aurora-bright">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-ln-aurora" /> Esperando aprobación…
                </p>
              </div>
            ) : null}

            {method === "bunker" ? (
              <div>
                <p className="text-sm leading-relaxed text-ln-muted">
                  Pegá una dirección <span className="font-mono text-ln-text">bunker://…</span> o tu identificador <span className="font-mono text-ln-text">usuario@dominio</span>.
                </p>
                <input type="text" autoComplete="off" spellCheck={false} placeholder="bunker://… o usuario@dominio" value={bunkerInput} onChange={(e) => setBunkerInput(e.target.value)} className={cn("mt-3 font-mono", inputCls)} />
                <button type="button" className={cn(primaryBtn, "mt-3 w-full")} onClick={loginBunker} disabled={busy || !bunkerInput.trim()}>
                  {busy ? "Conectando…" : "Iniciar sesión"}
                </button>
                {authUrl ? <a href={authUrl} target="_blank" rel="noopener noreferrer" className={cn("mt-3 block text-xs", linkCls)}>Abrir autorización ↗</a> : null}
              </div>
            ) : null}

            {method === "nsec" ? (
              <div>
                <p className="text-sm leading-relaxed text-ln-muted">
                  La clave se usa para firmar en este dispositivo y <span className="font-semibold text-ln-text">nunca se envía al servidor ni se guarda en el navegador</span>. Al recargar, vas a tener que ingresarla otra vez.
                </p>
                <p className="mt-3 rounded-xl border border-ln-danger/[0.28] bg-ln-danger/[0.08] p-3 text-xs leading-relaxed text-[#e8a99a]">
                  No la pegues en una computadora compartida. Quien conoce tu nsec controla tu identidad.
                </p>
                <label htmlFor="login-nsec" className="mt-4 block text-xs font-semibold text-ln-soft">Clave privada nsec</label>
                <input id="login-nsec" type="password" autoComplete="off" spellCheck={false} placeholder="nsec1…" value={nsecInput} onChange={(e) => setNsecInput(e.target.value)} className={cn("mt-1.5 font-mono", inputCls)} />
                <button type="button" className={cn(primaryBtn, "mt-3 w-full")} onClick={loginImported} disabled={busy || !nsecInput.trim()}>
                  {busy ? "Iniciando sesión…" : "Usar esta clave"}
                </button>
              </div>
            ) : null}

            {method === "temporary" ? (
              <div>
                {generated ? (
                  <>
                    <p className="text-sm leading-relaxed text-ln-muted">
                      Guardá esta clave ahora. Se muestra una sola vez y es la única forma de recuperar la identidad después de cerrar o recargar.
                    </p>
                    <div className="mt-3 break-all rounded-xl border border-ln-corona/35 bg-ln-bg-deep p-3 font-mono text-xs text-ln-corona-bright">{generated.nsec}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" className={secondaryBtn} onClick={copyGenerated}>{copied ? "Copiada ✓" : "Copiar clave"}</button>
                      <button type="button" className={primaryBtn} onClick={loginGenerated} disabled={busy}>{busy ? "Entrando…" : "Ya la guardé"}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-ln-muted">
                      Creamos una identidad para probar la tienda. Es temporal hasta que guardes su clave: si la perdés, no podremos recuperarla.
                    </p>
                    <p className="mt-3 text-xs leading-relaxed text-ln-faint">
                      Después te llevaremos a elegir un nombre. La foto de perfil es opcional.
                    </p>
                    <button type="button" className={cn(primaryBtn, "mt-4 w-full")} onClick={generateKey} disabled={busy}>Crear identidad temporal</button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-4 rounded-xl border border-ln-danger/25 bg-ln-danger/[0.08] p-3 text-sm text-ln-danger">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
