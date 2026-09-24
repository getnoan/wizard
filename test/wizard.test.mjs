import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "../src/args.mjs";
import { upsertEnv, writeEnv, ensureGitignored } from "../src/env-file.mjs";
import { mergeJsonServer, mergeToml, wireClients } from "../src/clients.mjs";
import { installSkill, writePointers, POINTER_MARK, fetchSkillFiles } from "../src/skill.mjs";
import { parseSeedOutput, parseGroundingOutput, agentIdentity, PACK_VARS, PACK_SECRETS,
  modelBase, modelKeyName, verifyModelKey, DEFAULT_MODEL_BASE } from "../src/agents.mjs";
import { classifyWorkspace, looksLikeKey } from "../src/noan.mjs";
import { renderReport } from "../src/report.mjs";
import { telemetryEnabled, capture, POSTHOG_TOKEN, ALLOWED_PROPERTIES } from "../src/telemetry.mjs";

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

test("grounding output: the last JSON line wins; noise before it is ignored", () => {
  const r = parseGroundingOutput("grounding check — sales deck\n  · Brand Identity (brand-identity) EMPTY\n{\"agents\":[\"sales deck\"],\"gaps\":[{\"slug\":\"brand-identity\",\"title\":\"Brand Identity\",\"agents\":[\"sales deck\"]}],\"filed\":[{\"slug\":\"brand-identity\",\"action\":\"filed\",\"taskId\":\"t1\"}]}\n");
  assert.equal(r.gaps[0].title, "Brand Identity"); assert.equal(r.filed[0].action, "filed");
  assert.deepEqual(parseGroundingOutput("nothing json here\n"), { gaps: [], filed: [] });
});

test("agent identity: Verity is the default, a chosen name is kept, pronouns are never assumed for it", () => {
  // The whole point of the prompt: an unset AGENT_NAME used to reach the pack as nothing,
  // and the pack signs as "Agent". A skipped prompt must still send a real name.
  assert.deepEqual(agentIdentity(), { AGENT_NAME: "Verity", AGENT_PRONOUNS: "she/her" });
  assert.deepEqual(agentIdentity({ name: "  " }), { AGENT_NAME: "Verity", AGENT_PRONOUNS: "she/her" });
  assert.deepEqual(agentIdentity({ name: "verity" }), { AGENT_NAME: "verity", AGENT_PRONOUNS: "she/her" });
  // Someone else's name: no pronouns invented for it, so the pack falls back to they/them.
  assert.deepEqual(agentIdentity({ name: "Atlas" }), { AGENT_NAME: "Atlas" });
  assert.deepEqual(agentIdentity({ name: "Atlas", pronouns: "he/him" }), { AGENT_NAME: "Atlas", AGENT_PRONOUNS: "he/him" });
  assert.deepEqual(agentIdentity({ name: " Atlas ", pronouns: "  " }), { AGENT_NAME: "Atlas" });
  // Both keys are variables the pack actually reads, so a rename upstream must fail here.
  assert.ok(PACK_VARS.includes("AGENT_NAME"));
});

test("report: the agents line names the agent, so a run says who it just set up", () => {
  const line = renderReport({ steps: { agents: { ok: true, repo: "me/agent-pack", agentName: "Atlas", secrets: [1, 2], variables: [1] } } })
    .split("\n").find(l => l.startsWith("agents:"));
  assert.match(line, /me\/agent-pack — Atlas, 2 secrets, 1 variables, safe mode on/);
});

test("telemetry: every opt-out wins, and a disabled capture makes no request", async () => {
  const saved = { ci: process.env.CI, no: process.env.NOAN_WIZARD_NO_TELEMETRY, dnt: process.env.DO_NOT_TRACK };
  const restore = () => { for (const [k, v] of [["CI", saved.ci], ["NOAN_WIZARD_NO_TELEMETRY", saved.no], ["DO_NOT_TRACK", saved.dnt]])
    v === undefined ? delete process.env[k] : (process.env[k] = v); };
  delete process.env.CI; delete process.env.NOAN_WIZARD_NO_TELEMETRY; delete process.env.DO_NOT_TRACK;
  try {
    assert.equal(telemetryEnabled({ telemetry: false }), false);
    for (const [k, v] of [["NOAN_WIZARD_NO_TELEMETRY", "1"], ["NOAN_WIZARD_NO_TELEMETRY", "true"], ["NOAN_WIZARD_NO_TELEMETRY", "yes"],
                          ["DO_NOT_TRACK", "1"], ["CI", "true"], ["CI", "1"]]) {
      process.env[k] = v;
      assert.equal(telemetryEnabled({ telemetry: true }), false, `${k}=${v} should opt out`);
      delete process.env[k];
    }
    for (const v of ["0", "false", ""]) {   // these are not an opt-out
      process.env.NOAN_WIZARD_NO_TELEMETRY = v;
      assert.equal(telemetryEnabled({ telemetry: true }), !!POSTHOG_TOKEN, `NOAN_WIZARD_NO_TELEMETRY=${v} should not opt out`);
      delete process.env.NOAN_WIZARD_NO_TELEMETRY;
    }
    const real = globalThis.fetch; let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("telemetry must not reach the network here"); };
    try { assert.equal(await capture({ telemetry: false }, "started"), false); assert.equal(called, false); }
    finally { globalThis.fetch = real; }
  } finally { restore(); }
});

test("telemetry: the request is abortable, and every event of one run shares its id", async () => {
  const saved = { ci: process.env.CI }; delete process.env.CI;
  const real = globalThis.fetch;
  try {
    if (!POSTHOG_TOKEN) { assert.equal(await capture({}, "started"), false); return; }   // nothing compiled in: nothing to test
    let sawSignal = false;
    globalThis.fetch = (_url, opts = {}) => {                       // never settles on its own
      sawSignal = opts.signal instanceof AbortSignal;
      if (!sawSignal) return Promise.reject(new Error("no signal"));   // fail fast rather than hang the suite
      return new Promise((_res, rej) => {                             // a ref'd timer: AbortSignal.timeout's own
        const alive = setTimeout(() => rej(new Error("the stub outlived the abort")), 30_000);   // is unref'd and
        opts.signal.addEventListener("abort", () => { clearTimeout(alive); rej(opts.signal.reason); });  // would
      });                                                             // let an otherwise idle event loop drain
    };
    const t0 = Date.now();
    assert.equal(await capture({}, "started"), false);              // the timeout, not the OS, ends this
    assert.equal(sawSignal, true, "capture must pass an AbortSignal");
    assert.ok(Date.now() - t0 < 10_000, "capture must not wait on the OS TCP timeout");

    const sent = [];
    globalThis.fetch = async (_url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true }; };
    await capture({}, "started"); await capture({}, "completed", { exit: 0, ms: 12 });
    assert.equal(sent.length, 2);
    const ids = sent.map((b) => b.distinct_id);
    assert.match(ids[0], /^[0-9a-f]{8}-[0-9a-f]{4}-/);
    assert.equal(ids[0], ids[1], "the two events of one run must share a distinct_id");

    // The two privacy promises README and SECURITY.md make, which nothing tested: no person
    // profile, and no geolocation. Both are one deleted line away from being quietly untrue.
    for (const b of sent) {
      assert.equal(b.properties.$process_person_profile, false, "the events must not build a person profile");
      assert.equal(b.properties.$geoip_disable, true, "the events must ask PostHog not to geolocate");
    }
    // And the payload is only what the docs list — a new property carrying a path or a
    // workspace name would otherwise ship silently.
    for (const b of sent) for (const k of Object.keys(b.properties))
      assert.ok(ALLOWED_PROPERTIES.has(k), `undocumented telemetry property: ${k}`);
    assert.deepEqual([...ALLOWED_PROPERTIES].sort(),
      ["$geoip_disable", "$process_person_profile", "empty", "exit", "json", "ms", "node", "platform", "yes"],
      "the allowlist and the documented payload must stay the same list");

    // A caller cannot widen it. run.mjs passes exit/ms/empty today, but the guard has to hold
    // for whatever any future call site passes — a project path is the promise this protects.
    sent.length = 0;
    await capture({}, "completed", { exit: 0, dir: "/Users/someone/secret-project", workspace: "acme" });
    assert.equal(sent[0].properties.exit, 0, "a documented property must survive");
    assert.equal("dir" in sent[0].properties, false, "a caller must not be able to send a path");
    assert.equal("workspace" in sent[0].properties, false, "a caller must not be able to send a workspace name");
  } finally { globalThis.fetch = real; saved.ci === undefined ? delete process.env.CI : (process.env.CI = saved.ci); }
});

test("model endpoint: the key is named and verified for the endpoint that will be called", async () => {
  // The pack accepts two names for one key. Which one the wizard STORES under follows the
  // endpoint, because "ANTHROPIC_API_KEY" holding an OpenRouter key is a lie the next reader
  // has to unpick.
  assert.equal(modelKeyName({}), "ANTHROPIC_API_KEY");
  assert.equal(modelKeyName({ ANTHROPIC_BASE_URL: "https://gateway.example.com" }), "LLM_API_KEY");
  assert.ok(PACK_SECRETS.includes("LLM_API_KEY") && PACK_SECRETS.includes("ANTHROPIC_API_KEY"));
  assert.ok(PACK_VARS.includes("ANTHROPIC_BASE_URL"));

  // Bare base, no trailing slash. Unset is the only thing that means "default vendor".
  assert.equal(modelBase({}), "");
  assert.equal(modelBase({ ANTHROPIC_BASE_URL: "   " }), "");
  assert.equal(modelBase({ ANTHROPIC_BASE_URL: "https://gateway.example.com///" }), "https://gateway.example.com");
  assert.equal(modelBase({ ANTHROPIC_BASE_URL: "  https://gateway.example.com/llm  " }), "https://gateway.example.com/llm");

  /* A bad value THROWS rather than falling back, with the pack's own two rules and wording.
   *
   * The assertion here used to be `modelBase({ANTHROPIC_BASE_URL: "not a url"}) === ""`, which
   * pinned the wrong behaviour in place: "" means default vendor, so a missing scheme — the
   * likeliest typo of the lot — silently became "no endpoint", the key went in under the
   * vendor's name, was checked against the vendor's host, and was discarded on the 401. The
   * exact failure this file exists to prevent, reached by a typo rather than by design.
   *
   * The scheme rule is the mirror image: URL() parses ftp:// and javascript: happily, and
   * accepting one writes a repository variable the agents refuse at runtime, on a schedule,
   * where nobody is watching. */
  for (const bad of ["not a url", "openrouter.ai/api", "gateway.example.com"])
    assert.throws(() => modelBase({ ANTHROPIC_BASE_URL: bad }), /is not a valid URL/, `should reject ${bad}`);
  for (const bad of ["ftp://gateway.example.com/x", "javascript:alert(1)", "file:///etc/passwd"])
    assert.throws(() => modelBase({ ANTHROPIC_BASE_URL: bad }), /must be http\(s\)/, `should reject ${bad}`);
  // And the key name follows, rather than quietly reading as the vendor's.
  assert.throws(() => modelKeyName({ ANTHROPIC_BASE_URL: "openrouter.ai/api" }), /is not a valid URL/);

  // The regression this exists for: verification used to hit the vendor's own host whatever the
  // endpoint was, so a valid gateway key came back 401 and the wizard DISCARDED it. Against a
  // configured endpoint a non-200 is "unknown" (/v1/models is not part of the Messages
  // contract, so a gateway need not implement it); against the default vendor it is still false.
  const realFetch = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url) => { seen.push(String(url)); return { status: 401 }; };
    assert.equal(await verifyModelKey("k", ""), false, "the vendor's own 401 still means a bad key");
    assert.equal(seen.at(-1), `${DEFAULT_MODEL_BASE}/v1/models`);
    assert.equal(await verifyModelKey("k", "https://gateway.example.com"), "unknown",
      "a gateway's 401 must not discard the key");
    assert.equal(seen.at(-1), "https://gateway.example.com/v1/models", "verified against the endpoint actually called");

    globalThis.fetch = async () => ({ status: 200 });
    assert.equal(await verifyModelKey("k", ""), true);
    assert.equal(await verifyModelKey("k", "https://gateway.example.com"), true);

    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
    assert.equal(await verifyModelKey("k", ""), false);
    assert.equal(await verifyModelKey("k", "https://gateway.example.com"), "unknown",
      "an unreachable gateway is not evidence against the key");
  } finally { globalThis.fetch = realFetch; }
});
