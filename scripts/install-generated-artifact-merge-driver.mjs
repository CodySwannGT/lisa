#!/usr/bin/env node
/**
 * Register the `lisa-generated-artifact` merge driver in this checkout's local
 * git config (issue CodySwannGT/lisa#3084).
 *
 * ## Why this exists separately from the learnings driver's registration
 *
 * Lisa already registers a merge driver — `lisa-learnings` — from the
 * `EnsureLearningsMergeDriver` migration, which runs on every `lisa apply`, and
 * `lisa apply` runs from a HOST project's `postinstall`. That path covers every
 * consumer and covers **Lisa's own repository not at all**: Lisa's `postinstall`
 * is `install-claude-plugins.sh` plus a `tsc` fallback, with no apply, because
 * apply is self-restricted in the source repo. Measured — `git config --get
 * merge.lisa-learnings.driver` exits 1 in the main checkout and in agent
 * worktrees alike.
 *
 * That asymmetry is exactly backwards for #3084: the two artifacts this driver
 * serves exist **only** in the Lisa repository, which is the one place the
 * existing registration mechanism never reaches. So this registration runs from
 * Lisa's own `postinstall` instead, where `bun install` in a fresh clone or a
 * fresh agent worktree fires it with no separate operator step.
 *
 * ## Why it is inert everywhere else
 *
 * Lisa's `postinstall` also runs inside `node_modules/@codyswann/lisa` when a
 * consumer installs the package, where blindly writing a driver command would
 * litter the consumer's git config with a path that does not exist there. The
 * roster is therefore read from the checkout's own `.gitattributes`: unless a
 * tracked path in THIS working tree is mapped to the driver, there is nothing
 * to register and the script says so and exits 0.
 *
 * ## Why the command is repo-relative
 *
 * `git config --local` writes to `.git/config`, which every linked worktree of
 * a repository SHARES. An absolute path would pin every worktree's merges to
 * whichever checkout happened to register last — including one later deleted.
 * Git runs a merge driver with its cwd at the top level of the working tree
 * being merged (measured, including when `git merge` is invoked from a
 * subdirectory), so `./scripts/...` resolves per-worktree and stays correct.
 *
 * Exit codes:
 *   0 — registered, already correct, or nothing mapped here to register.
 *   1 — a git-config write genuinely failed. Reporting success there would tell
 *       an operator the artifacts are protected when they are not.
 *
 * @module scripts/install-generated-artifact-merge-driver
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Merge-driver name shared by `.gitattributes` and local git config. */
export const GENERATED_ARTIFACT_DRIVER = "lisa-generated-artifact";

/** Human-readable driver name recorded alongside the command. */
const DRIVER_DESCRIPTION =
  "Reconstruct a generated artifact from both sides of a merge";

/** Repo-relative driver entry point. */
const DRIVER_SCRIPT = "scripts/merge-generated-artifact.mjs";

/** The command git will run, with git's own `%O %A %B %P` placeholders. */
export const DRIVER_COMMAND = `node ./${DRIVER_SCRIPT} --base %O --ours %A --theirs %B --path %P`;

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
 * Paths this working tree maps to the driver, confirmed by git.
 *
 * Two steps rather than one, and both are needed. `.gitattributes` supplies the
 * CANDIDATES cheaply — asking `git check-attr` about every tracked file would
 * be several thousand git invocations inside a `postinstall`. `git check-attr`
 * then supplies the ANSWER, because whether a pattern actually resolves to this
 * driver depends on pattern precedence and on every attributes source git
 * consults, which reading one file cannot tell you.
 * @param {string} root - Working-tree top level
 * @returns {string[]} Paths git confirms are mapped to this driver
 */
function mappedPaths(root) {
  const patterns = [];
  try {
    for (const line of readFileSync(
      path.join(root, ".gitattributes"),
      "utf8"
    ).split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const [pattern, ...attributes] = trimmed.split(/\s+/u);
      if (attributes.includes(`merge=${GENERATED_ARTIFACT_DRIVER}`))
        patterns.push(pattern);
    }
  } catch {
    return [];
  }
  if (patterns.length === 0) return [];
  const attr = git(["check-attr", "merge", "--", ...patterns], root);
  if (!attr.ok) return [];
  return attr.stdout
    .split("\n")
    .filter(line => line.endsWith(`merge: ${GENERATED_ARTIFACT_DRIVER}`))
    .map(line => line.slice(0, line.indexOf(": merge:")));
}

/**
 * Register the driver for one checkout.
 * @param {string} cwd - Directory to register from
 * @param {(message: string) => void} log - Sink for the outcome line
 * @returns {number} Process exit code
 */
export function installGeneratedArtifactMergeDriver(cwd, log) {
  const toplevel = git(["rev-parse", "--show-toplevel"], cwd);
  if (!toplevel.ok || toplevel.stdout === "") {
    log(
      `${GENERATED_ARTIFACT_DRIVER}: not a git working tree — nothing to register`
    );
    return 0;
  }
  const root = toplevel.stdout;
  if (!existsSync(path.join(root, DRIVER_SCRIPT))) {
    log(
      `${GENERATED_ARTIFACT_DRIVER}: ${DRIVER_SCRIPT} is not in this working tree — nothing to register`
    );
    return 0;
  }
  const attributed = mappedPaths(root);
  if (attributed.length === 0) {
    log(
      `${GENERATED_ARTIFACT_DRIVER}: nothing in this working tree maps to the driver — nothing to register`
    );
    return 0;
  }
  const current = git(
    ["config", "--local", "--get", `merge.${GENERATED_ARTIFACT_DRIVER}.driver`],
    root
  );
  if (current.ok && current.stdout === DRIVER_COMMAND) {
    log(
      `${GENERATED_ARTIFACT_DRIVER}: already registered for ${attributed.length} path(s)`
    );
    return 0;
  }
  git(
    [
      "config",
      "--local",
      `merge.${GENERATED_ARTIFACT_DRIVER}.name`,
      DRIVER_DESCRIPTION,
    ],
    root
  );
  const written = git(
    [
      "config",
      "--local",
      `merge.${GENERATED_ARTIFACT_DRIVER}.driver`,
      DRIVER_COMMAND,
    ],
    root
  );
  if (!written.ok) {
    log(
      `${GENERATED_ARTIFACT_DRIVER}: could not write local git config — merge driver NOT registered; generated artifacts will conflict on every merge`
    );
    return 1;
  }
  log(
    `${GENERATED_ARTIFACT_DRIVER}: registered for ${attributed.length} path(s)`
  );
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  process.exit(
    installGeneratedArtifactMergeDriver(process.cwd(), message =>
      process.stdout.write(`${message}\n`)
    )
  );
}
