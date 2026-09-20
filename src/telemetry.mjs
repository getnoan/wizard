/** Runs, completions and cancels — the three counts that say whether the wizard works for strangers.
 *  Off until a public project token is set here; off whenever the user says so. Never a key, never a path. */
import { randomUUID } from "node:crypto";

export const POSTHOG_TOKEN = "";   // public (write-only) PostHog project token, phc_…; empty = telemetry off
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
