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
/** LLM_API_KEY is an ALTERNATIVE to ANTHROPIC_API_KEY, not an addition: the pack accepts either
 *  name for the model key and one of the two is required. It is listed so a caller enumerating
 *  the pack's secrets knows the name exists, not so anyone sets both. */
export const PACK_SECRETS = ["NOAN_PERSONAL_API_KEY", "RESEND_API_KEY", "ANTHROPIC_API_KEY", "LLM_API_KEY", "DATABASE_URL", "FIRECRAWL_API_KEY", "NEWSLETTER_UNSUB_SECRET"];
export const PACK_VARS = ["MAIL_FROM", "REPLY_TO", "ESCALATE_TO", "STATE_BACKEND", "ANTHROPIC_BASE_URL", "AGENT_NAME", "COMPANY_NAME", "AGENT_IDENTITY_IDS", "COMMANDERS", "REPORT_RECIPIENT_TAG"];

/** The pack's model endpoint, from the same variable the pack itself reads. Bare base, no
 *  trailing slash; empty string means the default vendor. */
export function modelBase(env = process.env) {
  const raw = (env.ANTHROPIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try { new URL(raw); } catch { return ""; }
  return raw;
}
export const DEFAULT_MODEL_BASE = "https://api.anthropic.com";
/** Which secret name the model key is STORED under: the neutral one once an endpoint is set,
 *  because "ANTHROPIC_API_KEY" holding an OpenRouter key is a lie the next reader has to unpick. */
export const modelKeyName = (env = process.env) => (modelBase(env) ? "LLM_API_KEY" : "ANTHROPIC_API_KEY");

/** What the agents call themselves, and how their own prose refers to them.
 *  Verity is the default because that is the agent people meet in NOAN; anyone who
 *  wants their own name says so and gets it. Unset, the pack signs as "Agent", which
 *  is nobody, so the wizard always sends a name.
 *  Pronouns default to she/her only for Verity: assuming them for a name someone
 *  else chose is worse than the pack's own neutral fallback (they/them). */
export function agentIdentity({ name, pronouns } = {}) {
  const n = String(name ?? "").trim() || "Verity";
  const p = String(pronouns ?? "").trim() || (n.toLowerCase() === "verity" ? "she/her" : "");
  return { AGENT_NAME: n, ...(p && { AGENT_PRONOUNS: p }) };
}

/** Verify the model key against the endpoint that will actually be called.
 *
 *  Against the default vendor this is a straight yes/no. Against a configured endpoint it is
 *  advisory: `/v1/models` is not part of the Messages contract, so a gateway may not implement
 *  it, and a 404 there says nothing about the key. Returning "unknown" rather than false is the
 *  point — the previous behaviour verified every key against the vendor's own host, so a valid
 *  gateway key came back 401 and was DISCARDED with "not accepted by its service". */
export async function verifyModelKey(key, base = "") {
  const root = base || DEFAULT_MODEL_BASE;
  try {
    const r = await fetch(`${root}/v1/models`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
    if (r.status === 200) return true;
    // Only the vendor's own host is trusted to mean "this key is bad".
    return base ? "unknown" : false;
  } catch { return base ? "unknown" : false; }
}
export const verifyAnthropic = (key) => verifyModelKey(key, "");
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

/** The pack's grounding check: which blocks the agents read hold no fact. Runs in the clone; absent in an old pack. */
export function runGroundingCheck(dest, env, { dryRun = false } = {}) {
  const p = path.join(dest, "agents", "grounding-check.mjs");
  if (!existsSync(p)) return { available: false };
  const r = spawnSync(process.execPath, [p, "--json", ...(dryRun ? ["--dry-run"] : [])], { cwd: path.join(dest, "agents"), encoding: "utf8", env: { ...process.env, ...env } });
  return { available: true, ...parseGroundingOutput(r.stdout), error: r.status === 0 ? undefined : (r.stderr || "").trim().split("\n").slice(-1)[0] };
}
export function parseGroundingOutput(text) {
  for (const line of String(text || "").split("\n").reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try { const j = JSON.parse(line); return { gaps: j.gaps || [], filed: j.filed || [] }; } catch {}
  }
  return { gaps: [], filed: [] };
}

export function dispatchDryRun(dest, workflow, dryRun) {
  if (dryRun) return { workflow, action: "would dispatch" };
  const r = gh(["workflow", "run", workflow, "-f", "dry_run=1"], { cwd: dest });
  return { workflow, action: r.ok ? "dispatched" : "failed", error: r.ok ? undefined : r.err.split("\n")[0] };
}

export const randomSecret = () => randomBytes(24).toString("hex");

/** Write the pack's .env in the clone so the seeds (and a local run) have what they need. */
export function writePackEnv(dest, pairs, dryRun) { return writeEnv(dest, pairs, { dryRun }); }
