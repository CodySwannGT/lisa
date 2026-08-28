/**
 * Tests the fallback branch of the `.mjs` suites job.
 *
 * The job has three outcomes, not two, and the third is the one that shipped
 * broken. A runner that collects zero suites fails (the runner counts its own
 * collection). A runner that collects suites runs them. A runner that is
 * ABSENT is neither: the gate cannot run at all, and until this test existed
 * that branch printed a `::warning::` and fell off the end of the script, so
 * the step exited 0.
 *
 * That is `declared-but-uncallable` aimed squarely at the job whose entire
 * purpose is to stop a suite from passing without running. Measured on this
 * repository before the fix: `scripts/lisa-test-node.mjs` absent, context
 * `🔍 Quality Checks / 🧪 Run .mjs Suites` = success, zero suites collected.
 *
 * The assertions that carry weight are the ones at the bottom, which execute
 * the step's own shell body under bash rather than reading it. A string match
 * on `exit 1` proves the characters are present; only running the body proves
 * the status reaches the runner.
 * @module tests/integration/mjs-suite-runner-resolution
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { workflow } from "./quality-gate-facade-fixture.js";

/** The job id under test. */
const JOB = "test_node_suites";

/** The fallback step, which runs when the project declares no gate task. */
const STEP = "🧪 Run .mjs suites (lisa-test-node)";

/** The runner's path inside the installed package. */
const PACKAGE_COPY =
  "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-test-node.mjs";

/** The runner's path after `lisa apply` has copied it in. */
const REPO_COPY = "scripts/lisa-test-node.mjs";

const body =
  (workflow.jobs[JOB].steps ?? []).find(step => step.name === STEP)?.run ?? "";

/**
 * The shell the step body is executed under, by absolute path.
 *
 * `bash`, not `sh`, because that is what GitHub Actions runs a `run:` block
 * under. The distinction is load-bearing rather than cosmetic: `set -o
 * pipefail` is a bash builtin that dash rejects outright, and `/bin/sh` is
 * dash on the Ubuntu runners while on macOS it is bash in POSIX mode, which
 * accepts it. Running this under `/bin/sh` therefore passed on a developer
 * laptop and failed in CI with `Illegal option -o pipefail` — a test asserting
 * the behaviour of a shell the workflow never uses.
 */
const SHELL = "/bin/bash";

/** The step body's filename inside a throwaway project. */
const SCRIPT = "step.sh";

/**
 * Build a throwaway project holding the step body and the requested runners.
 * @param runners Runner paths to create, mapped to the exit status each returns.
 * @returns The project root.
 */
const seed = (runners: Readonly<Record<string, number>>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-mjs-step-"));
  const entries = Object.entries(runners);

  writeFileSync(path.join(dir, SCRIPT), body, "utf8");
  for (const [relative, status] of entries) {
    const full = path.join(dir, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, `process.exit(${status});\n`, "utf8");
  }
  return dir;
};

/**
 * Run the step's own shell body in a throwaway project.
 * @param runners Runner paths to create, mapped to the exit status each returns.
 * @returns Exit status and merged output.
 */
const runStep = (
  runners: Readonly<Record<string, number>> = {}
): { status: number | null; out: string } => {
  const dir = seed(runners);
  const result = boundedSpawnSync({
    label: "the mjs suite runner fallback step",
    command: SHELL,
    args: [path.join(dir, SCRIPT)],
    cwd: dir,
  });
  const out = `${result.stdout}${result.stderr}`;

  rmSync(dir, { force: true, recursive: true });
  return { out, status: result.status };
};

describe("the fallback resolves the runner the way the gate resolver does", () => {
  it("is the step that runs when the project declared no task", () => {
    expect(body).not.toBe("");
    expect(
      (workflow.jobs[JOB].steps ?? []).find(step => step.name === STEP)?.if
    ).toBe("steps.gate.outputs.configured == 'false'");
  });

  it("prefers the packaged copy over the copied one", () => {
    // A project that installed @codyswann/lisa but has not run `lisa apply`
    // has a working runner. Checking only `scripts/` told it it had none.
    const packaged = body.indexOf(PACKAGE_COPY);
    const copied = body.indexOf(`"${REPO_COPY}"`);
    expect(packaged).toBeGreaterThan(-1);
    expect(copied).toBeGreaterThan(-1);
    expect(packaged).toBeLessThan(copied);
  });

  it("names both remedies, because one of them is not `lisa apply`", () => {
    // A project with genuinely no .mjs suites cannot fix this by installing
    // the runner — the runner would then fail on the empty collection. Its
    // remedy is declaring the gate off, and an error that omits it sends the
    // reader in a circle.
    expect(body).toContain("lisa apply");
    expect(body).toContain("test-node-suites");
    expect(body).toContain("off");
  });

  it("does not discard the runner's stderr", () => {
    expect(body).not.toContain("2>/dev/null");
    expect(body).toContain("set -euo pipefail");
  });

  it("declares no shell, so it runs under the Actions default of bash", () => {
    // This is what licenses running the body under bash below, rather than
    // assuming it. `set -o pipefail` above is a bash builtin that dash
    // rejects; if someone pins `shell: sh` here, the step breaks in CI and
    // this assertion is what says so.
    const step = (workflow.jobs[JOB].steps ?? []).find(
      entry => entry.name === STEP
    );

    expect(
      (step as Record<string, unknown> | undefined)?.shell
    ).toBeUndefined();
  });
});

describe("the fallback bites — the behaviour the job depends on", () => {
  it("FAILS when no runner exists on any path", () => {
    // The regression under test. This returned 0 before the fix.
    const { out, status } = runStep();

    expect(status).not.toBe(0);
    expect(out).toContain("::error");
    expect(out).toContain("NO .mjs suites ran");
  });

  it("runs the copied runner and passes on its success", () => {
    const { out, status } = runStep({ [REPO_COPY]: 0 });

    expect(status).toBe(0);
    expect(out).toContain(REPO_COPY);
  });

  it("runs the packaged runner when the copy is absent", () => {
    const { out, status } = runStep({ [PACKAGE_COPY]: 0 });

    expect(status).toBe(0);
    expect(out).toContain(PACKAGE_COPY);
  });

  it("propagates a failing runner rather than swallowing it", () => {
    // An empty collection exits 1 from inside the runner. `set -e` plus the
    // trailing `node "$RUNNER"` is what carries that out of the step.
    const { status } = runStep({ [REPO_COPY]: 1 });

    expect(status).not.toBe(0);
  });
});
