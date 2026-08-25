/**
 * The shared fixture for the shell-guard REFUSAL controls (CodySwannGT/lisa#3190).
 *
 * Every subject here was already executed by a passing suite. What none of them
 * had was a case that drives the guard onto its refusal path and asserts the
 * exit status — so replacing any of them with an unconditional `exit 0` left
 * the tree green. A guard with no test is visibly unproven; a guard with a
 * green allows-only suite reads as covered, which is the more dangerous of the
 * two and is what this fixture exists to end.
 *
 * ## Copies are derived, never written down
 *
 * Every roster is `git ls-files`, filtered by basename. CodySwannGT/lisa#2847
 * is the reason: three suites named "parity" each wrote their own two-entry
 * roster, and a third tracked copy sat six commits behind for four weeks with
 * all three green. A copy added tomorrow joins these cases with nothing edited
 * here, and a roster that resolves to NOTHING throws rather than quietly
 * testing the empty set.
 * @module tests/integration/support/shell-guard-refusal-fixture
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkoutFiles } from "../../helpers/tracked-files.js";

/** Repository root, resolved from this module's own location. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
export const BASH = "/bin/bash";

/** The exit status a tool-boundary guard uses to refuse a write. */
export const REFUSED = 2;

/** The exit status that lets ordinary work through. */
export const PERMITTED = 0;

/** The exit status a non-hook guard uses to refuse. */
export const REJECTED = 1;

/**
 * A PATH holding only the system directories, so a stub cannot be shadowed.
 *
 * The ambient PATH is deliberately NOT inherited by the cases that install
 * stubs: a developer machine with the real `gh`, `curl` or `jira` installed
 * would otherwise reach the network from a case whose whole point is that it
 * does not, and the case would pass for a reason that is untrue on CI.
 */
export const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/**
 * Every tracked copy of one shipped script, derived from the checkout.
 * @param basename - File name, e.g. `lisa-edit-gate.sh`.
 * @returns Repository-relative paths of every tracked copy, sorted.
 * @throws {Error} When the checkout has no file by that name.
 */
export function trackedCopies(basename: string): readonly string[] {
  const copies = checkoutFiles(REPO_ROOT)
    .filter(file => path.basename(file) === basename)
    .sort((left, right) => left.localeCompare(right));
  if (copies.length === 0) {
    // A roster that silently resolves to nothing turns every case below into a
    // check over the empty set — the same "green while inert" shape the whole
    // ticket is about, one level up.
    throw new Error(`No tracked file named "${basename}" under ${REPO_ROOT}`);
  }
  return copies;
}

/**
 * Write one executable stub into a directory that will be put on PATH.
 * @param directory - Directory to create the stub in.
 * @param name - Binary name to shadow.
 * @param body - Shell body, appended after a `#!/bin/sh` line.
 * @returns Absolute path of the stub.
 */
export function writeStub(
  directory: string,
  name: string,
  body: string
): string {
  const stub = path.join(directory, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(stub, `#!/bin/sh\n${body}`);
  chmodSync(stub, 0o755);
  return stub;
}
