// Descarga "de un click" del SKILL.md ya configurado: lee el archivo fuente de
// public/skill/... y lo sirve con la base URL de este deploy ya reemplazada y como
// adjunto, para guardarlo directo en la carpeta de skills del agente.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SKILL_FILE = join(
  process.cwd(),
  "public",
  "skill",
  "integrar-luna-negra",
  "SKILL.md",
);

function originFrom(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "luna-negra.example";
  return proto + "://" + host;
}

export async function GET(req: Request) {
  const origin = originFrom(req);
  let md: string;
  try {
    md = await readFile(SKILL_FILE, "utf8");
  } catch {
    return new Response("No se pudo leer la skill", { status: 500 });
  }
  md = md.replaceAll("__LUNA_NEGRA_BASE__", origin);
  return new Response(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": 'attachment; filename="SKILL.md"',
      "cache-control": "no-store",
    },
  });
}
