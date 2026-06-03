import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";

// Sube una imagen a Vercel Blob y devuelve su URL pública.
// Autenticación: token OIDC del proyecto (o BLOB_READ_WRITE_TOKEN si está seteado).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "Sin archivo" }, { status: 400 });
  }

  const filename =
    new URL(req.url).searchParams.get("filename") || `img-${Date.now()}`;

  try {
    const blob = await put(`luna-negra/${filename}`, req.body, {
      access: "public",
      addRandomSuffix: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    console.error("Blob upload error:", e);
    return NextResponse.json(
      {
        error:
          "No se pudo subir la imagen (revisá que Vercel Blob esté conectado).",
      },
      { status: 502 },
    );
  }
}
