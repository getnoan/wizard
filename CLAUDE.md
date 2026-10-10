@AGENTS.md

# wizard

`@getnoan/wizard` on npm (`npx -y @getnoan/wizard@latest`, bin `noan-wizard`): a Node CLI that takes a NOAN API key, points the user's coding assistants at `https://mcp.getnoan.com/mcp`, installs the NOAN skill, and optionally forks the agent pack and the web agents. Plain ESM, Node >= 18.17, no dependencies and no lockfile.

| Path | Purpose |
| --- | --- |
| `src/run.mjs` | the seven steps, in order; builds the report |
| `src/args.mjs` | flags and the `HELP` text |
| `src/noan.mjs` | NOAN API calls (`GET /me`, fact count), agent role logic |
| `src/clients.mjs`, `src/skill.mjs`, `src/env-file.mjs` | files written on the user's machine |
| `src/agents.mjs`, `src/web.mjs` | agent pack and web agents, all through `gh` |
| `src/telemetry.mjs` | PostHog events, allowlisted properties |

## The user's NOAN key

- **The key goes in `.env` files and GitHub secrets only.** `run.mjs` writes it to the project `.env` as `NOAN_API_KEY` and `NOAN_PERSONAL_API_KEY` (`chmod 600`, `.env` added to `.gitignore` in a git checkout); `--agents` also writes it to `noan-agent-pack/.env` and, without an agent key, to the fork's `NOAN_PERSONAL_API_KEY` secret. Never in a client config, a log line, the report, `--json` output or a telemetry event.
- Client configs hold the MCP URL only. Codex gets `bearer_token_env_var = "NOAN_API_KEY"`, never the value.
- The web agents' `.env` (`web.mjs` `webEnv`) never holds the personal key. Those services face the internet and get their own agent key. `proveLocally` boots them with `PATH` and `HOME` only.
- **Telemetry sends only `ALLOWED_PROPERTIES`.** README and SECURITY.md list that exact set: change all three together.

## What it writes on a user's machine

- Project dir: `.env`, `.gitignore`, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json`, `.claude/skills/`, and a pointer block in `CLAUDE.md` and `AGENTS.md` (created if absent).
- Home dir: `~/.codex/config.toml` and `~/.codex/skills/` when Codex is present; with `--global`, `~/.claude.json`, `~/.cursor/mcp.json`, `~/.gemini/settings.json`, `~/.codeium/windsurf/mcp_config.json`, `~/.claude/skills/`.
- With `--agents`, `--meetings`, `--chat`: clones in `noan-agent-pack/`, `verity-meetings/`, `verity-chat/` under the project dir, plus GitHub secrets and variables on the user's forks.
- **Every write must be a merge, and a re-run must change nothing.** JSON configs update only `servers.noan`/`mcpServers.noan`, TOML only `[mcp_servers.noan]`, `.env` only the given keys, pointers are skipped when `<!-- noan-wizard -->` is present, an existing `SESSION_SECRET` is kept. On the fork, an existing `DRY_RUN`, `STATE_BACKEND` (unless a Postgres URL is given), hand-back assignees and `NEWSLETTER_UNSUB_SECRET` are kept. A new writer needs the same "unchanged on re-run" test.
- Every write respects `--dry-run`. `--dry-run` still calls the NOAN API and fetches the skill.
- **The wizard never sets `DRY_RUN` to 0** on the agent pack.

## Non-interactive mode

- Every prompt has a flag or env var. `--yes` takes defaults and never prompts; `--json` implies `--yes`, prints the report as one JSON object on stdout and keeps progress on stderr.
- Exit codes: 0 done, 2 key missing or rejected, 1 anything else. CI checks the exit 2 path.
- A new prompt needs a flag or env var, and an entry in `HELP` and the README.

## Releases

- Bump `version` in `package.json` in a PR. A repo admin then creates the `v<version>` tag and GitHub release.
- `publish.yml` checks the tag matches `package.json`, waits for approval in the `npm-publish` environment, and publishes through npm trusted publishing (no npm token). A pre-release goes to `next`, a full release to `latest`. Never run `npm publish` locally.

## Public repo

- Anyone reads every file, commit, PR and issue. No keys, customer data, internal repo names or people's names.
- The PostHog token in `telemetry.mjs` is the public write-only project key and is meant to be there.

## Tests and CI

- All tests are in `test/wizard.test.mjs`, `node:test` and `node:assert`, no framework. Tests use `mkdtemp` dirs and pass `home` so they never touch the real home dir, and swap `globalThis.fetch` so they never reach the network.
- `ci.yml` runs `node --test`, `--help` and the exit 2 check on Node 18, 20 and 22, on PRs and pushes to `main`.

## Commands

```bash
npm test                                         # node --test, every test
node bin/wizard.mjs --help                       # help text
node bin/wizard.mjs --dry-run --no-telemetry --dir <existing dir>   # no writes, still calls the live API with NOAN_API_KEY
```
