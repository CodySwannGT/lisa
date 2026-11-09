#!/usr/bin/env node
/**
 * Controlled AWS CLI for completion tests: it answers only the exact argument
 * vectors a case registered, so the real `aws` is never reached and an
 * unexpected call is recorded rather than silently answered.
 */
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const env = process.env;
if (env.FAKE_AWS_LOG)
  appendFileSync(env.FAKE_AWS_LOG, `${JSON.stringify(args)}\n`);
const table = env.FAKE_AWS_API_FILE
  ? JSON.parse(readFileSync(env.FAKE_AWS_API_FILE, "utf8"))
  : {};
const row = table[JSON.stringify(args)];
if (!row) {
  if (env.FAKE_AWS_UNHANDLED_FILE)
    appendFileSync(env.FAKE_AWS_UNHANDLED_FILE, `${JSON.stringify(args)}\n`);
  process.stderr.write(`unexpected aws invocation: ${args.join(" ")}\n`);
  process.exit(70);
}
if (row.failure) {
  process.stderr.write(row.failure);
  process.exit(row.status ?? 254);
}
process.stdout.write(`${JSON.stringify(row.json)}\n`);
