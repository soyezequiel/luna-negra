import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

// Carpeta donde viven las imágenes subidas (volumen persistente en Docker). Debe
// coincidir con la de src/app/api/upload/route.ts.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");

// Solo servimos imágenes; la extensión decide el Content-Type.
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  // Los archivos viven planos en UPLOADS_DIR (un único segmento, sin subcarpetas).
  // Cualquier intento de traversal o ruta anidada se rechaza.
  if (!segments || segments.length !== 1) return notFound();
  const name = segments[0];
  if (!name || name !== path.basename(name) || name.startsWith(".")) return notFound();

  const ext = path.extname(name).toLowerCase();
  const contentType = CONTENT_TYPE_BY_EXT[ext];
  if (!contentType) return notFound();

  // Defensa extra: el path resuelto tiene que quedar dentro de UPLOADS_DIR.
  const root = path.resolve(UPLOADS_DIR);
  const filePath = path.resolve(root, name);
  if (filePath !== path.join(root, name)) return notFound();

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    return notFound();
  }

  // Nombres con sufijo aleatorio → el contenido es inmutable, cache agresiva.
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
