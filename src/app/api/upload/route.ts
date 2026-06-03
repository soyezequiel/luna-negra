import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// Sube una imagen a Vercel Blob y devuelve su URL pública.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const filename =
    new URL(req.url).searchParams.get("filename") || `img-${Date.now()}`;
  const contentType = req.headers.get("content-type") || undefined;

  try {
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
    }
    const blob = await put(`luna-negra/${filename}`, bytes, {
      access: "public",
      addRandomSuffix: true,
      contentType,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("Blob upload error:", detail);
    // Devolvemos el detalle real para poder diagnosticar.
    return NextResponse.json({ error: `Blob: ${detail}` }, { status: 502 });
  }
}
