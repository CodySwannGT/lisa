/**
 * The bite test for the DIFF-ONLY gate — the one that actually runs on pushes
 * and pull requests now that `test:mutation` is the shipped wrapper.
 *
 * `mutation-gate-bite` proves the *whole-list* gate can go red. That is a
 * different gate. Between it and a push stands `lisa-mutation.mjs`, which picks
 * which files Stryker is pointed at, and a defect there is invisible in the
 * worst way available: **a diff-only gate that mutates nothing exits 0, exactly
 * like one that mutated plenty and killed everything.** Wiring assertions cannot
 * tell those apart, so this drives the real script against a real Stryker and
 * requires the two to end differently.
 *
 * Three runs, one throwaway project each:
 *
 * 1. a branch that changed the mutate target, whose tests kill every mutant →
 *    the gate passes, and it says it ran;
 * 2. the same branch with the assertions gutted → the gate FAILS. This is the
 *    bite. Nothing about the wiring changed between runs 1 and 2 — only the
 *    strength of the tests — so a green result here can only mean the gate is
 *    not looking;
 * 3. a branch that changed only a document → the gate exits 0 having reported
 *    `nothing-to-mutate`, and **Stryker was never started**, proved by the
 *    absence of the sandbox it always creates.
 *
 * ## Why the fixture's break threshold is 100
 *
 * `mutation-gate-bite` forbids a threshold invented for the occasion, and the
 * reason is worth restating rather than assumed inapplicable: a number chosen to
 * sit between two measured scores makes any pair of runs "prove" anything. 100
 * is not such a number. It is the one absolute available — *every mutant must
 * die* — so the fixture's verdict is a property of the tests, not of a dial.
 * The strong suite kills all three mutants; the weak one kills one.
 *
 * This is the fixture project's own committed configuration, not an override of
 * Lisa's. Lisa's floor stays where the ratchet holds it.
 * @module tests/integration/mutation-gate-diff-bite
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GateRun } from "../helpers/gate-capture.js";
import { captureGateRun } from "../helpers/gate-capture.js";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";
import { resolveGit } from "../support/git-executable.js";

const ROOT = path.resolve(__dirname, "..", "..");

/** The entry point a host project's `test:mutation` runs, verbatim. */
const GATE = path.join(ROOT, "scripts", "lisa-mutation.mjs");

/** Pinned git binary — resolving `git` via $PATH trips no-os-command-from-path. */
const GIT_BIN = resolveGit();

/** The fixture's only mutate target. */
const TARGET = "src/guard.mjs";

/** The marker the gate prints when it actually handed files to Stryker. */
const SCOPED = "mutation-gate: scoped-run";

/** The single mutate target. Three mutants: `>=`, `<`, and an `undefined` body. */
const GUARD = "export const isBlocked = value => value > 10;\n";

/** The base branch behavior, replaced by {@link GUARD} on the topic branch. */
const BASE_GUARD = "export const isBlocked = value => value > 9;\n";

/** Kills all three: the boundary, the far side, and a non-boolean body. */
const STRONG_SUITE = `import { describe, expect, it } from "vitest";
import { isBlocked } from "../src/guard.mjs";

describe("isBlocked", () => {
  it("does not block the boundary value", () => {
    expect(isBlocked(10)).toBe(false);
  });
  it("blocks above the boundary", () => {
    expect(isBlocked(11)).toBe(true);
  });
});
`;

/**
 * Kills one of three.
 *
 * A type assertion is the archetype of a test that proves the code RAN and
 * nothing about whether it is right — which is the entire reason mutation
 * testing exists, so it is the honest thing to weaken with.
 */
const WEAK_SUITE = `import { describe, expect, it } from "vitest";
import { isBlocked } from "../src/guard.mjs";

describe("isBlocked", () => {
  it("returns a boolean", () => {
    expect(typeof isBlocked(11)).toBe("boolean");
  });
});
`;

/** Repositories created by this suite, removed afterwards. */
const created: string[] = [];

/**
 * Git with the caller's repository-local variables removed.
 *
 * A hook or a nested agent run exports `GIT_DIR`, and a temporary repository
 * created under it points its objects at the real checkout.
 * @param cwd - Working directory
 * @param args - Git arguments
 */
const git = (cwd: string, args: readonly string[]): void => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT_BIN,
    args,
    cwd,
    env: { ...env, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd },
  });
};

/**
 * Write a file, creating parents.
 * @param root - Project root
 * @param rel - Project-relative path
 * @param body - Contents
 */
const write = (root: string, rel: string, body: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

/**
 * A throwaway project that runs Lisa's shipped mutation gate for real.
 *
 * `node_modules` is a symlink to this repository's, which is what makes a real
 * Stryker run affordable here: the fixture resolves the same Stryker, the same
 * vitest and the same runner plugin, and Stryker symlinks it onward into its own
 * sandbox.
 * @param suite - The test file the fixture commits on its topic branch
 * @param changed - Whether the topic branch touches the mutate target or a doc
 * @returns The project root
 */
const fixture = (suite: string, changed: "guard" | "doc"): string => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-diff-gate-"))
  );
  created.push(root);

  fs.symlinkSync(
    path.join(ROOT, "node_modules"),
    path.join(root, "node_modules")
  );
  write(root, "package.json", JSON.stringify({ name: "f", type: "module" }));
  write(root, "vitest.config.mjs", "export default { test: {} };\n");
  write(root, "mutation.gate.json", '{"enabled":true,"since":"main"}');
  write(
    root,
    "stryker.conf.json",
    JSON.stringify({
      testRunner: "vitest",
      reporters: ["clear-text"],
      coverageAnalysis: "perTest",
      concurrency: 2,
      timeoutMS: 60000,
      dryRunTimeoutMinutes: 20,
      cleanTempDir: false,
      mutate: [TARGET],
      thresholds: { high: 100, low: 100, break: 100 },
    })
  );
  write(root, TARGET, BASE_GUARD);
  write(root, "test/guard.test.mjs", STRONG_SUITE);
  write(root, "NOTES.md", "base\n");

  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "gate@example.invalid"]);
  git(root, ["config", "user.name", "Gate Test"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--no-verify", "-m", "base"]);
  git(root, ["checkout", "-q", "-b", "topic"]);

  if (changed === "guard") write(root, TARGET, GUARD);
  else write(root, "NOTES.md", "touched\n");
  write(root, "test/guard.test.mjs", suite);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--no-verify", "-m", "topic"]);

  return root;
};

/** One completed gate run, captured by {@link captureGateRun}. */
type Run = GateRun;

/**
 * Run the shipped gate script in a fixture, exactly as a host's
 * `test:mutation` does.
 *
 * This capture carried the same defect as its whole-list sibling — no
 * `maxBuffer`, and a `failure.status ?? 1` that turned a truncated or signalled
 * run into a plausible-looking gate verdict. It has not fired here yet because
 * a one-guard fixture produces a small report, which is the reason to fix it
 * now rather than when it grows: the assertions below read `.status` exactly
 * the way the whole-list ones do, so the same I/O failure would be accepted as
 * the same wrong answer (CodySwannGT/lisa#2944).
 * A run that never reached a verdict throws here rather than being returned:
 * every assertion below reads `.status`, and a killed or truncated capture has
 * neither a status worth reading nor output worth parsing.
 * @param root - Fixture root
 * @throws {Error} When the capture is truncated, or the gate returns no exit status
 * @returns Exit status and combined output
 */
const runGate = (root: string): Run => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  const run = captureGateRun({
    label: "diff-only gate run",
    command: process.execPath,
    args: [GATE],
    cwd: root,
    env: { ...env, MUTATION_SINCE: "main" },
  });
  if (run.killedBy !== undefined) throw new Error(run.killedBy);
  return run;
};

/**
 * Whether Stryker ran at all, read from the sandbox it always creates.
 *
 * Deliberately not "did the output mention Stryker" — the gate's own log names
 * the file it is about to hand over, so a text probe would answer yes for a run
 * that never started anything.
 * @param root - Fixture root
 * @returns True when a Stryker sandbox exists
 */
const strykerRan = (root: string): boolean =>
  fs.existsSync(path.join(root, ".stryker-tmp"));

describe("diff-only mutation gate", () => {
  afterEach(() => {
    for (const root of created.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it(
    "passes when the changed target's tests kill every mutant",
    { timeout: 900_000 },
    () => {
      const root = fixture(STRONG_SUITE, "guard");
      const run = runGate(root);

      expect(run.status, run.output).toBe(0);
      expect(run.output).toContain(SCOPED);
      expect(run.output).toContain(TARGET);
      expect(strykerRan(root), "Stryker must have run").toBe(true);
      expect(run.output).toMatch(/mutation score/iu);
    }
  );

  it(
    "FAILS when the same change ships tests that cannot bite",
    { timeout: 900_000 },
    () => {
      // The load-bearing assertion of this file. Same wiring, same target, same
      // threshold — only the assertions were gutted.
      const root = fixture(WEAK_SUITE, "guard");
      const run = runGate(root);

      expect(run.status, run.output).not.toBe(0);
      expect(run.output).toContain(SCOPED);
      expect(strykerRan(root)).toBe(true);
    }
  );

  it(
    "says nothing-to-mutate, and starts nothing, on a doc-only branch",
    { timeout: 300_000 },
    () => {
      // The empty-diff control. This run exits 0 — the same code the passing
      // run above exits with — so the output is the only thing that can tell an
      // operator which of the two happened.
      const root = fixture(WEAK_SUITE, "doc");
      const run = runGate(root);

      expect(run.status, run.output).toBe(0);
      expect(run.output).toContain("mutation-gate: nothing-to-mutate");
      expect(run.output).not.toContain(SCOPED);
      expect(run.output).toContain("NO mutant was generated");
      expect(run.output).not.toMatch(/mutation score/iu);
      expect(strykerRan(root), "Stryker must NOT have run").toBe(false);
    }
  );
});
