// READ-ONLY. Diagnostica por qué el panel de integración no detecta el "marcador"
// (kind:31337) de un juego. La detección exige filas Score con sourceEventId != null
// (proyectadas por score-sync desde los eventos Nostr). Este script muestra, por
// juego: sus leaderboards, cuántos Score totales hay y cuántos con procedencia Nostr
// (sourceEventId), y los últimos con/ sin procedencia. Así se distingue:
//   - 0 scores            → score-sync no proyectó nada (no corre / no matchea coord).
//   - scores pero 0 Nostr → el récord vino por REST 1.0 y el de Nostr no lo superó
//                            (submitScore no setea sourceEventId si improved=false).
//
// No modifica nada. Imprime host:puerto de la DB para no confundir prod con dev.
// Uso:
//   node scripts/diag-scores.mjs                         # slug por defecto
//   node scripts/diag-scores.mjs --slug tetra-tetris-copia
//   DATABASE_URL="postgresql://.../luna" node scripts/diag-scores.mjs   # override de DB (prod)
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const slug = arg("slug", "tetra-tetris-copia");

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
    select: { id: true, slug: true, title: true, status: true, nostrCoord: true, capsMode: true },
  });
  if (!game) {
    console.error(`✗ No hay juego con slug "${slug}" en esta DB.`);
    process.exit(1);
  }
  console.log(`\nJuego: ${game.title} (${game.slug}) · status=${game.status}`);
  console.log(`nostrCoord: ${game.nostrCoord ?? "∅ (score-sync/live-presence NO lo consultan sin esto)"}`);
  console.log(`capsMode:   ${JSON.stringify(game.capsMode ?? {})}`);

  const boards = await prisma.leaderboard.findMany({
    where: { gameId: game.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`\nLeaderboards (${boards.length}): ${boards.map((b) => b.name).join(", ") || "—"}`);

  let totalAll = 0;
  let totalNostr = 0;
  for (const b of boards) {
    const [all, viaNostr, sample] = await Promise.all([
      prisma.score.count({ where: { leaderboardId: b.id } }),
      prisma.score.count({ where: { leaderboardId: b.id, sourceEventId: { not: null } } }),
      prisma.score.findMany({
        where: { leaderboardId: b.id },
        orderBy: { score: "desc" },
        take: 5,
        select: { npub: true, score: true, sourceEventId: true, updatedAt: true },
      }),
    ]);
    totalAll += all;
    totalNostr += viaNostr;
    console.log(`\n  · tabla "${b.name}": ${all} scores, ${viaNostr} con sourceEventId (Nostr)`);
    for (const s of sample) {
      console.log(
        `      ${s.score.toString().padStart(9)}  ${s.npub.slice(0, 14)}…  ${
          s.sourceEventId ? "Nostr(" + s.sourceEventId.slice(0, 8) + ")" : "REST/1.0 (sourceEventId=null)"
        }  ${s.updatedAt.toISOString()}`,
      );
    }
  }

  console.log(`\n── Resumen ──`);
  console.log(`Scores totales: ${totalAll} · con procedencia Nostr: ${totalNostr}`);
  if (totalNostr > 0) {
    console.log(`✓ Hay scores Nostr → el panel DEBERÍA detectar el marcador. Si no, es de caché de UI.`);
  } else if (totalAll > 0) {
    console.log(`⚠ Hay scores pero NINGUNO con sourceEventId → el récord vino por REST y el de Nostr no lo superó (bug improved=false en submitScore), o score-sync no corrió.`);
  } else {
    console.log(`⚠ 0 scores → score-sync no proyectó nada. Revisá que corra en prod, que nostrCoord esté seteado y que los kind:31337 tengan #a = ese coord.`);
  }
} finally {
  await prisma.$disconnect();
}
