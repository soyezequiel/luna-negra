// Descarga "de un click" de las skills ya configuradas: lee el SKILL.md de la
// variante elegida y lo sirve con la base URL de este deploy ya reemplazada. Las
// skills viven en ./skills (layout estándar de `npx skills`).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SKILLS = [
  {
    version: "1.0",
    aliases: ["1", "1.0", "luna", "rest", "integrar-luna-negra-1-0"],
    name: "integrar-luna-negra-1-0",
    file: join(process.cwd(), "skills", "integrar-luna-negra-1-0", "SKILL.md"),
  },
  {
    version: "2.0",
    aliases: ["2", "2.0", "nostr", "integrar-luna-negra-2-0"],
    name: "integrar-luna-negra-2-0",
    file: join(process.cwd(), "skills", "integrar-luna-negra-2-0", "SKILL.md"),
  },
] as const;

function skillFrom(req: Request) {
  const url = new URL(req.url);
  const raw =
    url.searchParams.get("version") ??
    url.searchParams.get("skill") ??
    url.searchParams.get("name") ??
    "1.0";
  const key = raw.trim().toLowerCase();
  return SKILLS.find((skill) =>
    (skill.aliases as readonly string[]).includes(key),
  );
}

function originFrom(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "luna-negra.example";
  return proto + "://" + host;
}

export async function GET(req: Request) {
  const skill = skillFrom(req);
  if (!skill) {
    return new Response("Skill desconocida. Usa ?version=1.0 o ?version=2.0", {
      status: 400,
    });
  }

  const origin = originFrom(req);
  let md: string;
  try {
    md = await readFile(skill.file, "utf8");
  } catch {
    return new Response("No se pudo leer la skill", { status: 500 });
  }
  md = md.replaceAll("__LUNA_NEGRA_BASE__", origin);
  return new Response(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${skill.name}-SKILL.md"`,
      "cache-control": "no-store",
    },
  });
}
