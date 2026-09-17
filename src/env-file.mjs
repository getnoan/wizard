/** .env handling: set keys without disturbing the rest, keep the file private, keep it out of git. */
import { readFileSync, writeFileSync, existsSync, chmodSync, appendFileSync } from "node:fs";
import path from "node:path";

/** Returns the new file text with `pairs` set (replacing existing lines for those keys). */
export function upsertEnv(text, pairs) {
  const lines = (text || "").split("\n");
  const done = new Set();
  const out = lines.map(l => {
    const m = l.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (m && m[1] in pairs) { done.add(m[1]); return `${m[1]}=${pairs[m[1]]}`; }
    return l;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [k, v] of Object.entries(pairs)) if (!done.has(k)) out.push(`${k}=${v}`);
  return out.join("\n") + "\n";
}

export function writeEnv(dir, pairs, { dryRun = false } = {}) {
  const p = path.join(dir, ".env");
  const before = existsSync(p) ? readFileSync(p, "utf8") : "";
  const after = upsertEnv(before, pairs);
  if (!dryRun) { writeFileSync(p, after); try { chmodSync(p, 0o600); } catch {} }
  return { path: p, created: !before, changed: before !== after };
}

/** .gitignore must cover .env; add the line if the directory is a git checkout (or already has a .gitignore). */
export function ensureGitignored(dir, { dryRun = false } = {}) {
  const gi = path.join(dir, ".gitignore");
  const isRepo = existsSync(path.join(dir, ".git"));
  if (!isRepo && !existsSync(gi)) return { path: gi, action: "not a git repo" };
  const text = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (text.split("\n").some(l => /^\s*\.env(\s*$|\s+#)/.test(l) || l.trim() === ".env*" || l.trim() === "*.env")) return { path: gi, action: "already ignored" };
  if (!dryRun) appendFileSync(gi, (text && !text.endsWith("\n") ? "\n" : "") + ".env\n");
  return { path: gi, action: "added .env" };
}
