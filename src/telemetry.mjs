/** Runs, completions and cancels — the three counts that say whether the wizard works for strangers.
 *  Off until a public project token is set here; off whenever the user says so. Never a key, never a path. */
import { randomUUID } from "node:crypto";

// The public (write-only) project API key of PostHog project 52483 — the NOAN product project,
// so the existing read key can query wizard_* events without a new credential. Safe to embed;
// empty = telemetry off. PostHog → Settings → Project → Project API key, starts phc_.
export const POSTHOG_TOKEN = "phc_7O3g17L9CuhzTtpKkrklUZpFGJymLxrO3iMMH1krn6s";
const HOST = "https://us.i.posthog.com";
const TIMEOUT_MS = 2000;           // a slow or blackholed endpoint must never hold up the wizard or its report
const RUN_ID = randomUUID();       // this process only, never stored: pairs started with completed/cancelled

export function telemetryEnabled(args) {
  return !!POSTHOG_TOKEN && args.telemetry !== false && process.env.NOAN_WIZARD_NO_TELEMETRY !== "1";
}
export async function capture(args, event, props = {}) {
  if (!telemetryEnabled(args)) return false;
  try {
    await fetch(`${HOST}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ api_key: POSTHOG_TOKEN, event: `wizard_${event}`, distinct_id: RUN_ID,
        properties: { $process_person_profile: false, node: process.version, platform: process.platform, yes: !!args.yes, json: !!args.json, ...props } }) });
    return true;
  } catch { return false; }
}
