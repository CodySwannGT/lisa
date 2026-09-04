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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** Where the reusable workflows live, relative to the repository root. */
const WORKFLOWS = ".github/workflows";

/** The identity job every gate-bearing reusable workflow carries. */
const IDENTITY_JOB = "lisa_identity";

/** The first candidate of the three-candidate search every resolver runs. */
const REGISTRY_CANDIDATE =
  "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs";

/** One step, with the two spellings js-yaml can hand back for a hyphenated key. */
type Step = {
  name?: string;
  run?: string;
  uses?: string;
  continue_on_error?: boolean;
  "continue-on-error"?: boolean;
};

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
    const workflow = loadWorkflow(path.join(REPO_ROOT, WORKFLOWS, file));
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
      const workflow = loadWorkflow(path.join(REPO_ROOT, WORKFLOWS, file));
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

/**
 * Whether a step installs the project's JavaScript dependencies.
 *
 * The project's, not any: `npm install -g @ast-grep/cli` puts a tool on PATH
 * and leaves `node_modules/@codyswann/lisa` exactly as absent as it found it,
 * so a looser match would read the Rails workflow as installing and demand a
 * Node install from a workflow that deliberately has none.
 * @param step - One step of a workflow job.
 * @returns Whether it installs project dependencies.
 */
function installsDependencies(step: Step): boolean {
  const body = step.run ?? "";
  return (
    /\bnpm ci\b/.test(body) ||
    /\byarn install --frozen-lockfile\b/.test(body) ||
    /\bpnpm install --frozen-lockfile\b/.test(body) ||
    /\bbun install --frozen-lockfile\b/.test(body)
  );
}

/**
 * Whether a step runs the three-candidate registry search.
 * @param step - One step of a workflow job.
 * @returns Whether the step resolves the gate registry.
 */
function resolvesRegistry(step: Step): boolean {
  return (step.run ?? "").includes(REGISTRY_CANDIDATE);
}

describe("the stamp names the copy the gates ran", () => {
  it.each(GATE_WORKFLOWS)(
    "%s resolves the stamp on the same filesystem its gates resolve on",
    file => {
      const workflow = loadWorkflow(path.join(REPO_ROOT, WORKFLOWS, file));
      const jobs = workflow.jobs as Record<string, { steps?: Step[] }>;
      // Sharing the candidate list and the order is only half of naming the
      // copy that produced the verdicts. A workflow whose gate jobs install
      // dependencies resolves `node_modules/@codyswann/lisa/...` — the FIRST
      // candidate — while a stamp job that never installed falls through to
      // the copied `scripts/lisa-gates.mjs`, and in a consumer carrying both
      // those are different files with different bytes.
      // Every job EXCEPT the stamp: counting the stamp's own steps would make
      // the invariant self-satisfying, and an install added here that no gate
      // job runs is the same defect pointed the other way.
      const workflowInstalls = Object.entries(jobs)
        .filter(([name]) => name !== IDENTITY_JOB)
        .some(([, job]) => (job.steps ?? []).some(installsDependencies));
      const identitySteps = jobs[IDENTITY_JOB]?.steps ?? [];
      const searchAt = identitySteps.findIndex(resolvesRegistry);
      expect(
        searchAt,
        `${file}: the stamp job runs no registry search`
      ).toBeGreaterThanOrEqual(0);
      const installedFirst = identitySteps
        .slice(0, searchAt)
        .some(installsDependencies);
      expect(
        installedFirst,
        workflowInstalls
          ? `${file}: gate jobs install dependencies and the stamp job does not, so the two searches can resolve different copies`
          : `${file}: the stamp job installs dependencies no gate job installs, so the two searches can resolve different copies`
      ).toBe(workflowInstalls);
    }
  );

  it.each(GATE_WORKFLOWS)(
    "%s cannot redden a run with the install the stamp needs",
    file => {
      const workflow = loadWorkflow(path.join(REPO_ROOT, WORKFLOWS, file));
      const jobs = workflow.jobs as Record<string, { steps?: Step[] }>;
      // A failed job here fails the reusable workflow, which fails the
      // CALLER's job, which in some consumers is a required context. An
      // install is the most failure-prone thing this job can do, so it has to
      // end in success whatever the project's dependency graph does — and by
      // swallowing its own failure rather than by carrying
      // `continue-on-error`, which the pinned carrier list in
      // `quality-gate-facade` does not allow to grow, and which a step-level
      // timeout would defeat anyway.
      for (const step of jobs[IDENTITY_JOB]?.steps ?? []) {
        if (!installsDependencies(step)) continue;
        const body = step.run ?? "";
        expect(
          step.continue_on_error ?? step["continue-on-error"],
          `${file}: the stamp's install adds an unconditional continue-on-error carrier`
        ).toBeUndefined();
        expect(
          body.trimEnd().endsWith("exit 0"),
          `${file}: the stamp's install can fail the job, and a failed stamp job fails the caller`
        ).toBe(true);
        // Bounded, so a hanging install cannot hold the job to its timeout —
        // which is a job failure that no amount of error swallowing catches.
        expect(body, `${file}: the stamp's install is unbounded`).toContain(
          "timeout 600"
        );
      }
    }
  );

  it.each(GATE_WORKFLOWS)("%s prints which copy it digested", file => {
    const workflow = loadWorkflow(path.join(REPO_ROOT, WORKFLOWS, file));
    const jobs = workflow.jobs as Record<string, { steps?: Step[] }>;
    // The install above makes the stamp resolve what the gates resolve; this
    // makes that checkable. An install can fail, and a digest attributed to no
    // path is a hash a reader has no way to hold against a gate job.
    const bodies = (jobs[IDENTITY_JOB]?.steps ?? [])
      .map(step => step.run ?? "")
      .join("\n");
    expect(bodies).toContain("identity --format=github");
    const registry = readFileSync(
      path.join(REPO_ROOT, "all/copy-overwrite/scripts/lisa-gates.mjs"),
      "utf8"
    );
    expect(registry).toContain("registry_path");
  });
});
