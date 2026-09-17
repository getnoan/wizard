/** The wizard, step by step. Each step reports a row; the report at the end is built from the rows. */
import { existsSync } from "node:fs";
import path from "node:path";
import { makeUI } from "./ui.mjs";
import { whoAmI, factCount, classifyWorkspace, looksLikeKey, APP_URL, KEY_PAGE_HINT, MCP_URL } from "./noan.mjs";
import { writeEnv, ensureGitignored } from "./env-file.mjs";
import { wireClients, MANUAL_CLIENTS } from "./clients.mjs";
import { fetchSkillFiles, skillTargets, installSkill, writePointers } from "./skill.mjs";
import * as pack from "./agents.mjs";
import { capture } from "./telemetry.mjs";
import { renderReport } from "./report.mjs";

export async function run(args) {
  const ui = makeUI(args);
  const dir = path.resolve(args.dir);
  const report = { version: 1, dir, dryRun: args.dryRun, steps: {}, next: [] };
  const t0 = Date.now();
  await capture(args, "started");
  const finish = async (code, event = code === 0 ? "completed" : "cancelled") => {
    await capture(args, event, { exit: code, ms: Date.now() - t0, empty: report.steps.workspace?.empty });
    report.exit = code;
    process.stdout.write(renderReport(report, { json: args.json }));
    return code;
  };
  if (!existsSync(dir)) { ui.warn(`no such directory: ${dir}`); return finish(1, "cancelled"); }
  ui.say(`NOAN wizard${args.dryRun ? " (dry run: nothing is written)" : ""} — ${dir}`);

  /* 1. auth */
  ui.step(1, "Your NOAN key");
  let key = (args.apiKey || process.env.NOAN_API_KEY || process.env.NOAN_PERSONAL_API_KEY || "").trim();
  if (key) ui.info("using the key from " + (args.apiKey ? "--api-key" : "the environment"));
  if (!key) {
    if (!ui.interactive) { ui.warn("no key: set NOAN_API_KEY or pass --api-key"); report.steps.auth = { ok: false, reason: "no key" }; return finish(2, "cancelled"); }
    ui.info(`Create one at ${KEY_PAGE_HINT} (opening ${APP_URL} is up to you), then paste it here. It is not echoed.`);
    key = await ask(ui, "NOAN API key", { secret: true, required: true });
  }
  if (!looksLikeKey(key)) ui.warn("that does not look like a NOAN key (they start with npak_) — checking anyway");
  const me = await whoAmI(key);
  if (!me.ok) { ui.warn(me.reason); report.steps.auth = { ok: false, reason: me.reason }; return finish(2, "cancelled"); }
  ui.ok(`key accepted: ${me.identity?.email || "?"} in workspace "${me.project?.name || "?"}"`);
  const env = writeEnv(dir, { NOAN_API_KEY: key, NOAN_PERSONAL_API_KEY: key }, { dryRun: args.dryRun });
  const gi = ensureGitignored(dir, { dryRun: args.dryRun });
  ui.ok(`${env.created ? "wrote" : env.changed ? "updated" : "kept"} ${env.path} (NOAN_API_KEY, NOAN_PERSONAL_API_KEY); .gitignore: ${gi.action}`);
  report.steps.auth = { ok: true, email: me.identity?.email, workspace: me.project?.name, env: env.path, envAction: env.created ? "created" : env.changed ? "updated" : "unchanged", gitignore: gi.action };

  /* 2. clients */
  ui.step(2, "Your coding assistants");
  if (args.mcp) {
    const rows = wireClients({ dir, global: args.global, dryRun: args.dryRun });
    for (const r of rows) {
      if (!r.detected) continue;
      ui.ok(`${r.label}: ${r.action}${r.file ? ` (${r.scope} scope, ${r.file})` : ""}`);
    }
    if (!rows.some(r => r.detected)) ui.info("no coding assistant found on this machine; the MCP address is " + MCP_URL);
    report.steps.clients = { rows, manual: MANUAL_CLIENTS };
    for (const m of MANUAL_CLIENTS) ui.info(`${m.label}: ${m.how}`);
  } else { ui.info("skipped (--no-mcp)"); report.steps.clients = { skipped: true }; }

  /* 3. skill */
  ui.step(3, "The NOAN skill");
  if (args.skill) {
    try {
      const { files, missing } = await fetchSkillFiles();
      const rows = installSkill(files, skillTargets({ dir, global: args.global }), { dryRun: args.dryRun });
      for (const m of missing) ui.info(`${m} is not published yet; skipped`);
      for (const r of rows) ui.ok(`${r.id}: ${r.written} file(s) ${args.dryRun ? "to write" : "written"}, ${r.unchanged} unchanged → ${r.root}`);
      const pointers = writePointers(dir, { dryRun: args.dryRun });
      for (const p of pointers) ui.ok(`${path.basename(p.file)}: ${p.action}`);
      report.steps.skill = { rows, pointers, missing };
    } catch (e) { ui.warn(`skill install failed: ${e.message}`); report.steps.skill = { error: e.message }; }
  } else { ui.info("skipped (--no-skill)"); report.steps.skill = { skipped: true }; }

  /* 4. workspace */
  ui.step(4, "Your fact layer");
  const count = await factCount(key);
  const ws = classifyWorkspace(count);
  report.steps.workspace = ws;
  if (ws.state === "empty") {
    ui.warn(`${count} fact(s): the workspace is empty or nearly so. The wizard does not guess facts.`);
    ui.info("Ask your assistant to set up the workspace: it has the first-connect procedure from the skill and will propose a structure from your website, repo or docs before writing anything.");
    report.next.push({ id: "first-connect", say: "Set up my NOAN workspace from our website and this repo. Propose the structure first and wait for my yes before writing.", why: "the fact layer is empty" });
  } else if (ws.state === "populated") ui.ok(`${count} facts in the workspace`);
  else ui.warn("could not count the facts (the key may be read-scoped to a subset); carrying on");

  /* 5. agents */
  ui.step(5, "The agent pack");
  let wantAgents = args.agents;
  if (wantAgents == null) wantAgents = ui.interactive ? await ui.confirm("Set up the six open-source agents on your GitHub account too?", false) : false;
  if (wantAgents) report.steps.agents = await setupAgents({ args, ui, dir, key, me, report });
  else { ui.info("skipped" + (args.yes && args.agents == null ? " (pass --agents to include it)" : "")); report.steps.agents = { skipped: true }; }

  /* 6. report */
  report.next.push({ id: "open", say: `Open ${APP_URL} to see the workspace your assistant is grounded in.` });
  return finish(0);
}

async function ask(ui, q, o) { return ui.ask(q, o); }

async function setupAgents({ args, ui, dir, key, me, report }) {
  const ready = pack.ghReady();
  if (!ready.ok) { ui.warn(ready.reason); return { ok: false, reason: ready.reason }; }
  const fork = pack.forkAndClone(dir, { dryRun: args.dryRun });
  ui.ok(`${fork.action}: ${fork.dest}${fork.error ? ` — ${fork.error}` : ""}`);
  if (fork.error) return { ok: false, reason: fork.error };
  const out = { ok: true, dest: fork.dest, secrets: [], variables: [], seeds: [], skipped: [] };

  // Keys: from the environment (an agent's run) or a prompt (a person's). Verified before they are stored.
  const need = async (name, verify, prompt, { optional = false } = {}) => {
    let v = (process.env[name] || "").trim();
    if (!v && ui.interactive) v = await ui.ask(prompt, { secret: true });
    if (!v) { out.skipped.push({ name, why: optional ? "not provided" : "required, not provided" }); return null; }
    if (verify && !(await verify(v))) { ui.warn(`${name} was not accepted by its service; not stored`); out.skipped.push({ name, why: "rejected" }); return null; }
    return v;
  };
  const anthropic = await need("ANTHROPIC_API_KEY", pack.verifyAnthropic, "Anthropic API key (the agents' model)");
  const resend = await need("RESEND_API_KEY", pack.verifyResend, "Resend API key (the agents' email)");
  const db = await need("DATABASE_URL", null, "Postgres URL for the agents' state ledger (blank to skip; then only market research runs)", { optional: true });
  const firecrawl = await need("FIRECRAWL_API_KEY", pack.verifyFirecrawl, "Firecrawl API key (market research; blank to skip)", { optional: true });
  const mailFrom = process.env.MAIL_FROM || (ui.interactive ? await ui.ask("Sender for the agents' mail, e.g. Agent <agent@yourdomain.com> (a domain verified in Resend)") : "");
  const replyTo = process.env.REPLY_TO || (ui.interactive ? await ui.ask("Reply-to address (a mailbox someone reads)", { dflt: mailFrom.replace(/^.*<|>.*$/g, "") }) : "");
  const escalateTo = process.env.ESCALATE_TO || (ui.interactive ? await ui.ask("Where the support agent escalates when it cannot answer") : "");

  const secrets = { NOAN_PERSONAL_API_KEY: key, ...(anthropic && { ANTHROPIC_API_KEY: anthropic }), ...(resend && { RESEND_API_KEY: resend }),
                    ...(db && { DATABASE_URL: db }), ...(firecrawl && { FIRECRAWL_API_KEY: firecrawl }), NEWSLETTER_UNSUB_SECRET: pack.randomSecret() };
  for (const [n, v] of Object.entries(secrets)) { const r = pack.setSecret(fork.dest, n, v, args.dryRun); out.secrets.push(r); ui.ok(`secret ${n}: ${r.action}${r.error ? ` — ${r.error}` : ""}`); }
  const vars = { DRY_RUN: "1", STATE_BACKEND: db ? "postgres" : "local", ...(mailFrom && { MAIL_FROM: mailFrom }), ...(replyTo && { REPLY_TO: replyTo }), ...(escalateTo && { ESCALATE_TO: escalateTo }),
                 COMPANY_NAME: me.project?.name || "", ...(me.identity?.id && { AGENT_IDENTITY_IDS: me.identity.id }), ...(me.identity?.email && { COMMANDERS: me.identity.email }) };
  // The seeds need the key in the clone's .env; the pack's own .env.example documents the rest.
  pack.writePackEnv(fork.dest, { NOAN_PERSONAL_API_KEY: key, ...(anthropic && { ANTHROPIC_API_KEY: anthropic }), ...(resend && { RESEND_API_KEY: resend }) }, args.dryRun);
  const seeds = pack.runSeeds(fork.dest, { NOAN_PERSONAL_API_KEY: key }, { dryRun: args.dryRun });
  out.seeds = seeds.rows;
  for (const r of seeds.rows) ui.ok(`${r.seed}: ${r.action}${r.slugs != null ? ` (${r.slugs} slug(s))` : ""}${r.error ? ` — ${r.error}` : ""}`);
  Object.assign(vars, seeds.slugs);
  // The blocks the agents read that hold no fact: one task each on the user's board, and a line in the report.
  const grounding = args.dryRun ? { available: false } : pack.runGroundingCheck(fork.dest, { NOAN_PERSONAL_API_KEY: key });
  out.grounding = grounding;
  if (grounding.available) {
    if (grounding.gaps.length) {
      ui.warn(`${grounding.gaps.length} block(s) the agents read hold no fact — ${grounding.filed.filter(f => f.action === "filed").length} task(s) filed on your NOAN board`);
      for (const g of grounding.gaps) ui.info(`  ${g.title}: needed by ${g.agents.join(", ")}`);
      report.next.push({ id: "grounding", say: `Fill the ${grounding.gaps.length} block(s) the agents read (tasks are on your NOAN board): ${grounding.gaps.map(g => g.title).join(", ")}.`, why: "an agent grounded in an empty block fails quietly" });
    } else ui.ok("every block the agents read holds a fact");
  }
  for (const [n, v] of Object.entries(vars)) { if (!v) continue; const r = pack.setVariable(fork.dest, n, v, args.dryRun); out.variables.push(r); }
  ui.ok(`${out.variables.length} repository variable(s) ${args.dryRun ? "to set" : "set"} (DRY_RUN=1: every agent stays in safe mode)`);
  // No point dispatching a run that will only fail for a missing key: say what is missing instead.
  if (!anthropic || !resend) {
    const missing = [!anthropic && "ANTHROPIC_API_KEY", !resend && "RESEND_API_KEY"].filter(Boolean);
    out.incomplete = missing;
    ui.warn(`not dispatching a run: ${missing.join(" and ")} still missing. Add them as repository secrets (or re-run with them in the environment), then run any agent workflow with dry_run=1.`);
  } else {
    const wf = firecrawl ? "market-research-refresh.yml" : "weekly-activity-report.yml";
    const d = pack.dispatchDryRun(fork.dest, wf, args.dryRun);
    out.dryRunDispatch = d;
    ui.ok(`${wf}: ${d.action}${d.error ? ` — ${d.error}` : ""} — read it under Actions, then set DRY_RUN=0 for the agents you trust`);
  }
  out.repo = pack.repoSlug(fork.dest);
  return out;
}
