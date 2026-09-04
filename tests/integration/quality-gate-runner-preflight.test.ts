/**
 * Proves the gate runner's EXISTENCE is checked before a gate runs, by execution.
 *
 * A consumer whose `gates.runner` names a package manager CI did not provision
 * got a bare `exit 127` from `$GATE_RUNNER $GATE_TASK`, repeated identically
 * across every gate job. `exit 127` is "command not found", so the failure read
 * as a broken toolchain rather than a configuration mismatch, and nothing in
 * the output named the configured runner, the provisioned package manager, or
 * the fact that the two disagreed.
 *
 * WHY THIS IS NOT COVERED BY THE SHAPE VALIDATION. `readGates` and the resolve
 * step both refuse a runner that "cannot run a task" — a plain string, no
 * colon, not a shell no-op. That is a property of the CONFIG FILE, and it is
 * the one #2789 needed when `"runner": ":"` silenced every gate. Whether the
 * command EXISTS is a property of the MACHINE, which neither can know. The two
 * are tested separately for that reason; see
 * `quality-gate-runner-validation.test.ts` for the shape half.
 *
 * WHY THIS RUNS THE REAL SHELL. The step's body is pulled verbatim out of
 * `quality.yml` and executed under `bash` against a scrubbed `$PATH`, because
 * the property under test is an EXIT CODE and a message. A test that
 * string-matched the YAML would pass against a probe that never fired — which
 * is exactly how the predecessor defect survived: the shape validator was
 * present, asserted, and structurally incapable of seeing this.
 * @module tests/integration/quality-gate-runner-preflight
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";
import type { WorkflowStep } from "../helpers/workflow-test-utils.js";
import {
  QUALITY_YML,
  stepNamed,
  stepsIn,
  workflowIn,
} from "./quality-gate-facade-fixture.js";

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The preflight step's exact name, as inserted at every run site. */
const PREFLIGHT = "🧪 Verify the configured gate runner is installed";

/** The one line every gate job runs to execute its declared task. */
const RUN_SITE = "$GATE_RUNNER $GATE_TASK";

/** The job whose preflight stands in for all twenty-eight façade copies. */
const JOB_ID = "lint";

/** The fallback preflight this one is the complement of. */
const OXLINT_PREFLIGHT = "🦀 Verify oxlint is installed";

/**
 * The preflight's shell source, as GitHub Actions would run it.
 * @returns The `run:` block.
 */
function preflightBlock(): string {
  const step = stepNamed(JOB_ID, PREFLIGHT);
  const script = step?.run ?? "";
  expect(step, `${JOB_ID} must carry the runner preflight`).toBeTruthy();
  // The block carries no `${{ }}` of its own, so it runs as written; the
  // step's env supplies everything the workflow interpolates.
  expect(script).not.toContain("${{");
  return script;
}

/**
 * Sorted by locale, as a new array.
 * @param values The strings to order.
 * @returns A new, ordered array.
 */
function alphabetical(values: readonly string[]): string[] {
  return values.slice().sort((left, right) => left.localeCompare(right));
}

describe("🧪 gate runner existence preflight", () => {
  let workdir = "";
  let bindir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-preflight-"));
    // A $PATH containing exactly one command, so "installed" and "not
    // installed" are facts this test sets rather than facts of the machine
    // it happens to run on.
    bindir = path.join(workdir, "bin");
    await fs.ensureDir(bindir);
    await fs.writeFile(path.join(bindir, "npm"), "#!/bin/sh\nexit 0\n");
    await fs.chmod(path.join(bindir, "npm"), 0o700);
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Runs the preflight against a declared runner and a provisioned manager.
   * @param runner The resolved `gates.runner` value.
   * @param packageManager The `package_manager` input CI was provisioned with.
   * @returns Exit status and combined output.
   */
  function runPreflight(
    runner: string,
    packageManager: string
  ): { status: number; output: string } {
    const result = boundedSpawnSync({
      label: "the gate runner preflight",
      command: BASH,
      args: ["-c", preflightBlock()],
      cwd: workdir,
      env: {
        PATH: bindir,
        GATE_ID: "code-style",
        GATE_RUNNER: runner,
        GATE_TASK: "lint",
        PACKAGE_MANAGER: packageManager,
      },
    });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  describe("the probe, executed", () => {
    it("refuses a runner whose command is not installed", () => {
      const { status, output } = runPreflight("bun run", "npm");

      expect(status).not.toBe(0);
      expect(output).toContain("::error");
      // The cause, not just the symptom: all three of the configured runner,
      // the missing command, and the provisioned manager must be named.
      expect(output).toContain("bun run");
      expect(output).toContain("npm");
      expect(output).toContain("exit 127");
      expect(output).toContain(".lisa.config.json");
    });

    it("passes a runner whose command is installed and agrees", () => {
      // The other direction: hardening must not redden a correct config.
      const { status, output } = runPreflight("npm run", "npm");

      expect(status).toBe(0);
      expect(output).not.toContain("::error");
      expect(output).not.toContain("::warning");
    });

    it("warns when the runner is present but disagrees with the manager", () => {
      // The same mismatch surviving by luck. It runs today and breaks on the
      // first runner image that drops the tool, so it is a warning rather
      // than either silence or a failure.
      const { status, output } = runPreflight("npm run", "bun");

      expect(status).toBe(0);
      expect(output).toContain("::warning");
      expect(output).not.toContain("::error");
    });
  });

  describe("its placement", () => {
    it("guards every job that runs a declared gate", () => {
      const jobs = Object.keys(workflowIn(QUALITY_YML).jobs);
      const guarded: string[] = [];
      const running: string[] = [];
      for (const job of jobs) {
        const steps = stepsIn(job);
        if (steps.some(step => step.name === PREFLIGHT)) guarded.push(job);
        if (steps.some(step => (step.run ?? "").trim() === RUN_SITE)) {
          running.push(job);
        }
      }
      // Not a count — the SETS. A preflight in a job that runs no gate is as
      // wrong as a run site with no preflight, and a count hides both.
      expect(alphabetical(guarded)).toEqual(alphabetical(running));
      expect(running.length).toBeGreaterThan(0);
    });

    it("runs immediately before the gate it guards", () => {
      const steps = stepsIn(JOB_ID);
      const probe = steps.findIndex(step => step.name === PREFLIGHT);
      const run = steps.findIndex(step => (step.run ?? "").trim() === RUN_SITE);
      expect(probe).toBeGreaterThanOrEqual(0);
      // Anything between them could provision or remove the very command the
      // probe just proved present.
      expect(run).toBe(probe + 1);
    });

    it("is the complement of the fallback preflight, not a second copy", () => {
      // The defect this fixes: the file's only other tool-existence check is
      // gated on the branch that never touches the runner, so it could not
      // have been extended to cover this.
      const oxlint = stepNamed(JOB_ID, OXLINT_PREFLIGHT);
      const probe = stepNamed(JOB_ID, PREFLIGHT);
      expect(oxlint?.if).toBe("steps.gate.outputs.configured == 'false'");
      expect(probe?.if).toBe("steps.gate.outputs.configured == 'true'");
    });

    it("leaves a job that resolves a gate it never runs alone", () => {
      // `snyk` carries the same resolve block and provisions no toolchain
      // before it, so a probe there would fail a healthy project for a
      // runner that job never invokes.
      const names = stepsIn("snyk").map(step => step.name);
      expect(names).not.toContain(PREFLIGHT);
    });
  });

  describe("the Rails sibling workflow", () => {
    /**
     * `quality-rails.yml` parsed directly.
     *
     * Not through the façade fixture: that one refuses any workflow outside
     * its pinned list, and this file is deliberately not a façade consumer.
     * @returns The parsed workflow.
     */
    function railsJobs(): Record<string, { steps?: WorkflowStep[] }> {
      const file = path.join(path.dirname(QUALITY_YML), "quality-rails.yml");
      return loadWorkflow(file).jobs as Record<
        string,
        { steps?: WorkflowStep[] }
      >;
    }

    it("guards its gate run site too", () => {
      // The same defect in a sibling workflow consumed @main. Fixing one and
      // not the other ships a fix that reaches 29 of 30 sites.
      const guarded: string[] = [];
      const running: string[] = [];
      for (const [job, definition] of Object.entries(railsJobs())) {
        const steps = definition.steps ?? [];
        if (steps.some(step => step.name === PREFLIGHT)) guarded.push(job);
        if (steps.some(step => (step.run ?? "").trim() === RUN_SITE)) {
          running.push(job);
        }
      }
      expect(alphabetical(guarded)).toEqual(alphabetical(running));
      expect(running.length).toBeGreaterThan(0);
    });

    it("does not name a package manager it has no input for", () => {
      // This workflow declares no `package_manager` input, so the mismatch
      // half of the quality.yml message is not knowable here. Naming it
      // anyway would print an empty value as though it were a finding.
      const steps = Object.values(railsJobs()).flatMap(
        definition => definition.steps ?? []
      );
      const probe = steps.find(step => step.name === PREFLIGHT);
      expect(probe).toBeTruthy();
      expect(probe?.run ?? "").not.toContain("PACKAGE_MANAGER");
      expect(probe?.run ?? "").toContain("exit 127");
    });
  });
});
