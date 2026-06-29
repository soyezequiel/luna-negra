"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import { publishProfile } from "@/lib/nostr-social";
import { profileName, type NostrProfile } from "@/lib/nostr";
import { hueFromSlug } from "@/lib/format";

const INPUT_CLASS =
  "w-full rounded-ln-md border border-ln-border bg-ln-bg-deep px-3 py-2 text-sm text-ln-text placeholder:text-ln-faint focus:outline-none focus:ring-2 focus:ring-ln-corona/40";

/**
 * Edición del perfil Nostr (kind:0): foto, nombre para mostrar, nombre de
 * usuario y bio. Al guardar firma un kind:0 nuevo con el signer activo y lo
 * publica a los relays (la fuente de verdad del perfil), y de paso refresca el
 * caché de la DB (`displayName`/`avatarUrl`) que la tienda muestra del lado
 * servidor.
 */
export function NostrProfileForm({ profile }: { profile: NostrProfile | null }) {
  const { user, updateUser } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sembrar el formulario con el perfil actual la primera vez que carga, sin
  // pisar lo que el usuario esté tipeando si el fetch resuelve tarde.
  useEffect(() => {
    if (!profile || hydrated) return;
    // Sembrado único desde un prop que llega async (fetch del perfil); el guard
    // `hydrated` evita pisar lo tipeado. Uso legítimo del efecto.
    /* eslint-disable react-hooks/set-state-in-effect */
    setDisplayName(profile.displayName || profile.display_name || "");
    setName(profile.name || "");
    setAbout(profile.about || "");
    setPicture(profile.picture || "");
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [profile, hydrated]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/upload?filename=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo subir la imagen");
      setPicture(d.url);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir la imagen");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setStatus("saving");
    setError(null);
    try {
      const merged = await publishProfile(user.pubkey, {
        display_name: displayName.trim() || undefined,
        name: name.trim() || undefined,
        about: about.trim() || undefined,
        picture: picture.trim() || undefined,
      });
      // Refrescar el caché que usa el server (nombre/avatar) para que la tienda
      // no quede mostrando el perfil viejo hasta el próximo login.
      const cachedName = profileName(merged);
      const avatarUrl = merged.picture ?? null;
      await fetch("/api/users/me/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: cachedName, avatarUrl }),
      }).catch(() => {});
      updateUser({ displayName: cachedName, avatarUrl });
      setStatus("saved");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  const initials = (displayName || name || "?").slice(0, 2).toUpperCase();

  return (
    <section className="rounded-ln-lg border border-ln-border bg-ln-card/60 p-5">
      <h2 className="text-[15px] font-semibold text-ln-text">Perfil Nostr</h2>
      <p className="mt-1 text-sm text-ln-muted">
        Tu foto y nombre se publican en Nostr (kind:0) y se ven en cualquier
        cliente. Los cambios se firman con tu identidad.
      </p>

      <form onSubmit={save} className="mt-4 space-y-4">
        {/* Foto */}
        <div className="flex items-center gap-4">
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={picture}
              alt=""
              referrerPolicy="no-referrer"
              className="h-16 w-16 shrink-0 rounded-full border border-ln-border object-cover"
            />
          ) : (
            <span
              className="av-gen flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-ln-border font-display text-xl font-bold text-white"
              style={{ "--h": hueFromSlug(user?.npub ?? name) } as CSSProperties}
            >
              {initials}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              onChange={onPickFile}
              className="hidden"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Subiendo…" : "Subir foto"}
            </Button>
            {picture ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPicture("");
                  setStatus("idle");
                }}
              >
                Quitar
              </Button>
            ) : null}
          </div>
        </div>

        <Field label="URL de la foto" hint="O pegá un enlace a tu avatar.">
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://…"
            value={picture}
            onChange={(e) => {
              setPicture(e.target.value);
              setStatus("idle");
            }}
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
        </Field>

        <Field label="Nombre para mostrar">
          <input
            type="text"
            autoComplete="off"
            placeholder="Cómo te ven los demás"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setStatus("idle");
            }}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Nombre de usuario" hint="Tu handle corto (sin espacios).">
          <input
            type="text"
            autoComplete="off"
            placeholder="usuario"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setStatus("idle");
            }}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Bio">
          <textarea
            rows={3}
            placeholder="Contá algo sobre vos"
            value={about}
            onChange={(e) => {
              setAbout(e.target.value);
              setStatus("idle");
            }}
            className={`${INPUT_CLASS} resize-y`}
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button
            variant="corona"
            type="submit"
            disabled={status === "saving" || uploading}
          >
            {status === "saving" ? "Publicando…" : "Guardar cambios"}
          </Button>
          {status === "error" ? (
            <span className="text-sm text-ln-danger">{error}</span>
          ) : null}
        </div>

        {status === "saved" ? (
          <div className="rounded-ln-md border border-ln-aurora/30 bg-ln-aurora/10 p-3 text-sm">
            <p className="font-medium text-ln-aurora">Cambios publicados ✓</p>
            <p className="mt-1 text-ln-soft">
              Pueden tardar unos segundos en verse en toda la app y en otros
              clientes Nostr mientras se propagan por los relays.{" "}
              <span className="text-ln-muted">
                No hace falta volver a guardar: si todavía ves el dato viejo,
                esperá un momento y recargá.
              </span>
            </p>
          </div>
        ) : null}

        {status !== "error" && status !== "saved" && error ? (
          <p className="text-sm text-ln-danger">{error}</p>
        ) : null}
      </form>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-ln-soft">{label}</span>
      {hint ? (
        <span className="ml-2 text-[12px] text-ln-faint">{hint}</span>
      ) : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
