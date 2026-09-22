/** The last thing the wizard prints: what it did and what to do next. Text for people, JSON for agents. */
import { MCP_URL, APP_URL } from "./noan.mjs";

export function renderReport(report, { json = false } = {}) {
  if (json) return JSON.stringify(report, null, 2) + "\n";
  const s = report.steps; const L = [];
  L.push("", "──────── what happened ────────");
  if (s.auth?.ok) L.push(`key: ${s.auth.email} · workspace "${s.auth.workspace}" · .env ${s.auth.envAction} · .gitignore ${s.auth.gitignore}`);
  else L.push(`key: not accepted${s.auth?.reason ? ` (${s.auth.reason})` : ""}`);
  if (s.clients?.rows) {
    const wired = s.clients.rows.filter(r => r.detected);
    L.push(wired.length ? `clients: ${wired.map(r => `${r.label} ${r.action}`).join(" · ")}` : `clients: none found (MCP address ${MCP_URL})`);
    for (const r of wired) if (r.after) L.push(`  ${r.label}: ${r.after}`);
  }
  if (s.skill?.rows) L.push(`skill: ${s.skill.rows.map(r => `${r.id} (${r.written} written)`).join(" · ")}; pointers: ${s.skill.pointers.map(p => p.action).join(", ")}`);
  if (s.workspace) L.push(`facts: ${s.workspace.count ?? "?"} (${s.workspace.state})`);
  if (s.agents && !s.agents.skipped) L.push(s.agents.ok ? `agents: ${s.agents.repo || s.agents.dest} — ${s.agents.agentName || "your agent"}, ${s.agents.secrets.length} secrets, ${s.agents.variables.length} variables, safe mode on` : `agents: not set up (${s.agents.reason})`);
  if (report.next?.length) { L.push("", "──────── next ────────"); for (const n of report.next) L.push(`• ${n.say}${n.why ? `  (${n.why})` : ""}`); }
  L.push("");
  return L.join("\n");
}
