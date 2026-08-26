#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * lisa-postinstall — run the template apply on local install, and make its
 * failure IMPOSSIBLE TO MISS.
 *
 * The previous postinstall was a one-liner:
 *
 *     [ -n "$CI" ] || node …/dist/index.js --yes --skip-git-check . 2>/dev/null || true
 *
 * Two independent silencers. `2>/dev/null` discarded WHY it failed and
 * `|| true` discarded THAT it failed, so a project whose apply could not run
 * received no template updates, no guardrail updates and no signal — install
 * after install, indefinitely. Measured on a consumer: `lisa apply` aborted on
 * a module-resolution failure before doing any work, and nothing anywhere said
 * so. The repository had been silently frozen at whatever Lisa last managed to
 * write.
 *
 * That is this codebase's recurring defect in its purest form: a control
 * reporting success for work it no longer performs.
 *
 * ## Why the exit code stays 0
 *
 * Not an oversight, and not the same thing as the silence. A non-zero
 * postinstall aborts `bun install` / `npm ci` outright, so a broken apply would
 * stop a project installing its dependencies at all — strictly worse than a
 * stale template, and it would strand the repository with no way to install the
 * fix. #318 is the recorded incident behind the caution: a half-run apply left
 * child stacks with the wrong TypeScript config.
 *
 * So the install still succeeds. What changes is that the failure becomes
 * LOUD (the real error reaches the terminal) and DURABLE (a marker `lisa
 * doctor` reads), instead of being thrown away.
 *
 * ## Why the marker lives under node_modules
 *
 * It describes the state of an INSTALL, not of the source tree, and it should
 * not survive one. `node_modules` is already ignored by every consumer, so the
 * marker cannot be committed by accident, and a clean reinstall re-tests the
 * condition from scratch rather than inheriting a verdict from a tree that no
 * longer exists.
 * @module scripts/lisa-postinstall
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { boundedSpawnSync, isChildTimeout } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Hang-detector deadline for the bootstrap apply, in milliseconds.
 *
 * Ten minutes, and it is a ceiling rather than a budget: an apply that has
 * written nothing for ten minutes is not going to finish. Not the shared
 * default, because a full apply writes templates, merges manifests and may
 * install dependencies, so it is minutes rather than seconds.
 *
 * This one matters more than most. It runs inside a package manager's
 * postinstall, where an unbounded child hangs THE INSTALL — no output after the
 * last line it printed, and no gate anywhere to report it, because the thing
 * that would have reported it is what is stuck.
 */
const APPLY_BUDGET_MS = 10 * 60 * 1000;

/** Where the failure marker lives, relative to the project root. */
export const APPLY_FAILURE_MARKER = join(
  "node_modules",
  ".lisa",
  "apply-failed.json"
);

/** The installed entry point the apply runs through. */
const LISA_ENTRY = join(
  "node_modules",
  "@codyswann",
  "lisa",
  "dist",
  "index.js"
);

/**
 * Record that the apply failed, so something can report it later.
 * @param {string} cwd Project root.
 * @param {{status: number|null, output: string}} failure What happened.
 * @returns {void}
 */
function recordFailure(cwd, failure) {
  const path = join(cwd, APPLY_FAILURE_MARKER);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          failedAt: new Date().toISOString(),
          exitCode: failure.status,
          // Truncated: this is a signal that something is wrong plus enough to
          // recognise it, not a log file. The full error already went to the
          // terminal unredirected.
          output: failure.output.slice(-4000),
        },
        null,
        2
      )}\n`
    );
  } catch {
    // A marker we cannot write must not become a second failure mode. The
    // banner below is still printed, so the operator is not left with nothing.
  }
}

/**
 * Clear a stale marker after a successful apply.
 * @param {string} cwd Project root.
 * @returns {void}
 */
function clearFailure(cwd) {
  try {
    rmSync(join(cwd, APPLY_FAILURE_MARKER), { force: true });
  } catch {
    // Nothing to do. A stale marker over-reports, which is the safe direction.
  }
}

/**
 * Run the template apply for a local install.
 * Returns nothing. "The install never fails" is a CONTRACT of this module
 * rather than a value it computes, and returning a constant 0 dressed it up as
 * a decision the caller might act on. The entry point below exits 0
 * unconditionally, which is the honest expression of the same promise.
 * @param {string} [cwd] Project root.
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {void}
 */
export function runPostinstall(cwd = process.cwd(), env = process.env) {
  // CI never applies templates. Established philosophy, and the
  // postinstall-ci-guard test pins it: a CI run must test the tree as
  // committed, not a tree the install just rewrote.
  if (env.CI) return;

  if (!existsSync(join(cwd, LISA_ENTRY))) {
    // Not installed yet, or a workspace layout that hoists elsewhere. Nothing
    // to run and nothing to complain about — this is not the failure the
    // marker is for.
    return;
  }

  let child;
  try {
    child = boundedSpawnSync(
      process.execPath,
      [LISA_ENTRY, "--yes", "--skip-git-check", "."],
      {
        cwd,
        env: { ...env, LISA_BOOTSTRAP: "1" },
        encoding: "utf8",
        // Inherited, NOT captured-and-discarded. The whole point.
        stdio: ["ignore", "inherit", "pipe"],
        timeout: APPLY_BUDGET_MS,
      }
    );
  } catch (error) {
    // A timeout is a failed APPLY, not a failed INSTALL. The bounded child
    // deliberately throws so ordinary callers fail closed; this caller has a
    // stronger, documented contract to leave a durable marker and let the
    // package manager finish. Unknown throws still escape because converting a
    // broken postinstall module into an apparent apply failure would hide the
    // defect that needs fixing.
    if (!isChildTimeout(error)) throw error;
    child = {
      error: Object.assign(
        new Error(
          "Lisa template apply exceeded its ten-minute deadline and was killed."
        ),
        { code: "ETIMEDOUT" }
      ),
      status: null,
      stderr:
        "Lisa template apply exceeded its ten-minute deadline and was killed.\n",
    };
  }

  const stderr = child.stderr ?? "";
  if (stderr) process.stderr.write(stderr);

  if (!child.error && child.status === 0) {
    clearFailure(cwd);
    return;
  }

  const output = child.error ? String(child.error.message) : stderr;
  recordFailure(cwd, { status: child.status ?? null, output });

  process.stderr.write(
    [
      "",
      "  ⚠️  Lisa could not apply its templates to this project.",
      "",
      "  The install SUCCEEDED — your dependencies are fine. What did not happen",
      "  is the template and guardrail update Lisa normally performs here, so",
      "  this project is now frozen at whatever Lisa last managed to write.",
      "",
      "  This is reported rather than fatal on purpose: failing the install would",
      "  stop the project installing dependencies at all, including the fix.",
      "",
      "  The error is printed above. Run `lisa doctor` for the recorded state, or",
      "  re-run the apply directly to see it in isolation:",
      "",
      `      node ${LISA_ENTRY} --yes --skip-git-check .`,
      "",
    ].join("\n")
  );
}

// Realpath-based rather than a URL string comparison: a raw comparison answers
// "no" through a symlinked checkout, a git worktree, or a macOS /tmp path — all
// of which this fleet runs in — and this module would then load, run nothing,
// and exit 0. For a postinstall that is the worst possible silence, since it is
// indistinguishable from the apply having succeeded.
if (invokedAsScript(import.meta.url)) {
  runPostinstall();
  // Unconditionally 0. See the module header: a non-zero postinstall aborts the
  // dependency install outright, which is strictly worse than a stale template
  // and would strand the project with no way to install the fix.
  //
  // `exitCode`, NOT `process.exit(0)`. Under a package manager stdout is a
  // PIPE, and writes to a pipe are asynchronous — `process.exit` tears the
  // process down without flushing them, so the banner this module exists to
  // print could be truncated or lost entirely. The comment a few lines above
  // calls a silent postinstall "the worst possible silence, since it is
  // indistinguishable from the apply having succeeded", and the next statement
  // was capable of causing exactly that. Setting `exitCode` makes the same
  // unconditional-zero promise and lets the event loop drain first.
  process.exitCode = 0;
}
