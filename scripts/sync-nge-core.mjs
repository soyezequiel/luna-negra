// Sincroniza los artefactos COMPARTIDOS del protocolo NGE de Luna → Tetris.
//
// Solo el WIRE del protocolo se comparte entre los dos repos; Luna es la fuente
// de verdad y Tetris tiene copias byte-idénticas:
//   - sdk/nge-core.ts            → núcleo puro (kinds, URI, cifrado, templates)
//   - docs/nge/test-vectors.json → vectores de conformance firmados
// La ergonomía del cliente (sdk/nge-client.ts) NO se sincroniza: la posee Tetris.
//
// Uso:
//   node scripts/sync-nge-core.mjs [ruta-repo-tetris]   # copia
//   node scripts/sync-nge-core.mjs --check [ruta]        # solo verifica (CI/pre-commit)
//
// Sin argumento, asume que Tetris es hermano de este repo: ../tetris
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lunaRoot = resolve(here, "..");

const args = process.argv.slice(2);
const check = args.includes("--check");
const tetrisArg = args.find((a) => !a.startsWith("--"));
const tetrisRoot = resolve(tetrisArg ?? join(lunaRoot, "..", "tetris"));

// Pares { src (en Luna) → dest (en Tetris) } de los artefactos compartidos.
const FILES = [
  { src: join("sdk", "nge-core.ts"), dest: join("sdk", "nge-core.ts") },
  { src: join("docs", "nge", "test-vectors.json"), dest: join("sdk", "nge-test-vectors.json") },
];

if (!existsSync(join(tetrisRoot, "sdk"))) {
  console.error(`✗ no encuentro sdk/ en el repo de Tetris: ${tetrisRoot}`);
  console.error(`  pasá la ruta: node scripts/sync-nge-core.mjs <ruta-repo-tetris>`);
  process.exit(1);
}

let drift = 0;
let synced = 0;
for (const { src, dest } of FILES) {
  const srcPath = join(lunaRoot, src);
  const destPath = join(tetrisRoot, dest);
  if (!existsSync(srcPath)) {
    console.error(`✗ no encuentro el artefacto canónico: ${srcPath}`);
    process.exit(1);
  }
  const srcContent = readFileSync(srcPath, "utf8");
  const destContent = existsSync(destPath) ? readFileSync(destPath, "utf8") : null;
  if (srcContent === destContent) continue;

  if (check) {
    console.error(`✗ ${dest} DIVERGIÓ entre Luna y Tetris`);
    drift++;
    continue;
  }
  writeFileSync(destPath, srcContent);
  console.log(`✓ sincronizado ${dest}`);
  synced++;
}

if (check && drift > 0) {
  console.error(`\ncorré: node scripts/sync-nge-core.mjs "${tetrisRoot}"`);
  process.exit(1);
}
console.log(synced === 0 ? "✓ todo en sync" : `✓ ${synced} archivo(s) sincronizado(s)`);
