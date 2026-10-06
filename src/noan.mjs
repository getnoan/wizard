/** The few NOAN calls the wizard makes. Plain fetch; the key travels only in the header. */
export const API = "https://api.getnoan.com/v1";
export const MCP_URL = "https://mcp.getnoan.com/mcp";
export const APP_URL = "https://app.getnoan.com";
export const KEY_PAGE_HINT = "app.getnoan.com → Settings → API → New key";
/** Where an AGENT-owned key is minted: NOAN's agent identity (role bot), created by an Owner. */
export const AGENT_KEY_PAGE_HINT = "app.getnoan.com → Settings → API → Agent API Keys";

export function looksLikeKey(k) { return typeof k === "string" && /^npak_[A-Za-z0-9_-]{16,}$/.test(k.trim()); }

async function get(path, key) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${key}` } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

/** GET /me: who the key is, and which workspace. */
export async function whoAmI(key) {
  const { status, body } = await get("/me", key);
  if (status === 401 || status === 403) return { ok: false, reason: "the key was not accepted" };
  if (status !== 200 || !body?.project) return { ok: false, reason: `unexpected answer from NOAN (${status})` };
  return { ok: true, project: body.project, identity: body.identity };
}

/** The pack's variables naming who gets work an agent hands back: identity ids, comma-separated.
 *  HUMAN_IDENTITIES (email=id pairs) is the sixth, set alongside these. */
export const HAND_BACK_ASSIGNEE_VARS = ["FACT_ALIGNMENT_REVIEW_ASSIGNEES", "PARK_ASSIGNEES_CS", "PARK_ASSIGNEES_SALES", "PARK_ASSIGNEES_ENG", "REPLY_HUMAN_ASSIGNEES"];

/** Is this /me identity NOAN's agent? Its role is "bot" (and the API gives it no email). */
export function isAgentIdentity(identity) {
  return identity?.role === "bot";
}

/**
 * Who the agents run as, and who steers them, from GET /me on the keys the user gave.
 *
 * NOAN has an agent role: one agent identity per workspace (role bot, no login), which an Owner
 * creates under Settings → Team → Agent; its keys are minted under Settings → API → Agent API Keys. Its id is what the agents answer to
 * (AGENT_IDENTITY_IDS: tasks assigned to it trigger them, comments by it are the agent's own).
 * The people who steer and approve (COMMANDERS) are humans, never the agent.
 *
 * Deriving both from one key's /me was wrong either way: a person's key made the person "the
 * agent", so every comment they wrote was classed as the agent's own and ignored; an agent key
 * made the agent the only commander, and the agent has no email to be one.
 *
 *   person  GET /me of the user's own key (step 1), when it is a person
 *   agent   GET /me of an agent-owned key, when one was given (or step 1's, if that was the agent)
 *   commanders  extra addresses (COMMANDERS env or a prompt), comma-separated
 *
 * Returns the ids/addresses to configure, which key the agents should run on ("agent" or
 * "person"), who gets the work the agents hand back (handBack), and the warnings to say out loud.
 *
 * handBack matters only under the agent role. On a person's key the pack falls back to that
 * person (fact alignment's review) or to nobody (parks never read GET /me); on the agent's key
 * every fallback is deliberately refused, because handing work to the key's owner would hand it
 * to the agent. So with no hand-back settings an agent-key install files its weekly review, its
 * parked tasks and its support follow-ups with no person on them, and nothing errors. The person
 * who ran the wizard is the default owner of all of it. On a person's key handBack stays empty:
 * that person IS the agent there (AGENT_IDENTITY_IDS), so assigning them would hand the work
 * straight back to the agents.
 */
export function agentRoles({ person = null, agent = null, commanders = "" } = {}) {
  const warnings = [];
  const agentId = agent && isAgentIdentity(agent) ? agent.id : null;
  const humans = new Set(String(commanders || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
  if (person && !isAgentIdentity(person) && person.email) humans.add(String(person.email).toLowerCase());
  const out = { agentIds: agentId, commanders: [...humans].join(","), runAs: agentId ? "agent" : "person", warnings };
  if (!agentId) {
    // No agent identity: keep the old single-account setup, but say what it costs.
    out.agentIds = person?.id || null;
    warnings.push(
      "No agent key, so the agents run as you and answer to your own account. Every comment you write on a task " +
      "will read as the agent's own, so steer and approve by email, not task comments. To fix it, create the agent " +
      `(${AGENT_KEY_PAGE_HINT}) and re-run with --agent-key.`);
  }
  if (!out.commanders) warnings.push("No commander: nobody can steer or approve the agents until COMMANDERS lists a person's email.");
  out.handBack = {};
  if (out.runAs === "agent") {
    const human = person && !isAgentIdentity(person) && person.id ? person : null;
    if (human) {
      for (const n of HAND_BACK_ASSIGNEE_VARS) out.handBack[n] = human.id;
      if (human.email) out.handBack.HUMAN_IDENTITIES = `${String(human.email).toLowerCase()}=${human.id}`;
    } else warnings.push(
      "No person's key, so the work the agents hand back (the weekly fact review, parked tasks, support follow-ups) " +
      `has nobody to go to. Set ${HAND_BACK_ASSIGNEE_VARS.join(", ")} on the fork to a person's NOAN identity id ` +
      "(GET /me with their key), or re-run with your own key first and the agent key as --agent-key.");
  }
  return out;
}

/** How many facts the workspace holds — the signal for "empty, hand the seeding over". */
export async function factCount(key) {
  const { status, body } = await get("/facts?per_page=1", key);
  if (status !== 200) return null;
  return body?.meta?.totalItems ?? (Array.isArray(body?.items) ? body.items.length : null);
}

export const EMPTY_THRESHOLD = 10;
export function classifyWorkspace(count) {
  if (count == null) return { state: "unknown", empty: false };
  return { state: count < EMPTY_THRESHOLD ? "empty" : "populated", empty: count < EMPTY_THRESHOLD, count };
}
