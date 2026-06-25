import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Carpeta donde se guardan las imágenes subidas. En self-host (Docker) es un
// volumen persistente montado en /app/uploads (ver docker-compose.yml). En dev
// local cae en <cwd>/uploads (gitignored). Se sirven en /uploads/<archivo>
// (ver src/app/uploads/[...path]/route.ts).
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");

// Tope de tamaño: evita abusar el endpoint como hosting de archivos grandes y
// limita el costo/DoS. Portadas/capturas de juego entran de sobra. Los videos
// (trailers, estilo Steam) necesitan mucho más; se sube por separado y por
// debajo del tope de 100 MB del túnel de Cloudflare.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_UPLOAD_BYTES || 64 * 1024 * 1024); // 64 MB

// Imágenes y videos. No confiamos en el content-type declarado: lo cruzamos con
// la firma real del archivo (magic bytes) para que no se pueda subir HTML/SVG/JS
// disfrazado de media a una URL pública.
const ALLOWED_IMAGE = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const ALLOWED_VIDEO = new Set(["video/mp4", "video/webm"]);

// MIME detectado → extensión del archivo en disco.
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** Detecta el tipo real por magic bytes. Devuelve el MIME o null si no es imagen. */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // GIF: "GIF8"
  if (buf.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  // RIFF....WEBP
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // AVIF: caja ftyp con brand "avif"/"avis" en los bytes 8..12
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

// Brands ISO BMFF que tratamos como MP4 reproducible en navegador. AVIF también
// usa la caja ftyp pero con brand avif/avis (lo captura sniffImageType primero).
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "mp4v",
  "avc1",
  "M4V ",
  "dash",
  "mmp4",
]);

/** Detecta video por magic bytes. Devuelve el MIME o null si no reconoce. */
function sniffVideoType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // WebM / Matroska: cabecera EBML 1A 45 DF A3.
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "video/webm";
  }
  // MP4 / ISO BMFF: "ftyp" en bytes 4..8; el brand 8..12 lo distingue de AVIF.
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (MP4_BRANDS.has(brand)) return "video/mp4";
  }
  return null;
}

// Guarda una imagen en el disco del server y devuelve su URL pública.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const rl = await checkRateLimit(`upload:${session.sub}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Demasiados intentos" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  // Rechazo temprano por content-length declarado (no esperamos a bufferear). Se
  // usa el tope más alto (video); el tope por tipo se aplica al detectarlo.
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (declaredLen > MAX_VIDEO_BYTES) {
    return NextResponse.json({ error: "Archivo demasiado grande" }, { status: 413 });
  }

  const rawName = new URL(req.url).searchParams.get("filename") || "";
  // Solo usamos el nombre declarado para un prefijo legible; la extensión real la
  // define el MIME detectado y agregamos un sufijo aleatorio, así que no hay
  // riesgo de traversal ni de colisión.
  const baseName =
    rawName
      .replace(/\.[^./\\]*$/, "") // saca la extensión declarada
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .slice(0, 60) || "img";

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 400 });
  }
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  }

  // El tipo lo decide la firma real del archivo, no el header del request. Primero
  // imagen (AVIF comparte la caja ftyp con MP4), después video.
  const detected = sniffImageType(bytes) ?? sniffVideoType(bytes);
  const isVideo = !!detected && ALLOWED_VIDEO.has(detected);
  if (!detected || (!ALLOWED_IMAGE.has(detected) && !isVideo)) {
    return NextResponse.json(
      { error: "Formato no permitido (imágenes PNG/JPEG/WebP/GIF/AVIF o video MP4/WebM)" },
      { status: 415 },
    );
  }

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (bytes.byteLength > maxBytes) {
    return NextResponse.json({ error: "Archivo demasiado grande" }, { status: 413 });
  }

  const filename = `${baseName}-${randomBytes(8).toString("hex")}.${EXT_BY_MIME[detected]}`;

  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(path.join(UPLOADS_DIR, filename), bytes);
  } catch (e) {
    // El detalle real solo al log del server; al cliente, mensaje genérico.
    console.error("Upload write error:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "No se pudo subir la imagen" }, { status: 502 });
  }

  // URL absoluta usando el dominio público (la misma env que usan los anuncios
  // Nostr). Si no está seteada, cae a una ruta relativa (sirve igual con <img>).
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  const url = `${site}/uploads/${filename}`;
  return NextResponse.json({ url });
}
