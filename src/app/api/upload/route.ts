import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Tope de tamaño: evita abusar el endpoint como hosting de archivos grandes y
// limita el costo/DoS en Vercel Blob. Portadas/capturas de juego entran de sobra.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

// Solo imágenes. No confiamos en el content-type declarado: lo cruzamos con la
// firma real del archivo (magic bytes) para que no se pueda subir HTML/SVG/JS
// disfrazado de imagen a un blob público.
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

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

// Sube una imagen a Vercel Blob y devuelve su URL pública.
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

  // Rechazo temprano por content-length declarado (no esperamos a bufferear).
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (declaredLen > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Archivo demasiado grande" }, { status: 413 });
  }

  const rawName = new URL(req.url).searchParams.get("filename") || "";
  // Nos quedamos solo con la extensión declarada para diagnóstico; el nombre real
  // lo define Vercel Blob con sufijo aleatorio, así que no hay riesgo de traversal.
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || `img-${Date.now()}`;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 400 });
  }
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Archivo demasiado grande" }, { status: 413 });
  }

  // El tipo lo decide la firma real del archivo, no el header del request.
  const detected = sniffImageType(bytes);
  if (!detected || !ALLOWED.has(detected)) {
    return NextResponse.json(
      { error: "Formato no permitido (solo PNG, JPEG, WebP, GIF, AVIF)" },
      { status: 415 },
    );
  }

  try {
    const blob = await put(`luna-negra/${safeName}`, bytes, {
      access: "public",
      addRandomSuffix: true,
      contentType: detected,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    // El detalle real solo al log del server; al cliente, mensaje genérico.
    console.error("Blob upload error:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "No se pudo subir la imagen" }, { status: 502 });
  }
}
