/**
 * Shared recorder for the session-manager CLI stub executables.
 *
 * Each stub on the test PATH appends one JSON line per invocation to the file
 * named by STUB_LOG: which binary ran, its argv, its cwd and the NAMES of every
 * environment variable it received. Only names are kept, so a test can prove a
 * variable was absent without the log ever holding a value.
 */
import { appendFileSync } from "node:fs";

/**
 * Append one invocation record to STUB_LOG, when it is set.
 * @param {string} bin - Stub name
 * @returns {void}
 */
export function record(bin) {
  const log = process.env.STUB_LOG;
  if (!log) return;
  appendFileSync(
    log,
    `${JSON.stringify({
      bin,
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      envKeys: Object.keys(process.env),
    })}\n`
  );
}
