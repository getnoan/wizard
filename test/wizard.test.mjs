import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "../src/args.mjs";
import { upsertEnv, writeEnv, ensureGitignored } from "../src/env-file.mjs";
import { mergeJsonServer, mergeToml, wireClients } from "../src/clients.mjs";
import { installSkill, writePointers, POINTER_MARK, fetchSkillFiles } from "../src/skill.mjs";
import { parseSeedOutput } from "../src/agents.mjs";
import { classifyWorkspace, looksLikeKey } from "../src/noan.mjs";
import { renderReport } from "../src/report.mjs";

const tmp = () => mkdtempSync(path.join(tmpdir(), "wiz-"));

test("args: every prompt has a flag; --json implies --yes; unknown flags fail loudly", () => {
  const a = parseArgs(["--json", "--api-key=npak_x", "--global", "--agents", "--no-skill", "--dry-run", "--dir", "/tmp"]);
  assert.equal(a.yes, true); assert.equal(a.json, true); assert.equal(a.apiKey, "npak_x"); assert.equal(a.global, true);
  assert.equal(a.agents, true); assert.equal(a.skill, false); assert.equal(a.dryRun, true); assert.equal(a.dir, "/tmp");
  assert.equal(parseArgs([]).agents, null);
  assert.throws(() => parseArgs(["--bogus"]), /unknown option/);
});

test("env: keys are set or replaced, other lines survive, export form is recognised", () => {
  const t = upsertEnv("OTHER=1\nexport NOAN_API_KEY=old\n", { NOAN_API_KEY: "new", NOAN_PERSONAL_API_KEY: "new" });
  assert.equal(t, "OTHER=1\nNOAN_API_KEY=new\nNOAN_PERSONAL_API_KEY=new\n");
  const d = tmp(); const r = writeEnv(d, { NOAN_API_KEY: "k" }); assert.equal(r.created, true);
  assert.equal(writeEnv(d, { NOAN_API_KEY: "k" }).changed, false);
  assert.equal(writeEnv(d, { NOAN_API_KEY: "k" }, { dryRun: true }).changed, false);
});

test("gitignore: added in a repo, recognised when present, left alone outside git", () => {
  const d = tmp(); assert.equal(ensureGitignored(d).action, "not a git repo");
  mkdirSync(path.join(d, ".git")); assert.equal(ensureGitignored(d).action, "added .env");
  assert.equal(ensureGitignored(d).action, "already ignored");
  assert.equal(readFileSync(path.join(d, ".gitignore"), "utf8"), ".env\n");
});

test("json merge: adds, updates, leaves other servers alone, reports unchanged", () => {
  const { obj, action } = mergeJsonServer({ mcpServers: { other: { url: "x" } } }, "mcpServers", { url: "u" });
  assert.equal(action, "added"); assert.deepEqual(obj.mcpServers.other, { url: "x" });
  assert.equal(mergeJsonServer(obj, "mcpServers", { url: "u" }).action, "unchanged");
  assert.equal(mergeJsonServer(obj, "mcpServers", { url: "v" }).action, "updated");
  assert.equal(mergeJsonServer(null, "servers", { url: "u" }).obj.servers.noan.url, "u");
});

test("toml merge: adds a table, replaces only that table, unchanged when identical", () => {
  const a = mergeToml("[model]\nname = \"x\"\n", "mcp_servers.noan", ['url = "u"']);
  assert.equal(a.action, "added"); assert.match(a.text, /\[model\][\s\S]*\[mcp_servers\.noan\]\nurl = "u"\n$/);
  const b = mergeToml(a.text + "\n[mcp_servers.other]\nurl = \"o\"\n", "mcp_servers.noan", ['url = "v"']);
  assert.equal(b.action, "updated"); assert.match(b.text, /url = "v"/); assert.match(b.text, /\[mcp_servers\.other\]\nurl = "o"/); assert.doesNotMatch(b.text, /url = "u"/);
  assert.equal(mergeToml(b.text, "mcp_servers.noan", ['url = "v"']).action, "unchanged");
});

test("clients: project scope writes .mcp.json / .cursor / .vscode; codex is user-level toml; re-run is unchanged", () => {
  const home = tmp(), dir = tmp();
  mkdirSync(path.join(home, ".cursor")); mkdirSync(path.join(home, ".codex")); mkdirSync(path.join(dir, ".vscode"));
  writeFileSync(path.join(home, ".claude.json"), "{}");
  const rows = wireClients({ dir, home });
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(by["claude-code"].action, "added"); assert.equal(by["claude-code"].file, path.join(dir, ".mcp.json"));
  assert.equal(JSON.parse(readFileSync(path.join(dir, ".mcp.json"), "utf8")).mcpServers.noan.type, "http");
  assert.equal(by.cursor.scope, "project"); assert.ok(existsSync(path.join(dir, ".cursor", "mcp.json")));
  assert.equal(by.codex.scope, "user"); assert.match(readFileSync(path.join(home, ".codex", "config.toml"), "utf8"), /bearer_token_env_var = "NOAN_API_KEY"/);
  assert.equal(by.vscode.action, "added"); assert.equal(JSON.parse(readFileSync(path.join(dir, ".vscode", "mcp.json"), "utf8")).servers.noan.type, "http");
  assert.equal(by.windsurf.detected, false);
  const again = wireClients({ dir, home });
  assert.ok(again.filter(r => r.detected).every(r => r.action === "unchanged"), JSON.stringify(again));
  assert.equal(JSON.parse(readFileSync(path.join(home, ".claude.json"), "utf8")).mcpServers, undefined, "project scope must not touch the user file");
});

test("clients: --global writes the user files and never the project ones", () => {
  const home = tmp(), dir = tmp(); writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ other: 1 }));
  const rows = wireClients({ dir, home, global: true });
  const cc = rows.find(r => r.id === "claude-code");
  assert.equal(cc.scope, "user"); const u = JSON.parse(readFileSync(path.join(home, ".claude.json"), "utf8"));
  assert.equal(u.other, 1); assert.equal(u.mcpServers.noan.url, "https://mcp.getnoan.com/mcp"); assert.ok(!existsSync(path.join(dir, ".mcp.json")));
});

test("skill: files land under each target, unchanged on re-run; pointers append once", () => {
  const d = tmp(); const files = { "noan-fact-layer/SKILL.md": "# s\n", "noan-fact-layer/references/a.md": "a\n" };
  const t = [{ id: "claude-code", root: path.join(d, ".claude", "skills") }];
  assert.deepEqual(installSkill(files, t)[0], { id: "claude-code", root: t[0].root, written: 2, unchanged: 0 });
  assert.equal(installSkill(files, t)[0].unchanged, 2);
  writeFileSync(path.join(d, "CLAUDE.md"), "# mine\n");
  const p = writePointers(d); assert.equal(p[0].action, "appended"); assert.equal(p[1].action, "created");
  assert.equal(writePointers(d)[0].action, "already present");
  const c = readFileSync(path.join(d, "CLAUDE.md"), "utf8"); assert.ok(c.startsWith("# mine\n")); assert.equal(c.split(POINTER_MARK).length, 2);
});

test("seed output: the *_BLOCK_SLUG lines are the interface", () => {
  const v = parseSeedOutput("seeding…\n  block \"Deck Playbook\" → slug abc\nDECK_CONFIG_BLOCK_SLUG=fed75-deck-agent-config\nDECK_PLAYBOOK_BLOCK_SLUG=fed75-deck-playbook\ndone\n");
  assert.deepEqual(v, { DECK_CONFIG_BLOCK_SLUG: "fed75-deck-agent-config", DECK_PLAYBOOK_BLOCK_SLUG: "fed75-deck-playbook" });
});

test("workspace: fewer than ten facts is empty; unknown stays unknown; key shape", () => {
  assert.equal(classifyWorkspace(3).state, "empty"); assert.equal(classifyWorkspace(400).state, "populated"); assert.equal(classifyWorkspace(null).state, "unknown");
  assert.ok(looksLikeKey("npak_" + "a".repeat(20))); assert.ok(!looksLikeKey("sk-ant-x"));
});

test("report: json is the whole object; text names the next step for an empty workspace", () => {
  const r = { version: 1, steps: { auth: { ok: true, email: "a@b.c", workspace: "W", envAction: "created", gitignore: "added .env" }, workspace: { state: "empty", empty: true, count: 0 } }, next: [{ id: "first-connect", say: "Seed it", why: "empty" }] };
  assert.equal(JSON.parse(renderReport(r, { json: true })).steps.workspace.count, 0);
  assert.match(renderReport(r), /facts: 0 \(empty\)[\s\S]*• Seed it/);
});

test("skill fetch: the core skill is required, the capture skill is optional until published", async () => {
  const stub = (status) => async (url) => ({ ok: status(url) === 200, status: status(url), text: async () => "x " + url });
  const r = await fetchSkillFiles(stub(u => u.includes("candidate-capture") ? 404 : 200));
  assert.equal(Object.keys(r.files).length, 4); assert.deepEqual(r.missing, ["noan-fact-candidate-capture/SKILL.md"]);
  await assert.rejects(fetchSkillFiles(stub(u => u.endsWith("SKILL.md") ? 404 : 200)), /could not fetch noan-fact-layer\/SKILL.md/);
});
