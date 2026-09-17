/**
 * The NOAN skill: fetched from the public repo and placed where each assistant reads skills.
 * Files are copied, not symlinked, so the install survives a moved checkout; re-running
 * overwrites with the current published version.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const SKILLS_REPO = "getnoan/skills";
const RAW = `https://raw.githubusercontent.com/${SKILLS_REPO}/main/skills`;
export const SKILL_FILES = [
  "noan-fact-layer/SKILL.md",
  "noan-fact-layer/references/first-connect.md",
  "noan-fact-layer/references/interview.md",
  "noan-fact-layer/references/writing-facts.md",
];
/** Published later than the core skill; installed when present, skipped with a note when not. */
export const OPTIONAL_SKILL_FILES = ["noan-fact-candidate-capture/SKILL.md"];

export async function fetchSkillFiles(fetchImpl = fetch) {
  const out = {}; const missing = [];
  for (const f of [...SKILL_FILES, ...OPTIONAL_SKILL_FILES]) {
    const r = await fetchImpl(`${RAW}/${f}`);
    if (!r.ok) {
      if (OPTIONAL_SKILL_FILES.includes(f) && r.status === 404) { missing.push(f); continue; }
      throw new Error(`could not fetch ${f} from ${SKILLS_REPO} (${r.status})`);
    }
    out[f] = await r.text();
  }
  return { files: out, missing };
}

/** Where skills go: Claude Code reads .claude/skills (project) or ~/.claude/skills (user); Codex reads ~/.codex/skills. */
export function skillTargets({ dir, global = false, home = os.homedir() }) {
  const t = [{ id: "claude-code", root: global ? path.join(home, ".claude", "skills") : path.join(dir, ".claude", "skills") }];
  if (existsSync(path.join(home, ".codex"))) t.push({ id: "codex", root: path.join(home, ".codex", "skills") });
  return t;
}

export function installSkill(files, targets, { dryRun = false } = {}) {
  const rows = [];
  for (const t of targets) {
    let written = 0, unchanged = 0;
    for (const [rel, text] of Object.entries(files)) {
      const p = path.join(t.root, rel);
      const cur = existsSync(p) ? readFileSync(p, "utf8") : null;
      if (cur === text) { unchanged++; continue; }
      if (!dryRun) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); }
      written++;
    }
    rows.push({ id: t.id, root: t.root, written, unchanged });
  }
  return rows;
}

export const POINTER_MARK = "<!-- noan-wizard -->";
export function pointerText() {
  return `${POINTER_MARK}
## NOAN

This project is grounded in the NOAN fact layer. The key is \`NOAN_API_KEY\` in \`.env\`; the MCP server is
configured for this assistant; the \`noan-fact-layer\` skill (installed under the skills folder) says how to read
and write facts. Read facts before answering questions about the business. If the workspace is empty, follow the
skill's first-connect procedure to seed it, and confirm the plan with the user before writing.
`;
}

/** Append the pointer to CLAUDE.md and AGENTS.md (creating them if absent); idempotent on the marker. */
export function writePointers(dir, { dryRun = false } = {}) {
  const rows = [];
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const p = path.join(dir, name);
    const cur = existsSync(p) ? readFileSync(p, "utf8") : "";
    if (cur.includes(POINTER_MARK)) { rows.push({ file: p, action: "already present" }); continue; }
    if (!dryRun) appendFileSync(p, (cur && !cur.endsWith("\n") ? "\n" : "") + (cur ? "\n" : "") + pointerText());
    rows.push({ file: p, action: cur ? "appended" : "created" });
  }
  return rows;
}
