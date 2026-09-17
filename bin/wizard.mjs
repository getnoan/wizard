#!/usr/bin/env node
import { run } from "../src/run.mjs";
import { parseArgs, HELP } from "../src/args.mjs";
import { createRequire } from "node:module";

const args = parseArgs(process.argv.slice(2));
if (args.help) { process.stdout.write(HELP); process.exit(0); }
if (args.version) { process.stdout.write(createRequire(import.meta.url)("../package.json").version + "\n"); process.exit(0); }
run(args).then(code => process.exit(code)).catch(e => { console.error("wizard: " + (e?.message || e)); process.exit(1); });
