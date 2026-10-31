/**
 * Shared recorder for the session-manager CLI stub executables.
 *
 * Each stub on the test PATH appends one JSON line per invocation to the file
 * named by STUB_LOG: which binary ran, its argv, its cwd and the NAMES of every
 * environment variable it received. Only names are kept, so a test can prove a
 * variable was absent without the log ever holding a value.
 *
 * A stub whose argv or stdin can carry a secret (`bws secret create`, tmux's
 * `source-file -`) passes its own redacted `argv` and a names-only `extra`,
 * so the log never holds a value either way.
 */
import { appendFileSync } from "node:fs";

/**
 * Append one invocation record to STUB_LOG, when it is set.
 * @param {string} bin - Stub name
 * @param {{ argv?: string[], extra?: object }} [overrides] - Redacted argv to
 *   log in place of the real one, and extra names-only detail
 * @returns {void}
 */
export function record(bin, overrides = {}) {
  const log = process.env.STUB_LOG;
  if (!log) return;
  appendFileSync(
    log,
    `${JSON.stringify({
      bin,
      argv: overrides.argv ?? process.argv.slice(2),
      cwd: process.cwd(),
      envKeys: Object.keys(process.env),
      ...(overrides.extra === undefined ? {} : { extra: overrides.extra }),
    })}\n`
  );
}
