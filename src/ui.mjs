/** Prompts. Every one has a non-interactive answer so an agent can run the wizard with --yes. */
import readline from "node:readline";

export function makeUI({ yes = false, json = false } = {}) {
  const out = json ? () => {} : (s = "") => process.stderr.write(s + "\n");   // --json keeps stdout for the report
  const say = out;
  const step = (n, title) => out(`\n${n}. ${title}`);
  const ok = (s) => out(`   ✓ ${s}`);
  const warn = (s) => out(`   ! ${s}`);
  const info = (s) => out(`   ${s}`);

  async function ask(question, { dflt = "", secret = false, required = false } = {}) {
    if (yes) return dflt;
    if (!process.stdin.isTTY) return dflt;
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const label = dflt && !secret ? `${question} [${dflt}]: ` : `${question}: `;
    if (secret) {
      // Mute the echo: the key never appears on screen, in a scrollback, or in a recording.
      rl._writeToOutput = function (s) { if (s.includes(label)) rl.output.write(label); };
    }
    const answer = await new Promise(res => rl.question(label, res));
    rl.close();
    if (secret) process.stderr.write("\n");
    const v = String(answer || "").trim() || dflt;
    if (required && !v) return ask(question, { dflt, secret, required });
    return v;
  }
  async function confirm(question, dflt = true) {
    if (yes || !process.stdin.isTTY) return dflt;
    const v = (await ask(`${question} (${dflt ? "Y/n" : "y/N"})`)).toLowerCase();
    if (!v) return dflt;
    return v.startsWith("y");
  }
  return { say, step, ok, warn, info, ask, confirm, interactive: !yes && !!process.stdin.isTTY };
}
