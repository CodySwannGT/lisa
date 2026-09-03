/**
 * Proof that BOTH gate surfaces say which Lisa produced their report.
 *
 * The confusion this closes is *between* surfaces, so stamping one of them
 * half-solves it. A consumer pins `@codyswann/lisa` for its pre-push hook and
 * calls the reusable workflow at a floating ref for CI; a claim sourced from
 * one and applied to the other is a claim about different code, and nothing
 * either surface emitted made that visible.
 *
 * These assertions are about the SHIPPED artifacts rather than about a
 * function's return value, because the defect was never in the computation —
 * `registryVersion()` and `workflow_ref` already existed and were already
 * correct. They landed only in a JSON evidence document written only when
 * `--evidence` was passed, which the seeded hooks never pass. The gap was
 * between "computed" and "printed where an operator reads it".
 * @module tests/integration/gate-output-names-its-lisa
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-run-gates.mjs"
);

/** The identity job every gate-bearing reusable workflow carries. */
const IDENTITY_JOB = "lisa_identity";

/**
 * The reusable workflows that run gates and therefore have to stamp.
 *
 * Listed rather than globbed, deliberately: a glob over `.github/workflows`
 * would let this suite pass by finding nothing when the directory moves, and
 * these three are the files whose jobs post gate verdicts a reader may quote.
 */
const GATE_WORKFLOWS = [
  "quality.yml",
  "quality-rails.yml",
  "playwright-e2e.yml",
] as const;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

/**
 * A project directory declaring nothing, cleaned up afterwards.
 * @returns The absolute path to the scratch project.
 */
function bareProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-surface-"));
  roots.push(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x" }));
  return root;
}

/**
 * This process's environment with the surface signal removed.
 *
 * The runner stamps `surface=ci` when it inherits `GITHUB_ACTIONS=true`, and
 * this suite runs on both surfaces. Inheriting the variable turned the
 * local-surface assertion below into a claim about where the suite ran, and
 * it failed in CI on every diff.
 *
 * Scrubbed rather than accommodated: an assertion widened to accept either
 * surface would pass everywhere and prove nothing, and what is under test is
 * precisely that the stamp names its surface correctly.
 * @returns The environment the runner inherits unless a case says otherwise.
 */
function surfacelessEnv(): NodeJS.ProcessEnv {
  const { GITHUB_ACTIONS: _runnerSignal, ...rest } = process.env;
  return rest;
}

/**
 * Run the gate runner at a moment and return everything it printed.
 * @param moment - The moment to run.
 * @param cwd - The project to run it in.
 * @param env - Environment overrides layered on a surface-free environment.
 * @returns The completed child process.
 */
function runGates(moment: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
  return boundedSpawnSync({
    label: `lisa-run-gates ${moment}`,
    command: process.execPath,
    args: [RUNNER, `--moment=${moment}`],
    cwd,
    env: { ...surfacelessEnv(), ...env },
  });
}

describe("the local gate surface", () => {
  it("names the Lisa it ran before any gate can decide the outcome", () => {
    const run = runGates("push", bareProject());
    const [first] = run.stdout.split("\n");
    expect(first).toContain("🔖 Lisa identity");
    expect(first).toContain("surface=local");
  });

  it("names the resolved package version, not the host application's", () => {
    // The host manifest above declares no version at all. A stamp that read
    // `../package.json` would report the host's; this one has to resolve
    // `@codyswann/lisa` or say `unknown`.
    const run = runGates("push", bareProject());
    expect(run.stdout).toMatch(/package=@codyswann\/lisa@(\d[\w.-]*|unknown)/);
  });

  it("stamps a run that proves nothing as loudly as one that proves something", () => {
    // Every early return is a report an operator may quote later, so the
    // identity cannot be conditional on gates having run.
    const run = runGates("session-start", bareProject());
    expect(run.stdout).toContain("🔖 Lisa identity");
  });
});

describe("the CI gate surface", () => {
  it.each(GATE_WORKFLOWS)("%s carries an identity job", file => {
    const workflow = loadWorkflow(
      path.join(REPO_ROOT, ".github/workflows", file)
    );
    const job = (workflow.jobs as Record<string, unknown>)[IDENTITY_JOB] as {
      needs?: unknown;
      if?: unknown;
      steps: { run?: string }[];
    };
    expect(job, `${file} has no ${IDENTITY_JOB} job`).toBeTruthy();
    // No `needs` and no `if`: the identity has to be on the run whether the
    // gates passed, failed, were optional, or were planned away.
    expect(job.needs).toBeUndefined();
    expect(job.if).toBeUndefined();
    const bodies = job.steps.map(step => step.run ?? "").join("\n");
    expect(bodies).toContain("identity --format=github");
    // Resolved through the same three-candidate search the gate jobs use, so
    // the stamp names the copy that will actually produce the verdicts.
    expect(bodies).toContain(
      "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs"
    );
    // Report only. A stamp that could redden CI would be a new gate nobody
    // declared, shipped to a fleet where every project reports.
    expect(bodies).toContain("|| true");
  });

  it.each(GATE_WORKFLOWS)(
    "%s never makes the stamp a merge condition",
    file => {
      const workflow = loadWorkflow(
        path.join(REPO_ROOT, ".github/workflows", file)
      );
      const job = (workflow.jobs as Record<string, Record<string, unknown>>)[
        IDENTITY_JOB
      ];
      for (const [name, other] of Object.entries(
        workflow.jobs as Record<string, { needs?: string | string[] }>
      )) {
        const needs = other.needs ?? [];
        const listed = Array.isArray(needs) ? needs : [needs];
        expect(listed, `${name} depends on the stamp`).not.toContain(
          IDENTITY_JOB
        );
      }
      expect(job.permissions).toEqual({ contents: "read" });
    }
  );
});
