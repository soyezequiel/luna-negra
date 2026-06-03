import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";

// Sube una imagen a Vercel Blob y devuelve su URL pública.
// Requiere BLOB_READ_WRITE_TOKEN (se crea al activar Blob Storage en Vercel).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Subida no configurada. Activá Vercel Blob o pegá una URL." },
      { status: 501 },
    );
  }
  if (!req.body) {
    return NextResponse.json({ error: "Sin archivo" }, { status: 400 });
  }

  const filename =
    new URL(req.url).searchParams.get("filename") || `img-${Date.now()}`;

  const blob = await put(`luna-negra/${filename}`, req.body, {
    access: "public",
    addRandomSuffix: true,
  });
  return NextResponse.json({ url: blob.url });
}
