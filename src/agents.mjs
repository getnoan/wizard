/**
 * The agent pack on the user's own GitHub account: fork, secrets, variables, seeds, one dry run.
 *
 * Everything here goes through the GitHub CLI so no token is ever handled by this code. The
 * seed scripts are the pack's own (run from the clone, output parsed); the variable names are
 * the pack's documented ones. Safe mode stays on: the wizard never sets DRY_RUN to 0.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { writeEnv } from "./env-file.mjs";

export const PACK_REPO = "getnoan/agent-pack";

export function gh(args, opts = {}) {
  const r = spawnSync("gh", args, { encoding: "utf8", ...opts });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), status: r.status };
}
export function ghReady() {
  const v = gh(["--version"]); if (!v.ok) return { ok: false, reason: "the GitHub CLI (gh) is not installed — https://cli.github.com" };
  const a = gh(["auth", "status"]); if (!a.ok) return { ok: false, reason: "gh is not signed in — run: gh auth login" };
  return { ok: true };
}

/** Parse what a seed script prints: the two .env lines per agent. */
export function parseSeedOutput(text) {
  const vars = {};
  for (const m of String(text || "").matchAll(/^\s*([A-Z][A-Z0-9_]*_BLOCK_SLUG)=(\S+)\s*$/gm)) vars[m[1]] = m[2];
  return vars;
}

/** The secrets and variables the pack documents, and which are required for which agent. */
export const PACK_SECRETS = ["NOAN_PERSONAL_API_KEY", "RESEND_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL", "FIRECRAWL_API_KEY", "NEWSLETTER_UNSUB_SECRET"];
export const PACK_VARS = ["MAIL_FROM", "REPLY_TO", "ESCALATE_TO", "STATE_BACKEND", "AGENT_NAME", "COMPANY_NAME", "AGENT_IDENTITY_IDS", "COMMANDERS", "REPORT_RECIPIENT_TAG"];

export async function verifyAnthropic(key) {
  try { const r = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }); return r.status === 200; } catch { return false; }
}
export async function verifyResend(key) {
  try { const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } }); return r.status === 200; } catch { return false; }
}
export async function verifyFirecrawl(key) {
  try { const r = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", { headers: { Authorization: `Bearer ${key}` } }); return r.status === 200; } catch { return false; }
}

/** Fork (or reuse) and clone the pack into dir/noan-agent-pack. */
export function forkAndClone(dir, { dryRun = false } = {}) {
  const dest = path.join(dir, "noan-agent-pack");
  if (existsSync(path.join(dest, ".git"))) return { dest, action: "reused existing clone" };
  if (dryRun) return { dest, action: "would fork and clone" };
  const r = gh(["repo", "fork", PACK_REPO, "--clone", "--remote=false", dest]);
  if (!r.ok) return { dest, action: "fork failed", error: r.err.split("\n")[0] };
  return { dest, action: "forked and cloned" };
}

export function repoSlug(dest) {
  const r = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { cwd: dest });
  return r.ok ? r.out : null;
}

export function setSecret(dest, name, value, dryRun) {
  if (dryRun) return { name, action: "would set" };
  const r = spawnSync("gh", ["secret", "set", name], { cwd: dest, input: value, encoding: "utf8" });
  return { name, action: r.status === 0 ? "set" : "failed", error: r.status === 0 ? undefined : (r.stderr || "").trim().split("\n")[0] };
}
export function setVariable(dest, name, value, dryRun) {
  if (dryRun) return { name, action: "would set" };
  const r = spawnSync("gh", ["variable", "set", name, "--body", value], { cwd: dest, encoding: "utf8" });
  return { name, action: r.status === 0 ? "set" : "failed", error: r.status === 0 ? undefined : (r.stderr || "").trim().split("\n")[0] };
}

/** Run every seed script the pack ships; collect the block slugs they print. */
export function runSeeds(dest, env, { dryRun = false } = {}) {
  const seeds = ["seed-weekly-activity-report.mjs", "seed-fact-alignment.mjs", "seed-market-research-refresh.mjs", "seed-customer-support.mjs", "seed-deck.mjs"];
  const slugs = {}; const rows = [];
  for (const s of seeds) {
    const p = path.join(dest, "agents", s);
    if (!existsSync(p)) { rows.push({ seed: s, action: "missing" }); continue; }
    if (dryRun) { rows.push({ seed: s, action: "would run" }); continue; }
    const r = spawnSync(process.execPath, [p], { cwd: path.join(dest, "agents"), encoding: "utf8", env: { ...process.env, ...env } });
    const found = parseSeedOutput((r.stdout || "") + "\n" + (r.stderr || ""));
    Object.assign(slugs, found);
    rows.push({ seed: s, action: r.status === 0 ? "ran" : "failed", slugs: Object.keys(found).length, error: r.status === 0 ? undefined : (r.stderr || r.stdout || "").trim().split("\n").slice(-1)[0] });
  }
  return { slugs, rows };
}

export function dispatchDryRun(dest, workflow, dryRun) {
  if (dryRun) return { workflow, action: "would dispatch" };
  const r = gh(["workflow", "run", workflow, "-f", "dry_run=1"], { cwd: dest });
  return { workflow, action: r.ok ? "dispatched" : "failed", error: r.ok ? undefined : r.err.split("\n")[0] };
}

export const randomSecret = () => randomBytes(24).toString("hex");

/** Write the pack's .env in the clone so the seeds (and a local run) have what they need. */
export function writePackEnv(dest, pairs, dryRun) { return writeEnv(dest, pairs, { dryRun }); }
