/**
 * The web-facing agents: getnoan/verity-meetings (booking pages) and getnoan/verity-chat (a chat
 * widget for your site). They are always-on services on the user's own domain, not scheduled
 * jobs, so they live in their own repos and deploy to a host (Render by default), not to Actions.
 *
 * The wizard does the part that needs no account the user has not already given it:
 *   fork and clone → seed the service's facts (under the user's own key, a human action) →
 *   prove the service boots locally with NO keys → write a gitignored .env in the clone with what
 *   is known → hand the rest to the coding assistant, INSTALL.md's remaining steps plus a Render
 *   deploy link.
 * The rest — a host account, a Supabase project, Google calendar credentials, DNS, the embed tag on
 * their site — needs the person, and INSTALL.md marks each of those HUMAN.
 *
 * The personal NOAN key is NOT written into the service's .env. That key reaches the whole
 * workspace, and these services answer the open internet; each gets a key made for it, and the
 * hand-off says so. The seeds are different: seeding is a person setting up their own workspace.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { gh, parseSeedOutput, randomSecret } from "./agents.mjs";
import { writeEnv, ensureGitignored } from "./env-file.mjs";

/** One entry per web agent. `boot` is INSTALL.md step 0 — the no-keys local run — and `probe` is
 *  what proves it came up; both are the repos' own CI checks, so a green CI there means this works. */
export const WEB_AGENTS = {
  meetings: {
    label: "Verity Meetings",
    repo: "getnoan/verity-meetings",
    dirName: "verity-meetings",
    what: "booking pages on your own domain",
    seeds: ["agents/seed-scheduling.mjs", "agents/seed-booking.mjs"],
    boot: (port) => ({
      args: ["booking/server.mjs"],
      env: { BOOKING_ENABLED: "1", BOOKING_STORE: "memory", BOOKING_DRY_RUN: "1",
             BOOKING_HOSTS: "founder@example.com,teammate@example.com",
             BOOKING_PUBLIC_URL: `http://127.0.0.1:${port}`, PORT: String(port) },
    }),
    probe: ["/healthz", "/alex"],
    needsModelKey: false,
    // INSTALL.md steps left after the wizard: it has seeded (step 1's second half).
    remaining: "step 2 (Google calendar credentials), step 3 (Supabase + schema.sql), step 4 (deploy), step 5 (DNS)",
    after: "Then edit the Booking Types fact in NOAN: the starters use placeholder hosts, and a type whose host is not in BOOKING_HOSTS is not served.",
  },
  chat: {
    label: "Verity Chat",
    repo: "getnoan/verity-chat",
    dirName: "verity-chat",
    what: "a grounded chat widget for your website",
    seeds: ["agents/seed-site-chat.mjs"],
    boot: (port) => ({
      args: ["--input-type=module", "-e", `const { server } = await import("./site-web/server.mjs"); server.listen(${port}, "127.0.0.1");`],
      env: { NODE_ENV: "test" },
    }),
    probe: ["/healthz", "/widget.js"],
    needsModelKey: true,
    remaining: "step 3 (Supabase + schema.sql — the daily budget refuses every chat until it can meter), step 4 (deploy), step 5 (the embed tag on your site)",
    after: "Set SITE_ALLOWED_ORIGINS to your site's origins and SITE_CHAT_GROUNDING_SLUGS to the blocks it may answer from.",
  },
};

/** Fork (or reuse) and clone a web agent's repo into dir/<dirName>. */
export function forkAndCloneWeb(dir, agent, { dryRun = false } = {}) {
  const dest = path.join(dir, agent.dirName);
  if (existsSync(path.join(dest, ".git"))) return { dest, action: "reused existing clone" };
  if (dryRun) return { dest, action: "would fork and clone" };
  const r = gh(["repo", "fork", agent.repo, "--clone", "--remote=false", dest]);
  if (!r.ok) return { dest, action: "fork failed", error: r.err.split("\n")[0] };
  return { dest, action: "forked and cloned" };
}

/** Run a web agent's seed scripts from the repo root; collect the block slugs they print. */
export function runWebSeeds(dest, agent, env, { dryRun = false } = {}) {
  const slugs = {}; const rows = [];
  for (const s of agent.seeds) {
    const p = path.join(dest, s);
    // A dry run has no clone yet, so "missing" there would be a false alarm.
    if (dryRun && !existsSync(dest)) { rows.push({ seed: s, action: "would run" }); continue; }
    if (!existsSync(p)) { rows.push({ seed: s, action: "missing" }); continue; }
    if (dryRun) { rows.push({ seed: s, action: "would run" }); continue; }
    const r = spawnSync(process.execPath, [p], { cwd: dest, encoding: "utf8", env: { ...process.env, ...env } });
    const found = parseSeedOutput((r.stdout || "") + "\n" + (r.stderr || ""));
    Object.assign(slugs, found);
    rows.push({ seed: s, action: r.status === 0 ? "ran" : "failed", slugs: Object.keys(found).length,
      error: r.status === 0 ? undefined : (r.stderr || r.stdout || "").trim().split("\n").slice(-1)[0] });
  }
  return { slugs, rows };
}

export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer(); s.unref(); s.on("error", rej);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

/** INSTALL.md step 0, run for the user: boot the service with no keys, hit its probes, stop it.
 *  The child gets PATH and HOME only — never the wizard's environment — so no key it holds can
 *  reach the service, and a block slug in the shell cannot switch booking out of its local mode. */
export async function proveLocally(dest, agent, { timeoutMs = 15000, fetchImpl = fetch } = {}) {
  const port = await freePort();
  const { args, env } = agent.boot(port);
  const child = spawn(process.execPath, args, { cwd: dest, stdio: ["ignore", "ignore", "pipe"],
    env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", ...env } });
  let stderr = ""; child.stderr.on("data", d => { stderr = (stderr + d).slice(-2000); });
  const exited = new Promise(r => child.on("exit", code => r(code)));
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + timeoutMs;
    let up = false;
    while (Date.now() < deadline && !up) {
      if (child.exitCode !== null) break;
      try { up = (await fetchImpl(`${base}${agent.probe[0]}`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (!up) await new Promise(r => setTimeout(r, 300));
    }
    if (!up) return { ok: false, reason: child.exitCode !== null ? `exited (${child.exitCode}): ${stderr.trim().split("\n").slice(-1)[0] || "no output"}` : "did not answer in time" };
    for (const p of agent.probe.slice(1)) {
      const r = await fetchImpl(`${base}${p}`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (!r?.ok) return { ok: false, reason: `${p} answered ${r ? r.status : "nothing"}` };
    }
    return { ok: true, probes: agent.probe };
  } finally {
    if (child.exitCode === null) { child.kill(); await Promise.race([exited, new Promise(r => setTimeout(r, 2000))]); }
  }
}

/** Render's one-click deploy for a repo that carries a render.yaml. */
export const renderDeployUrl = (slug) => (slug ? `https://render.com/deploy?repo=https://github.com/${slug}` : null);

/** What goes in the clone's .env. Never the personal NOAN key (see the header). The model key goes
 *  under the name the service reads for the chosen endpoint (the pack's rule: ANTHROPIC_API_KEY for
 *  the default vendor, LLM_API_KEY plus ANTHROPIC_BASE_URL for anything else). */
export function webEnv(agent, { slugs = {}, company = "", agentName = "", modelKey = null, modelKeyName = "ANTHROPIC_API_KEY", modelBase = "" } = {}) {
  return {
    ...slugs,
    ...(company && { COMPANY_NAME: company }),
    ...(agentName && { AGENT_NAME: agentName }),
    ...(agent === WEB_AGENTS.chat && { SESSION_SECRET: randomSecret() }),
    ...(agent.needsModelKey && modelKey && { [modelKeyName]: modelKey }),
    ...(agent.needsModelKey && modelKey && modelBase && { ANTHROPIC_BASE_URL: modelBase }),
  };
}

/** Write the clone's .env: gitignored FIRST (the exported repos ship no .gitignore, and this file
 *  can hold a model key), and a SESSION_SECRET that is already there is kept — rotating it would
 *  sign out every visitor of a chat already deployed from it. */
export function writeWebEnv(dest, pairs, { dryRun = false } = {}) {
  const gitignore = ensureGitignored(dest, { dryRun });
  const envPath = path.join(dest, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const keep = { ...pairs };
  if (/^\s*(?:export\s+)?SESSION_SECRET\s*=\s*\S/m.test(existing)) delete keep.SESSION_SECRET;
  const env = writeEnv(dest, keep, { dryRun });
  return { ...env, gitignore: gitignore.action, keys: Object.keys(keep) };
}

/** The hand-off line for the report's `next` list: what is left, and where to read how. */
export function webNext(agent, { dest, deployUrl, missingModelKey = null }) {
  return {
    id: `web-${agent.dirName}`,
    say: `Finish ${agent.label} (${agent.what}): in ${dest}, follow INSTALL.md ${agent.remaining}.`
      + (missingModelKey ? ` It needs ${missingModelKey} too — the wizard had none to write.` : "")
      + (deployUrl ? ` One-click deploy: ${deployUrl}.` : "")
      + ` Create a NOAN API key for this service alone and set it as NOAN_AGENT_API_KEY in the deploy env — not your personal key.`
      + ` ${agent.after}`,
    why: "the rest needs accounts only you can create; INSTALL.md marks those steps HUMAN",
  };
}
