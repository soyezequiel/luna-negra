// Migra una capacidad de un juego a la interfaz Nostr (NGP) seteando
// Game.capsMode[cap] = "nostr". Mergea con el capsMode existente (no pisa otras
// capacidades). Sirve, p. ej., para que Luna deje de mintear `lnToken` al lanzar
// un juego con login Nostr propio (identidad → nostr): así el ramal de
// `POST /api/games/:id/sessions` responde `nostrLogin:true` y el link va limpio.
//
// SEGURO POR DEFECTO: dry-run. Imprime a qué DB apunta y el antes/después; solo
// escribe con --apply. Verificá el host/puerto antes de aplicar (el .env local
// suele apuntar al Docker de dev en 5433; PROD va por el túnel SSH, típicamente
// 5434 — ver prod-db-tunnel.ps1 y la memoria db-local-dev-docker).
//
// Uso:
//   node scripts/set-caps-mode.mjs                       # dry-run, slug/ cap por defecto
//   node scripts/set-caps-mode.mjs --slug tetra-tetris-copia --cap identidad
//   node scripts/set-caps-mode.mjs --slug tetra-tetris-copia --cap identidad --apply
//   DATABASE_URL="postgresql://.../luna" node scripts/set-caps-mode.mjs --apply   # override explícito de DB
import { readFileSync } from "node:fs";

// Cargar DATABASE_URL desde .env solo si no vino ya por el entorno (permite
// overridear la DB sin tocar el archivo).
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const slug = arg("slug", "tetra-tetris-copia");
const cap = arg("cap", "identidad");
const value = arg("value", "nostr"); // "nostr" | "luna"
const apply = process.argv.includes("--apply");

const MIGRATABLE = ["identidad", "marcador", "presencia", "bets"];
if (!MIGRATABLE.includes(cap)) {
  console.error(`✗ cap inválida "${cap}". Migrables: ${MIGRATABLE.join(", ")}`);
  process.exit(1);
}

// Mostrar a qué DB apuntamos (sin la password) para evitar pegarle a la base
// equivocada.
try {
  const u = new URL(process.env.DATABASE_URL);
  console.log(`DB → ${u.hostname}:${u.port}${u.pathname}  (usuario ${u.username})`);
} catch {
  console.error("✗ DATABASE_URL ausente o inválida");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

try {
  const game = await prisma.game.findUnique({
    where: { slug },
    select: { id: true, slug: true, title: true, status: true, capsMode: true },
  });
  if (!game) {
    console.error(`✗ No hay juego con slug "${slug}" en esta DB.`);
    process.exit(1);
  }

  const before = game.capsMode && typeof game.capsMode === "object" ? game.capsMode : {};
  const after = { ...before, [cap]: value };

  console.log(`\nJuego: ${game.title} (${game.slug}) · status=${game.status}`);
  console.log(`capsMode ANTES:   ${JSON.stringify(before)}`);
  console.log(`capsMode DESPUÉS: ${JSON.stringify(after)}`);

  if (before[cap] === value) {
    console.log(`\n✓ "${cap}" ya está en "${value}" — nada que hacer.`);
    process.exit(0);
  }

  if (!apply) {
    console.log(`\n(dry-run) No se escribió nada. Reejecutá con --apply para aplicar.`);
    process.exit(0);
  }

  await prisma.game.update({ where: { id: game.id }, data: { capsMode: after } });
  console.log(`\n✓ Aplicado: ${game.slug}.capsMode.${cap} = "${value}".`);
} finally {
  await prisma.$disconnect();
}
