// Instalador de la skill "integrar-luna-negra" para agentes de código.
// Sirve un script (sh por defecto, PowerShell con ?ps) que descarga el SKILL.md
// desde este mismo deploy y, de paso, reemplaza el placeholder de la base URL por
// la URL real para que los ejemplos queden listos para copiar.
//
//   sh:  curl -fsSL <ORIGIN>/dev/install | sh
//   ps:  iwr -useb <ORIGIN>/dev/install?ps | iex

const SKILL_NAME = "integrar-luna-negra";
// /dev/skill devuelve el SKILL.md ya interpolado con la base URL real.
const SKILL_PATH = "/dev/skill";

function originFrom(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "luna-negra.example";
  return proto + "://" + host;
}

function shScript(origin: string): string {
  const skillUrl = origin + SKILL_PATH;
  return [
    "#!/usr/bin/env sh",
    "# Instala la skill 'integrar-luna-negra' de Luna Negra en Claude Code.",
    "set -e",
    'DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/' + SKILL_NAME + '"',
    'SKILL_URL="' + skillUrl + '"',
    'mkdir -p "$DEST"',
    'if command -v curl >/dev/null 2>&1; then curl -fsSL "$SKILL_URL" -o "$DEST/SKILL.md"; else wget -qO "$DEST/SKILL.md" "$SKILL_URL"; fi',
    'echo "OK  Skill instalada en: $DEST/SKILL.md"',
    'echo "    Reinicia tu agente y pedile: \\"integra mi juego con Luna Negra\\"."',
    "",
  ].join("\n");
}

function psScript(origin: string): string {
  const skillUrl = origin + SKILL_PATH;
  return [
    "# Instala la skill 'integrar-luna-negra' de Luna Negra en Claude Code (Windows).",
    "$ErrorActionPreference = 'Stop'",
    "$skillUrl = '" + skillUrl + "'",
    "$root = if ($env:CLAUDE_SKILLS_DIR) { $env:CLAUDE_SKILLS_DIR } else { Join-Path $HOME '.claude\\skills' }",
    "$dest = Join-Path $root '" + SKILL_NAME + "'",
    "New-Item -ItemType Directory -Force -Path $dest | Out-Null",
    "Invoke-WebRequest -UseBasicParsing -Uri $skillUrl -OutFile (Join-Path $dest 'SKILL.md')",
    "Write-Host \"OK  Skill instalada en: $dest\\SKILL.md\"",
    "Write-Host '    Reinicia tu agente y pedile: \"integra mi juego con Luna Negra\".'",
    "",
  ].join("\n");
}

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = originFrom(req);
  const wantsPs =
    url.searchParams.has("ps") ||
    url.searchParams.get("shell") === "ps" ||
    url.searchParams.get("shell") === "powershell";

  const body = wantsPs ? psScript(origin) : shScript(origin);
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
