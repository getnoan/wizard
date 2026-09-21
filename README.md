# NOAN wizard

One command from nothing to a grounded agent.

```bash
npx -y @getnoan/wizard@latest
```

It takes your NOAN API key, points your coding assistants at the NOAN MCP server, installs the
NOAN skill, checks whether your fact layer has anything in it, and, if you want, sets up the six
open-source agents on your own GitHub account. Then it tells you what it did and what to do next.
Run it again any time; every write is a merge, and nothing you have is overwritten.

## What it does

1. **Your key.** Create one at app.getnoan.com → Settings → API → New key and paste it in (it is
   not echoed). The wizard checks it with `GET /me`, writes it to `.env` as `NOAN_API_KEY` and
   `NOAN_PERSONAL_API_KEY`, and makes sure `.env` is gitignored. Already have `NOAN_API_KEY` in
   your environment? It uses that and never asks.
2. **Your coding assistants.** Whatever is installed gets the MCP address `https://mcp.getnoan.com/mcp`
   merged into its config: Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`), VS Code
   (`.vscode/mcp.json`), Gemini CLI, Windsurf, and Codex (`~/.codex/config.toml`, which reads the
   key from your environment by name; no secret is written into any config file). Clients that
   sign you in themselves get the address only. Claude and ChatGPT have no file to write; the
   report tells you what to click.
3. **The skill.** The `noan-fact-layer` and `noan-fact-candidate-capture` skills from
   [getnoan/skills](https://github.com/getnoan/skills) are copied into `.claude/skills/` (and
   `~/.codex/skills/` if Codex is installed), and a short pointer is appended to `CLAUDE.md` and
   `AGENTS.md` so an assistant knows where the key and the skill are.
4. **Your fact layer.** If the workspace holds fewer than ten facts, the wizard does not guess
   facts for you. It hands the seeding to your assistant, which has the procedure from the skill:
   read your website, repo and docs, propose a structure, and write only after you say yes.
5. **The agent pack** (optional, `--agents`). Forks [getnoan/agent-pack](https://github.com/getnoan/agent-pack)
   to your account, verifies and stores your Anthropic and Resend keys (and optionally a Postgres URL
   and a Firecrawl key) as repository secrets, runs the pack's seed scripts so each agent's starting
   instructions are in your workspace, records the block slugs as repository variables, and triggers
   one dry run. Safe mode stays on: the wizard never sets `DRY_RUN` to 0. That switch is yours.
6. **The report.** What happened, and the one thing to do next.

## For a coding assistant

The wizard is meant to be run by an agent mid-session, so every prompt has a flag:

```bash
NOAN_API_KEY=npak_… npx -y @getnoan/wizard@latest --yes --json
```

`--yes` takes every default and never prompts; `--json` prints the report as one object on stdout
(progress goes to stderr) with a `next` list an agent can act on, including the first-connect
hand-off when the workspace is empty. `--agents` adds the pack step; it reads `ANTHROPIC_API_KEY`,
`RESEND_API_KEY`, `DATABASE_URL`, `FIRECRAWL_API_KEY`, `MAIL_FROM`, `REPLY_TO` and `ESCALATE_TO`
from the environment and skips what is missing, saying so.

Exit codes: 0 done, 2 the key did not work, 3 cancelled, 1 anything else.

## Options

| Flag | Effect |
|---|---|
| `-y`, `--yes` | non-interactive |
| `--json` | machine-readable report (implies `--yes`) |
| `--api-key <key>` | the NOAN key (else `NOAN_API_KEY`, else a prompt) |
| `--global` | user-scope client config instead of project scope |
| `--dir <path>` | the project directory (default: current) |
| `--agents` / `--no-agents` | include or skip the agent pack step |
| `--no-mcp`, `--no-skill` | skip a step |
| `--dry-run` | show every write without making it |
| `--no-telemetry` | send nothing about this run (also `NOAN_WIZARD_NO_TELEMETRY`, `DO_NOT_TRACK`, or any `CI`) |

## Telemetry

Three events — a run started, and then completed or cancelled — carrying the Node version, the
platform, the exit code, how long the run took, whether it was non-interactive (`--yes`), whether
the report was JSON, and whether the workspace was empty. That is the whole payload. Never a key,
never a path, never a workspace name, never anything read out of your fact layer.

A run is identified by an id made up for that process and thrown away with it, so the events of one
run line up and nothing links one run to the next. The events ask PostHog for no person profile and
no geolocation. Like any HTTP request they arrive from your IP address.

Nothing is sent when any of these is true: `--no-telemetry`, `NOAN_WIZARD_NO_TELEMETRY` set to
anything but `0` or `false`, `DO_NOT_TRACK` likewise, or `CI` set — a pipeline running the wizard
is not a person trying it.

## Why a wizard and not a prompt

NOAN's published API description is wrong in a few places that a spec-generated client gets
confidently wrong (fields the spec marks nullable that the API rejects, create responses that nest
under the resource name, limits that reject rather than truncate). A short deterministic program
that makes the right calls beats asking a model to work it out from the spec. The wizard makes the
few calls it needs correctly and hands everything that needs judgement to your assistant.

## Licence

MIT.
