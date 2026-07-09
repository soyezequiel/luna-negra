"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { categoryLabel } from "@/lib/categories";
import {
  RevenueShareControl,
  BetFeeControl,
  IsBetaControl,
} from "./admin-controls";
import {
  type ReviewGame,
  type DraftGame,
  type CatalogRow,
  type Row,
  ADMIN_DATE,
  shortNpub,
  draftAge,
  missingDraftFields,
  parseShots,
} from "./admin-types";

// ── Review detail (expandable) ──

function ReviewDetail({
  g,
  betFeeFallback,
  onSaved,
}: {
  g: ReviewGame;
  betFeeFallback: number;
  onSaved: () => void | Promise<void>;
}) {
  const shots = parseShots(g.screenshots);
  return (
    <div className="mt-3 space-y-4 border-t border-line pt-3 text-xs">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-faint">Precio</dt>
          <dd className="text-ink">
            {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Revenue share</dt>
          <dd className="text-ink">
            <RevenueShareControl
              gameId={g.id}
              revenueShare={g.revenueShare}
              onSaved={onSaved}
            />
          </dd>
        </div>
        <div>
          <dt className="text-faint">Comisión apuestas</dt>
          <dd className="text-ink">
            <BetFeeControl
              gameId={g.id}
              value={g.betFeePct}
              fallback={betFeeFallback}
              onSaved={onSaved}
            />
          </dd>
        </div>
        <div>
          <dt className="text-faint">Slug</dt>
          <dd className="font-mono text-ink">{g.slug}</dd>
        </div>
        <div>
          <dt className="text-faint">Categorías</dt>
          <dd className="text-ink">
            {g.categories.length
              ? g.categories.map(categoryLabel).join(", ")
              : "Sin categoría"}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Creado</dt>
          <dd className="text-ink">
            {new Date(g.createdAt).toLocaleString("es-AR")}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Estado Beta</dt>
          <dd className="text-ink">
            <IsBetaControl gameId={g.id} isBeta={g.isBeta} onSaved={onSaved} />
          </dd>
        </div>
        <div>
          <dt className="text-faint">URL del juego</dt>
          <dd className="truncate text-ink">
            {g.gameUrl ? (
              <a
                href={g.gameUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue underline"
              >
                {g.gameUrl}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      <div>
        <p className="text-faint">Descripción</p>
        <p className="mt-1 whitespace-pre-wrap text-ink">
          {g.description?.trim() ? g.description : "—"}
        </p>
      </div>

      {(g.coverUrl || g.horizontalCoverUrl || shots.length > 0) && (
        <div className="space-y-2">
          <p className="text-faint">Imágenes</p>
          <div className="flex flex-wrap gap-2">
            {g.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.coverUrl}
                alt="Portada vertical"
                referrerPolicy="no-referrer"
                className="h-32 w-auto rounded border border-line object-cover"
              />
            ) : null}
            {g.horizontalCoverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.horizontalCoverUrl}
                alt="Portada horizontal"
                referrerPolicy="no-referrer"
                className="h-32 w-auto rounded border border-line object-cover"
              />
            ) : null}
            {shots.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={`Captura ${i + 1}`}
                referrerPolicy="no-referrer"
                className="h-32 w-auto rounded border border-line object-cover"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Games Tab ──

export function GamesTab({
  drafts,
  games,
  unannounced,
  catalog,
  betFeeFallback,
  busy,
  onApprove,
  onReject,
  onAnnounce,
  onRemoveGame,
  onLoad,
}: {
  drafts: DraftGame[] | null;
  games: ReviewGame[] | null;
  // La API manda el Game entero: el estado de firma decide el texto del botón
  // (provider sin firma retenida → el anuncio necesita al proveedor).
  unannounced: (Row & { articleSigner?: string; signedArticle?: unknown })[];
  catalog: CatalogRow[];
  betFeeFallback: number;
  busy: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAnnounce: (id: string) => void;
  onRemoveGame: (g: CatalogRow) => void;
  onLoad: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      {/* Borradores sin enviar */}
      <section>
        <h2 className="mb-1 font-semibold text-ink">Borradores sin enviar</h2>
        <p className="mb-3 text-xs text-faint">
          Juegos que ahora están fuera de revisión; incluye fichas nuevas o
          devueltas a borrador. Los más antiguos aparecen primero.
        </p>
        {drafts === null ? (
          <p className="text-sm text-faint">Cargando…</p>
        ) : drafts.length === 0 ? (
          <p className="text-muted">No hay borradores pendientes.</p>
        ) : (
          <ul className="space-y-2">
            {drafts.map((g) => {
              const missing = missingDraftFields(g);
              const ownerLabel =
                g.provider.owner.displayName?.trim() ||
                shortNpub(g.provider.owner.npub);
              return (
                <li
                  key={g.id}
                  className="rounded-lg border border-line bg-panel px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {g.title}
                      </p>
                      <p className="mt-0.5 text-xs text-faint">
                        {g.provider.name} · Dueño:{" "}
                        <a
                          href={`https://njump.me/${g.provider.owner.npub}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue hover:underline"
                        >
                          {ownerLabel}
                        </a>
                      </p>
                      <p className="mt-1 text-[11px] text-faint">
                        Creado {draftAge(g.createdAt)} ·{" "}
                        <time dateTime={g.createdAt}>
                          {ADMIN_DATE.format(new Date(g.createdAt))}
                        </time>
                      </p>
                    </div>
                    <span
                      className={
                        missing.length === 0
                          ? "shrink-0 rounded border border-ln-corona/35 bg-ln-corona/10 px-2 py-1 text-[11px] font-medium text-ln-corona"
                          : "shrink-0 rounded border border-line px-2 py-1 text-[11px] text-muted"
                      }
                    >
                      {missing.length === 0
                        ? "Parece listo para enviar"
                        : `${4 - missing.length}/4 datos de ficha`}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {missing.length === 0
                      ? "Tiene URL, descripción, categoría y portada."
                      : `Pendiente: ${missing.join(", ")}.`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Juegos en revisión */}
      <section>
        <h2 className="mb-3 font-semibold text-ink">Juegos en revisión</h2>
        {games === null ? (
          <p className="text-sm text-faint">Cargando…</p>
        ) : games.length === 0 ? (
          <p className="text-muted">No hay juegos en revisión.</p>
        ) : (
          <ul className="space-y-2">
            {games.map((g) => {
              const open = expanded === g.id;
              return (
                <li
                  key={g.id}
                  className="rounded-lg border border-line bg-panel px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : g.id)}
                      className="min-w-0 flex-1 text-left"
                      aria-expanded={open}
                    >
                      <p className="text-sm font-medium">
                        <span className="mr-1.5 inline-block text-faint">
                          {open ? "▾" : "▸"}
                        </span>
                        {g.title}
                      </p>
                      <p className="text-xs text-faint">
                        {g.provider.name} ·{" "}
                        {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`}
                        {/* Estado de la firma del artículo (régimen provider):
                            sin ella el approve no puede difundir a Nostr. */}
                        {g.articleSigner === "provider" ? (
                          g.signedArticle != null ? (
                            <span className="ml-2 rounded-full bg-ln-aurora/15 px-1.5 py-0.5 text-[10px] font-semibold text-ln-aurora">
                              Firma del proveedor ✓
                            </span>
                          ) : (
                            <span className="ml-2 rounded-full bg-ln-corona/15 px-1.5 py-0.5 text-[10px] font-semibold text-ln-corona">
                              Falta la firma del proveedor
                            </span>
                          )
                        ) : null}
                      </p>
                    </button>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        onClick={() => onApprove(g.id)}
                        disabled={
                          g.articleSigner === "provider" && g.signedArticle == null
                        }
                        title={
                          g.articleSigner === "provider" && g.signedArticle == null
                            ? "El proveedor debe firmar el artículo desde su panel antes de aprobar"
                            : undefined
                        }
                      >
                        Aprobar
                      </Button>
                      <Button variant="ghost" onClick={() => onReject(g.id)}>
                        Rechazar
                      </Button>
                    </div>
                  </div>
                  {open ? (
                    <ReviewDetail
                      g={g}
                      betFeeFallback={betFeeFallback}
                      onSaved={onLoad}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Sin anuncio en Nostr */}
      {unannounced.length > 0 ? (
        <section>
          <h2 className="mb-1 font-semibold text-ink">Sin anuncio en Nostr</h2>
          <p className="mb-3 text-xs text-faint">
            Juegos publicados sin posteo raíz. Anunciá para que comentarios y
            reseñas se cuelguen de un hilo en Nostr.
          </p>
          <ul className="space-y-2">
            {unannounced.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-faint">
                    {g.provider.name}
                    {g.articleSigner === "provider" && g.signedArticle == null ? (
                      <span className="ml-2 text-ln-corona">
                        · necesita la firma del proveedor (desde su panel)
                      </span>
                    ) : null}
                  </p>
                </div>
                <Button
                  onClick={() => onAnnounce(g.id)}
                  disabled={
                    busy === g.id ||
                    (g.articleSigner === "provider" && g.signedArticle == null)
                  }
                >
                  {busy === g.id
                    ? "Anunciando…"
                    : g.articleSigner === "provider"
                      ? "Re-difundir firma"
                      : "Anunciar en Nostr"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Catálogo publicado */}
      <section>
        <h2 className="mb-1 font-semibold text-ink">Catálogo publicado</h2>
        <p className="mb-3 text-xs text-faint">
          Borrar un juego es permanente: se quita del catálogo y de la
          biblioteca de quienes lo poseen. Bloqueado si tiene apuestas activas.
        </p>
        {catalog.length === 0 ? (
          <p className="text-muted">No hay juegos publicados.</p>
        ) : (
          <ul className="space-y-2">
            {catalog.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs text-faint">
                    {g.provider.name} ·{" "}
                    {g.priceSats === 0 ? "Gratis" : `${g.priceSats} sats`} ·{" "}
                    {g.owners} en biblioteca
                  </p>
                  <div className="mt-1 text-xs text-faint flex gap-3 items-center">
                    <RevenueShareControl
                      gameId={g.id}
                      revenueShare={g.revenueShare}
                      onSaved={onLoad}
                      compact
                    />
                    <div className="w-[1px] h-3 bg-line"></div>
                    <IsBetaControl gameId={g.id} isBeta={g.isBeta} onSaved={onLoad} />
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => onRemoveGame(g)}
                  disabled={busy === g.id}
                >
                  {busy === g.id ? "Borrando…" : "Borrar"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
