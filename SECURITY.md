# Security

This is a small command-line program that runs on your machine, with your NOAN key. Here is
what it does with that key, and what to do if you find a problem.

## What the wizard touches

- Your NOAN API key is read from `--api-key`, `NOAN_API_KEY` or `NOAN_PERSONAL_API_KEY`, or
  typed at a prompt that does not echo. It is sent to `api.getnoan.com` over HTTPS and written
  to `.env` in the project directory (mode 600, and `.env` is added to `.gitignore`). It is
  never written into any assistant's config file, never logged, and never sent anywhere else.
- Third-party keys for the agent pack (`--agents`) are verified against their own services and
  stored as GitHub repository secrets through the GitHub CLI. This program never sees a GitHub
  token; `gh` holds it.
- Telemetry is three events (a run started, then completed or cancelled) carrying the Node
  version, the platform, the exit code, the duration, whether the run was non-interactive,
  whether the report was JSON, and whether the workspace was empty. Never a key, never a path,
  never a workspace name, never anything read out of the fact layer. A run is identified by an
  id made up for that process and thrown away with it, and the events ask PostHog for no person
  profile and no geolocation — but, like any HTTP request, they arrive from the sender's IP
  address, which is stored on the event unless the receiving project discards client IPs.
  Nothing is sent when `--no-telemetry` is passed, when `NOAN_WIZARD_NO_TELEMETRY` or
  `DO_NOT_TRACK` is set to anything but `0` or `false`, or when `CI` is set.
- The skill files are fetched from `raw.githubusercontent.com/getnoan/skills` and copied, not
  executed.

## Reporting a vulnerability

Email **security@getnoan.com**. Please do not open a public issue for anything that could be
exploited. We aim to acknowledge within two working days.

## Releases

Releases are published to npm from GitHub Actions through npm's trusted publishing: no npm token
exists anywhere, and each release carries a provenance attestation linking it to the commit and
workflow that built it. `npm audit signatures` verifies it.
