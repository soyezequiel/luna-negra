"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/providers/session-provider";

type Status = "verifying" | "ok" | "error";

function EmailCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const { adoptCustodialSession } = useSession();
  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);
  // Evita doble canje del token (StrictMode monta el efecto dos veces en dev).
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      const token = params.get("token");
      if (!token) {
        setStatus("error");
        setError("Falta el token del enlace.");
        return;
      }
      try {
        const res = await fetch("/api/auth/email/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "No se pudo iniciar sesión");
        adoptCustodialSession(data.user, data.nsec);
        setStatus("ok");
        setTimeout(() => router.replace("/"), 1200);
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "No se pudo iniciar sesión");
      }
    })();
  }, [params, router, adoptCustodialSession]);

  return (
    <div className="mx-auto max-w-md px-[22px] py-24 text-center">
      {status === "verifying" ? (
        <>
          <h1 className="font-display text-2xl font-extrabold text-white">
            Iniciando sesión…
          </h1>
          <p className="mt-2 text-ln-muted">Validando tu enlace de acceso.</p>
        </>
      ) : null}

      {status === "ok" ? (
        <>
          <h1 className="font-display text-2xl font-extrabold text-white">
            ¡Listo! 🌙
          </h1>
          <p className="mt-2 text-ln-muted">
            Sesión iniciada. Te llevamos a la tienda…
          </p>
        </>
      ) : null}

      {status === "error" ? (
        <>
          <h1 className="font-display text-2xl font-extrabold text-white">
            No pudimos iniciar sesión
          </h1>
          <p className="mt-2 text-ln-danger">{error}</p>
          <div className="mt-5 flex justify-center">
            <Link href="/" className="btn btn-ghost px-4 py-2 text-sm">
              Volver al inicio
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function EmailAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-[22px] py-24 text-center text-ln-muted">
          Cargando…
        </div>
      }
    >
      <EmailCallback />
    </Suspense>
  );
}
