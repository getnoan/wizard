/** Flags. A coding assistant runs this too, so every prompt has a flag that answers it. */
export const HELP = `noan-wizard — one command from nothing to a grounded agent

  npx -y @getnoan/wizard@latest [options]

What it does, in order:
  1. Auth      takes your NOAN API key (or reads NOAN_API_KEY), checks it with GET /me,
               writes it to .env and makes sure .env is gitignored
  2. Clients   finds your coding assistants and points each at the NOAN MCP server
  3. Skill     installs the NOAN skill and leaves a pointer in CLAUDE.md / AGENTS.md
  4. Workspace checks whether your fact layer has anything in it; if not, hands the
               seeding to your assistant (it has the procedure) rather than guessing
  5. Agents    optionally sets up the open-source agent pack on your GitHub account
  6. Report    says what it did, and what to do next

Options:
  -y, --yes            non-interactive: take every default, never prompt (for an agent mid-session)
  --json               machine-readable report on stdout (implies --yes)
  --api-key <key>      the NOAN key (else NOAN_API_KEY / NOAN_PERSONAL_API_KEY, else a prompt)
  --global             write user-scope client config (~/.claude.json, ~/.cursor/mcp.json, ...)
                       instead of project scope (.mcp.json, .cursor/mcp.json, .vscode/mcp.json)
  --dir <path>         the project directory (default: the current directory)
  --agents             also set up the agent pack (default: ask; with --yes: skip unless given)
  --no-mcp             skip the client wiring
  --no-skill           skip the skill install
  --dry-run            show every write without making it
  --no-telemetry       send nothing about this run (also: NOAN_WIZARD_NO_TELEMETRY=1)
  -h, --help           this text
  -v, --version        the version

Exit codes: 0 done · 2 the key did not work · 3 cancelled · 1 anything else
`;

export function parseArgs(argv) {
  const a = { yes: false, json: false, apiKey: null, global: false, dir: process.cwd(), agents: null,
              mcp: true, skill: true, dryRun: false, telemetry: true, help: false, version: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${t} needs a value`); return v; };
    if (t === "-y" || t === "--yes") a.yes = true;
    else if (t === "--json") { a.json = true; a.yes = true; }
    else if (t === "--api-key") a.apiKey = next();
    else if (t.startsWith("--api-key=")) a.apiKey = t.slice(10);
    else if (t === "--global") a.global = true;
    else if (t === "--dir") a.dir = next();
    else if (t.startsWith("--dir=")) a.dir = t.slice(6);
    else if (t === "--agents") a.agents = true;
    else if (t === "--no-agents") a.agents = false;
    else if (t === "--no-mcp") a.mcp = false;
    else if (t === "--no-skill") a.skill = false;
    else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--no-telemetry") a.telemetry = false;
    else if (t === "-h" || t === "--help") a.help = true;
    else if (t === "-v" || t === "--version") a.version = true;
    else a.unknown.push(t);
  }
  if (a.unknown.length) throw new Error(`unknown option: ${a.unknown.join(" ")}\n\n${HELP}`);
  return a;
}
