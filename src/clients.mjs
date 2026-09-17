/**
 * Coding-assistant clients: detect what is installed and point each at the NOAN MCP server.
 *
 * Every write is an idempotent merge: an existing `noan` entry is updated in place, other
 * servers are untouched, unknown files are created. OAuth-capable clients get the URL only —
 * they sign the user in themselves. Codex reads the key from the environment by name, so no
 * secret is ever written into a config file. Claude Desktop and ChatGPT have no config file to
 * write; they get instructions in the report.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { MCP_URL } from "./noan.mjs";

export function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function writeJson(p, obj, dryRun) { if (dryRun) return; mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); }

/** Merge a `noan` server entry into a JSON config at `container` (e.g. "mcpServers"). */
export function mergeJsonServer(existing, container, entry) {
  const obj = existing && typeof existing === "object" ? existing : {};
  const servers = obj[container] && typeof obj[container] === "object" ? obj[container] : {};
  const before = JSON.stringify(servers.noan ?? null);
  servers.noan = { ...(servers.noan || {}), ...entry };
  obj[container] = servers;
  return { obj, action: before === "null" ? "added" : before === JSON.stringify(servers.noan) ? "unchanged" : "updated" };
}

/** Codex's config is TOML; add or replace the [mcp_servers.noan] table without touching the rest. */
export function mergeToml(text, table, lines) {
  const block = `[${table}]\n${lines.join("\n")}\n`;
  const src = text || "";
  const rx = new RegExp(`^\\[${table.replace(/\./g, "\\.")}\\]\\n(?:(?!\\[)[^\\n]*\\n?)*`, "m");
  if (rx.test(src)) {
    const cur = src.match(rx)[0];
    if (cur.trim() === block.trim()) return { text: src, action: "unchanged" };
    return { text: src.replace(rx, block), action: "updated" };
  }
  return { text: (src && !src.endsWith("\n") ? src + "\n" : src) + (src ? "\n" : "") + block, action: "added" };
}

const HOME = os.homedir();
const onPath = (cmd) => (process.env.PATH || "").split(path.delimiter).some(d => d && existsSync(path.join(d, cmd)));

/** The clients, with how to detect them and where their config lives at each scope. */
export function clientCatalog({ dir, home = HOME }) {
  return [
    {
      id: "claude-code", label: "Claude Code",
      detect: () => existsSync(path.join(home, ".claude.json")) || existsSync(path.join(home, ".claude")) || onPath("claude"),
      project: { file: path.join(dir, ".mcp.json"), kind: "json", container: "mcpServers", entry: { type: "http", url: MCP_URL } },
      global:  { file: path.join(home, ".claude.json"), kind: "json", container: "mcpServers", entry: { type: "http", url: MCP_URL } },
      after: "In a session, type /mcp and pick NOAN to sign in.",
    },
    {
      id: "cursor", label: "Cursor",
      detect: () => existsSync(path.join(home, ".cursor")),
      project: { file: path.join(dir, ".cursor", "mcp.json"), kind: "json", container: "mcpServers", entry: { url: MCP_URL } },
      global:  { file: path.join(home, ".cursor", "mcp.json"), kind: "json", container: "mcpServers", entry: { url: MCP_URL } },
      after: "Cursor asks you to sign in to NOAN once.",
    },
    {
      id: "codex", label: "OpenAI Codex",
      detect: () => existsSync(path.join(home, ".codex")) || onPath("codex"),
      project: null,   // Codex config is user-level only
      global:  { file: path.join(home, ".codex", "config.toml"), kind: "toml", table: "mcp_servers.noan",
                 lines: [`url = "${MCP_URL}"`, `bearer_token_env_var = "NOAN_API_KEY"`] },
      after: "Codex sends NOAN_API_KEY from your environment as the bearer token.",
    },
    {
      id: "vscode", label: "VS Code",
      detect: () => existsSync(path.join(dir, ".vscode")) || onPath("code"),
      project: { file: path.join(dir, ".vscode", "mcp.json"), kind: "json", container: "servers", entry: { type: "http", url: MCP_URL } },
      global:  null,   // user-level MCP in VS Code lives in the profile UI, not a file we should edit
      after: "Open the MCP view and start the NOAN server; VS Code signs you in.",
    },
    {
      id: "windsurf", label: "Windsurf",
      detect: () => existsSync(path.join(home, ".codeium", "windsurf")),
      project: null,
      global:  { file: path.join(home, ".codeium", "windsurf", "mcp_config.json"), kind: "json", container: "mcpServers", entry: { serverUrl: MCP_URL } },
      after: "Refresh the MCP list in Windsurf.",
    },
    {
      id: "gemini", label: "Gemini CLI",
      detect: () => existsSync(path.join(home, ".gemini")),
      project: { file: path.join(dir, ".gemini", "settings.json"), kind: "json", container: "mcpServers", entry: { httpUrl: MCP_URL } },
      global:  { file: path.join(home, ".gemini", "settings.json"), kind: "json", container: "mcpServers", entry: { httpUrl: MCP_URL } },
      after: "Run /mcp in Gemini CLI to check the server is up.",
    },
  ];
}

/** Clients with no file to write — the report tells the user what to click. */
export const MANUAL_CLIENTS = [
  { id: "claude-desktop", label: "Claude (desktop and web)", how: `Settings → Connectors → Add custom connector → name it NOAN, address ${MCP_URL}, then Connect and sign in.` },
  { id: "chatgpt", label: "ChatGPT", how: `Settings → Connectors (developer mode on) → Create → name it NOAN, address ${MCP_URL}, sign in with your NOAN account, then enable it in a chat.` },
];

/** Wire every detected client at the chosen scope. Returns one row per client. */
export function wireClients({ dir, global = false, dryRun = false, home = HOME, force = [] }) {
  const rows = [];
  for (const c of clientCatalog({ dir, home })) {
    const detected = c.detect() || force.includes(c.id);
    const target = global ? (c.global || c.project) : (c.project || c.global);
    if (!detected) { rows.push({ id: c.id, label: c.label, detected: false }); continue; }
    if (!target) { rows.push({ id: c.id, label: c.label, detected: true, action: "no config file for this scope" }); continue; }
    let action;
    if (target.kind === "json") {
      const { obj, action: a } = mergeJsonServer(readJson(target.file), target.container, target.entry);
      action = a; if (a !== "unchanged") writeJson(target.file, obj, dryRun);
    } else {
      const cur = existsSync(target.file) ? readFileSync(target.file, "utf8") : "";
      const { text, action: a } = mergeToml(cur, target.table, target.lines);
      action = a; if (a !== "unchanged" && !dryRun) { mkdirSync(path.dirname(target.file), { recursive: true }); writeFileSync(target.file, text); }
    }
    rows.push({ id: c.id, label: c.label, detected: true, file: target.file, scope: target === c.global ? "user" : "project", action, after: c.after });
  }
  return rows;
}
