// Instalador de las skills de integración Luna Negra 1.0 y NGP para agentes de código.
// Sirve un script (sh por defecto, PowerShell con ?ps) que descarga los SKILL.md
// desde este deploy y reemplaza el placeholder de la base URL por la URL real.
//
//   sh:  curl -fsSL <ORIGIN>/dev/install | sh
//   ps:  iwr -useb <ORIGIN>/dev/install?ps | iex
//   una sola: <ORIGIN>/dev/install?version=ngp

const SKILLS = [
  {
    version: "1.0",
    aliases: ["1", "1.0", "luna", "rest", "integrar-luna-negra-1-0"],
    name: "integrar-luna-negra-1-0",
  },
  {
    version: "ngp",
    aliases: [
      "2",
      "2.0",
      "ngp",
      "ngp-v2",
      "nostr",
      "nostr-games-protocol",
      "integrar-ngp-v2",
    ],
    name: "integrar-ngp-v2",
  },
] as const;

type Skill = (typeof SKILLS)[number];

function originFrom(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "luna-negra.example";
  return proto + "://" + host;
}

function selectedSkills(url: URL): readonly Skill[] | null {
  const raw =
    url.searchParams.get("version") ??
    url.searchParams.get("skill") ??
    url.searchParams.get("name");
  if (!raw) return SKILLS;

  const key = raw.trim().toLowerCase();
  const skill = SKILLS.find((candidate) =>
    (candidate.aliases as readonly string[]).includes(key),
  );
  return skill ? [skill] : null;
}

function skillUrl(origin: string, version: string): string {
  return origin + "/dev/skill?version=" + encodeURIComponent(version);
}

function shScript(origin: string, skills: readonly Skill[]): string {
  const lines = [
    "#!/usr/bin/env sh",
    "# Instala las skills de Luna Negra 1.0 y NGP en Claude Code.",
    "set -e",
    'ROOT="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"',
  ];

  for (const skill of skills) {
    lines.push(
      'DEST="$ROOT/' + skill.name + '"',
      'SKILL_URL="' + skillUrl(origin, skill.version) + '"',
      'mkdir -p "$DEST"',
      'if command -v curl >/dev/null 2>&1; then curl -fsSL "$SKILL_URL" -o "$DEST/SKILL.md"; else wget -qO "$DEST/SKILL.md" "$SKILL_URL"; fi',
      'echo "OK  Skill instalada en: $DEST/SKILL.md"',
    );
  }

  lines.push(
    'echo "    Reinicia tu agente y pedile que integre tu juego con NGP o que agregue apuestas por NGE."',
    "",
  );

  return lines.join("\n");
}

function psScript(origin: string, skills: readonly Skill[]): string {
  const entries = skills
    .map(
      (skill) =>
        "  @{ Name = '" +
        skill.name +
        "'; Url = '" +
        skillUrl(origin, skill.version) +
        "' }",
    )
    .join(",\n");

  return [
    "# Instala las skills de Luna Negra 1.0 y NGP en Claude Code (Windows).",
    "$ErrorActionPreference = 'Stop'",
    "$root = if ($env:CLAUDE_SKILLS_DIR) { $env:CLAUDE_SKILLS_DIR } else { Join-Path $HOME '.claude\\skills' }",
    "$skills = @(",
    entries,
    ")",
    "foreach ($skill in $skills) {",
    "  $dest = Join-Path $root $skill.Name",
    "  New-Item -ItemType Directory -Force -Path $dest | Out-Null",
    "  Invoke-WebRequest -UseBasicParsing -Uri $skill.Url -OutFile (Join-Path $dest 'SKILL.md')",
    "  Write-Host \"OK  Skill instalada en: $dest\\SKILL.md\"",
    "}",
    "Write-Host '    Reinicia tu agente y pedile que integre tu juego con NGP o que agregue apuestas por NGE.'",
    "",
  ].join("\n");
}

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = originFrom(req);
  const skills = selectedSkills(url);
  if (!skills) {
    return new Response("Skill desconocida. Usa ?version=1.0 o ?version=ngp", {
      status: 400,
    });
  }

  const wantsPs =
    url.searchParams.has("ps") ||
    url.searchParams.get("shell") === "ps" ||
    url.searchParams.get("shell") === "powershell";

  const body = wantsPs ? psScript(origin, skills) : shScript(origin, skills);
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
