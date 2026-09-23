/** Runs, completions and cancels — the three counts that say whether the wizard works for strangers.
 *  Off whenever the user says so, and off in CI. Never a key, never a path, never a workspace name. */
import { randomUUID } from "node:crypto";

// The public, write-only PostHog project key. Embedding one is what it is for; it can send
// events and read nothing. Empty = telemetry off.
export const POSTHOG_TOKEN = "phc_7O3g17L9CuhzTtpKkrklUZpFGJymLxrO3iMMH1krn6s";
const HOST = "https://us.i.posthog.com";
const TIMEOUT_MS = 2000;           // a slow or blackholed endpoint must never hold up the wizard or its report
const RUN_ID = randomUUID();       // this process only, never stored: pairs started with completed/cancelled

/** Everything an event may carry, and the only thing it can. README and SECURITY.md list exactly
 *  this set; a property from any caller that is not here is dropped rather than sent. The promise
 *  is "never a key, never a path, never a workspace name", and a promise one call site can break
 *  by passing an extra key is not a promise — so the guard lives here, not in the callers. */
export const ALLOWED_PROPERTIES = new Set([
  "$process_person_profile", "$geoip_disable",
  "node", "platform", "yes", "json", "exit", "ms", "empty",
]);
const onlyAllowed = (props) => Object.fromEntries(Object.entries(props).filter(([k]) => ALLOWED_PROPERTIES.has(k)));

/** An opt-out env var is set unless it is absent, empty, "0" or "false" — because someone who
 *  writes NO_TELEMETRY=true means it, and the old exact match on "1" silently ignored them. */
const optedOut = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s !== "" && s !== "0" && s !== "false";
};

export function telemetryEnabled(args) {
  if (!POSTHOG_TOKEN || args.telemetry === false) return false;
  if (optedOut(process.env.NOAN_WIZARD_NO_TELEMETRY) || optedOut(process.env.DO_NOT_TRACK)) return false;
  if (optedOut(process.env.CI)) return false;   // a pipeline running the wizard is not a person trying it
  return true;
}
export async function capture(args, event, props = {}) {
  if (!telemetryEnabled(args)) return false;
  try {
    await fetch(`${HOST}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ api_key: POSTHOG_TOKEN, event: `wizard_${event}`, distinct_id: RUN_ID,
        properties: onlyAllowed({ $process_person_profile: false, $geoip_disable: true,
          node: process.version, platform: process.platform, yes: !!args.yes, json: !!args.json, ...props }) }) });
    return true;
  } catch { return false; }
}
