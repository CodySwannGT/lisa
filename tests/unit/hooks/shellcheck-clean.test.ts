/**
 * Every shell script this repository ships stays ShellCheck-clean.
 *
 * shellcheck-directives.test.ts stops a script from hiding a finding with a
 * directive; this one runs ShellCheck itself, following every sourced file, so
 * a new finding fails here instead of accumulating unseen. The scripts are
 * discovered, not listed: every tracked `*.sh`, every file in a `.husky/`
 * directory, and every extension-less file whose shebang names `sh` or `bash`.
 * A script added tomorrow is checked tomorrow.
 *
 * Two kinds of tracked file are left out, both frozen on purpose: `evidence/`,
 * which records what a past run saw, and the `*-pre-facade` fixtures, which are
 * byte-for-byte snapshots of the scripts as they were before the façade so an
 * equivalence test can compare against them. Editing either would destroy the
 * thing it exists to preserve.
 *
 * ShellCheck is a CI-provisioned tool: on a developer machine without it the
 * suite is deferred with the remedy named, and in CI a missing binary fails.
 *
 * Findings depend on the ShellCheck version, and the runner's is older than a
 * current Homebrew one: 0.11 stopped reporting SC2015 on `A && B || true`,
 * which 0.10 and CI still report. A script has to be clean under both, so
 * every failure names the version that produced it.
 *
 * Each script's `source=` hint names the sibling it sources at runtime. Two of
 * those siblings only exist once installed — the Codex installer places
 * `_extract-edit-paths.sh` beside the Harper hooks, and a host's `.husky` gets
 * `pre-push.local` and `pre-push.verify` from the create-only and phaser
 * templates — so the canonical file's directory joins the search path.
 * @module tests/unit/hooks/shellcheck-clean
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { probeSucceeds, suiteDeferral } from "../../support/ci-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Where ShellCheck looks for a sourced file: beside the script, then the canonical copies. */
const SOURCE_PATH = [
  "SCRIPTDIR",
  path.join(REPO_ROOT, "src/codex/scripts"),
  path.join(REPO_ROOT, "typescript/create-only/.husky"),
  path.join(REPO_ROOT, "phaser/copy-overwrite/.husky"),
  path.join(REPO_ROOT, ".husky"),
].join(":");

/** Frozen records and snapshots, which must keep the bytes they captured. */
const FROZEN = [/^evidence\//, /^tests\/fixtures\/[^/]+-pre-facade\//];

/**
 * Scripts whose interpreter is chosen by their host, not by the file.
 * `workflow-contract-assertion.sh` is the `run:` body of every reusable
 * workflow, kept byte-identical to them by check-workflow-contract-assertions,
 * so it cannot carry a directive line of its own; its test runs it with sh.
 */
const HOST_SHELL: Readonly<Record<string, string>> = {
  "scripts/workflow-contract-assertion.sh": "sh",
};

/**
 * How many scripts one ShellCheck run covers. Measured on a quiet box: every
 * script in one run took 22s, so a batch of 15 takes about a second, well
 * inside the default bounded-child budget.
 */
const BATCH_SIZE = 15;

/**
 * Whether a tracked file is a shell script.
 * @param file - Repository-relative path
 * @returns True for `*.sh`, husky hooks, and sh/bash shebang files
 */
function isShellScript(file: string): boolean {
  if (file.endsWith(".sh") || /(^|\/)\.husky\/[^/_][^/]*$/.test(file)) {
    return true;
  }
  if (path.basename(file).includes(".")) {
    return false;
  }
  const firstLine = readFileSync(path.join(REPO_ROOT, file), "utf8").split(
    "\n",
    1
  )[0];
  return /^#!.*\b(?:ba)?sh(?:\s|$)/.test(firstLine ?? "");
}

/**
 * Every tracked shell script outside the frozen records.
 * @returns Repository-relative paths, sorted
 */
function shippedScripts(): readonly string[] {
  const listed = boundedSpawnSync({
    label: "git ls-files",
    command: "git",
    args: ["ls-files", "-z"],
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed.stdout
    .split("\0")
    .filter(file => file.length > 0)
    .filter(file => !FROZEN.some(pattern => pattern.test(file)))
    .filter(file => existsSync(path.join(REPO_ROOT, file)))
    .filter(isShellScript)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Split a list into consecutive batches.
 * @param items - The list
 * @param size - Largest batch
 * @returns The batches, in order
 */
const batches = (
  items: readonly string[],
  size: number
): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size)
  );

const deferred = suiteDeferral(
  () => probeSucceeds("shellcheck", ["--version"]),
  "ShellCheck",
  "Install it: brew install shellcheck, or apt-get install shellcheck."
);

/**
 * The first line of `shellcheck --version` that names the version.
 * @returns For example `version: 0.10.0`
 */
function shellcheckVersion(): string {
  const result = boundedSpawnSync({
    label: "shellcheck --version",
    command: "shellcheck",
    args: ["--version"],
    cwd: REPO_ROOT,
  });
  return (
    result.stdout.split("\n").find(line => line.startsWith("version:")) ??
    "version: unknown"
  );
}

const SCRIPTS = shippedScripts();
const DEFAULT_SHELL = SCRIPTS.filter(script => !(script in HOST_SHELL));

describe("every shipped shell script passes ShellCheck", () => {
  it("finds the scripts it is meant to check", () => {
    // A discovery that silently found nothing would pass every case below.
    expect(SCRIPTS).toContain(".husky/pre-push");
    expect(SCRIPTS).toContain("plugins/src/base/hooks/track-plan-sessions.sh");
    expect(SCRIPTS).toContain("scripts/lisa-enforcement-fallback.sh");
    expect(SCRIPTS.length).toBeGreaterThan(300);
    expect(SCRIPTS.some(script => script.startsWith("evidence/"))).toBe(false);
  });

  describe.skipIf(deferred !== undefined)("ShellCheck reports nothing", () => {
    it.each(batches(DEFAULT_SHELL, BATCH_SIZE).map(batch => [batch[0], batch]))(
      "batch starting at %s",
      (_first, batch) => {
        const result = boundedSpawnSync({
          label: `shellcheck ${batch.length} scripts`,
          command: "shellcheck",
          args: ["-x", "-P", SOURCE_PATH, "-f", "gcc", ...batch],
          cwd: REPO_ROOT,
        });
        expect(result.stdout, `ShellCheck ${shellcheckVersion()}`).toBe("");
        expect(result.status).toBe(0);
      }
    );

    it.each(Object.entries(HOST_SHELL))(
      "%s under its host's %s",
      (script, shell) => {
        const result = boundedSpawnSync({
          label: `shellcheck ${script}`,
          command: "shellcheck",
          args: ["-s", shell, "-f", "gcc", script],
          cwd: REPO_ROOT,
        });
        expect(result.stdout, `ShellCheck ${shellcheckVersion()}`).toBe("");
        expect(result.status).toBe(0);
      }
    );
  });
});
