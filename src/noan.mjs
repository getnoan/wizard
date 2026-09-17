/** The few NOAN calls the wizard makes. Plain fetch; the key travels only in the header. */
export const API = "https://api.getnoan.com/v1";
export const MCP_URL = "https://mcp.getnoan.com/mcp";
export const APP_URL = "https://app.getnoan.com";
export const KEY_PAGE_HINT = "app.getnoan.com → Settings → API → New key";

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
