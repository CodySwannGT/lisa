#!/usr/bin/env node
/**
 * Report every merge driver this checkout's `.gitattributes` asks for and does
 * not have registered (issue CodySwannGT/lisa#3084).
 *
 * ## Why this is a deliverable and not a nicety
 *
 * A `.gitattributes` mapping can be committed, reviewed, merged and shipped
 * while the driver it names never runs. Git falls back to its built-in text
 * merge and **says nothing about the driver being absent** — reproduced in a
 * scratch repo: the merge exits 1 and the file comes back carrying ordinary
 * seven-character conflict fences, exactly as if no mapping existed. Shipping a
 * merge strategy that is present in the repository and absent at runtime would
 * leave #3084 exactly where it was while appearing fixed, and appearing fixed is
 * worse than open, because nobody looks again.
 *
 * ## Why it is not wired into CI
 *
 * CI checks out and never merges locally, so a CI runner legitimately has no
 * driver registered and reddening it would trade a real signal for noise. The
 * condition this reports matters on the machines that MERGE. Registration on
 * those machines is automatic — `postinstall` runs
 * `install-generated-artifact-merge-driver.mjs`, and `lisa apply` runs the
 * learnings driver's migration — so this is the backstop that names the
 * condition when automation did not reach a checkout, not the primary defence.
 *
 * CLI:
 *   node scripts/check-merge-driver-registration.mjs [--root <dir>]
 *
 * Exit codes:
 *   0 — every mapped driver is registered, or nothing is mapped.
 *   1 — at least one mapped driver has no registered command here.
 *   2 — operational error: `--root` missing its value, not a git repository,
 *       or git unavailable.
 *
 * @module scripts/check-merge-driver-registration
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { mergeDriversIn } from "./lib/gitattributes-merge-drivers.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Run a fixed git command, never through a shell.
 * @param {readonly string[]} args - Literal git arguments
 * @param {string} cwd - Working directory
 * @returns {{ok: true, stdout: string} | {ok: false}} Trimmed stdout, or a failure
 */
function git(args, cwd) {
  try {
    return {
      ok: true,
      stdout: execFileSync("git", [...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Classify one checkout's merge-driver registrations.
 * @param {string} root - Directory to inspect
 * @returns {{mapped: string[], unregistered: string[]} | undefined} Roster, or undefined when not a repository
 */
export function inspectMergeDrivers(root) {
  const toplevel = git(["rev-parse", "--show-toplevel"], root);
  if (!toplevel.ok || toplevel.stdout === "") return undefined;
  let contents = "";
  try {
    contents = readFileSync(
      path.join(toplevel.stdout, ".gitattributes"),
      "utf8"
    );
  } catch {
    contents = "";
  }
  const mapped = mergeDriversIn(contents);
  const unregistered = mapped.filter(name => {
    // Deliberately scope-agnostic: registration is written locally, but git
    // resolves a driver from ANY config scope, so asking with `--local` would
    // report a working global registration as missing.
    const value = git(
      ["config", "--get", `merge.${name}.driver`],
      toplevel.stdout
    );
    return !value.ok || value.stdout === "";
  });
  return { mapped, unregistered };
}

/**
 * Run the check.
 * @param {readonly string[]} argv - Arguments after the script name
 * @param {(message: string) => void} [log] - Sink for output
 * @returns {number} Process exit code
 */
export function runCheckMergeDrivers(
  argv,
  log = message => process.stdout.write(`${message}\n`)
) {
  const at = argv.indexOf("--root");
  if (at !== -1 && argv[at + 1] === undefined) {
    log("check-merge-driver-registration: --root requires a directory");
    return 2;
  }
  const root = at === -1 ? process.cwd() : argv[at + 1];
  const report = inspectMergeDrivers(root);
  if (report === undefined) {
    log(`check-merge-driver-registration: ${root} is not a git repository`);
    return 2;
  }
  if (report.mapped.length === 0) {
    log("No .gitattributes merge driver is mapped here; nothing to register.");
    return 0;
  }
  if (report.unregistered.length === 0) {
    log(
      `All ${report.mapped.length} mapped merge driver(s) are registered here.`
    );
    return 0;
  }
  for (const name of report.unregistered) {
    log(
      `.gitattributes maps at least one path to the "${name}" merge driver, but merge.${name}.driver is not registered in this checkout — git silently falls back to its built-in text merge, so those paths conflict on every merge as if the mapping did not exist.`
    );
  }
  log(
    "Fix: run `bun install` here (Lisa's postinstall registers lisa-generated-artifact), or `lisa install-merge-driver` for lisa-learnings."
  );
  return 1;
}

if (invokedAsScript(import.meta.url)) {
  process.exit(runCheckMergeDrivers(process.argv.slice(2)));
}
