/** Runs, completions and cancels — the three counts that say whether the wizard works for strangers.
 *  Off whenever the user says so, and off in CI. Never a key, never a path, never a workspace name. */
import { randomUUID } from "node:crypto";

// The public, write-only PostHog project key. Embedding one is what it is for; it can send
// events and read nothing. Empty = telemetry off.
export const POSTHOG_TOKEN = "phc_7O3g17L9CuhzTtpKkrklUZpFGJymLxrO3iMMH1krn6s";
const HOST = "https://us.i.posthog.com";
const TIMEOUT_MS = 2000;           // a slow or blackholed endpoint must never hold up the wizard or its report
const RUN_ID = randomUUID();       // this process only, never stored: pairs started with completed/cancelled

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
        properties: { $process_person_profile: false, $geoip_disable: true,
          node: process.version, platform: process.platform, yes: !!args.yes, json: !!args.json, ...props } }) });
    return true;
  } catch { return false; }
}
