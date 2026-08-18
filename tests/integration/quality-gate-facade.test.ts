import {
  CONFIGURED,
  CONVERTED,
  NOT_CONFIGURED,
  PREEXISTING_CONTINUE_ON_ERROR,
  loadRegistry,
  resolveStep,
  source,
  stepNamed,
  stepsIn,
  workflow,
} from "./quality-gate-facade-fixture.js";
import type { GateDefinition } from "./quality-gate-facade-fixture.js";

let registry: Record<string, GateDefinition>;

beforeAll(async () => {
  registry = await loadRegistry();
});

describe("quality.yml gate façade", () => {
  describe("job names are unchanged", () => {
    it.each(CONVERTED)(
      "$job still declares the exact context name $jobName",
      ({ job, jobName }) => {
        expect((workflow.jobs[job] as { name?: string })?.name).toBe(jobName);
      }
    );

    it.each(CONVERTED)(
      "$job's name matches REGISTRY.$gate.label, so the derived required-context list still names it",
      ({ jobName, gate }) => {
        expect(registry[gate]?.label).toBe(jobName);
      }
    );

    it.each(CONVERTED)(
      "$job is not a matrix, which would rewrite its context name",
      ({ job }) => {
        expect(
          (workflow.jobs[job] as { strategy?: unknown }).strategy
        ).toBeUndefined();
      }
    );

    it("leaves every converted job id in place", () => {
      for (const { job } of CONVERTED) {
        expect(Object.keys(workflow.jobs)).toContain(job);
      }
    });
  });

  describe("each converted job resolves its gate from config", () => {
    it.each(CONVERTED)(
      "$job resolves $gate through the shipped registry script",
      ({ job, gate }) => {
        const resolve = resolveStep(job);
        expect(resolve).toBeDefined();
        expect(resolve?.env?.GATE_ID).toBe(gate);
        expect(resolve?.run).toContain("scripts/lisa-gates.mjs");
        // The moment itself is asserted in quality-gate-moment-input.test.ts;
        // here it only has to reach the resolver.
        expect(resolve?.run).toContain("--moment=");
      }
    );

    it.each(CONVERTED)(
      "$job runs the project's task when $gate is configured",
      ({ job, gateStep }) => {
        const step = stepNamed(job, gateStep);
        expect(step).toBeDefined();
        expect(step?.if).toContain(CONFIGURED);
      }
    );

    it.each(CONVERTED)(
      "$job passes the resolved command through env, never interpolated into the shell",
      ({ job, gateStep }) => {
        const step = stepNamed(job, gateStep);
        expect(step?.env?.GATE_RUNNER).toBe("${{ steps.gate.outputs.runner }}");
        expect(step?.env?.GATE_TASK).toBe("${{ steps.gate.outputs.task }}");
        // The whole body, not a substring: the resolved command must never be
        // interpolated into the YAML, where a PR-editable value would become
        // workflow source rather than an argument.
        expect(step?.run?.trim()).toBe("$GATE_RUNNER $GATE_TASK");
      }
    );

    it.each(CONVERTED)(
      "$job falls back only when NO resolver exists anywhere",
      ({ job }) => {
        // It previously gave up the moment the COPIED resolver was missing,
        // which made every declaration unreadable for a project carrying only
        // the installed package — the direction the copies are being retired
        // in. So `off` stopped working precisely where it will soon be the
        // only shape.
        const body = resolveStep(job)?.run ?? "";
        expect(body).toContain(
          "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs"
        );
        expect(body).toContain(
          'if [ -z "$RESOLVER" ]; then echo "configured=false" >> "$GITHUB_OUTPUT"; exit 0; fi'
        );
      }
    );

    it.each(CONVERTED)(
      "$job prefers the installed package over a copy in the project",
      ({ job }) => {
        const body = resolveStep(job)?.run ?? "";
        expect(body.indexOf("node_modules/@codyswann/lisa")).toBeLessThan(
          body.indexOf('"scripts/lisa-gates.mjs"')
        );
      }
    );

    it.each(CONVERTED)(
      "$job refuses a $gate task or runner that is not a plain word",
      ({ job }) => {
        const resolve = resolveStep(job);
        expect(resolve?.run).toContain("const plain = value =>");
        expect(resolve?.run).toContain("is not a plain command");
      }
    );

    it("resolves every gate with one byte-identical block, differing only in GATE_ID", () => {
      // One copy per converted job exists because the single-copy alternative — a resolver job
      // read through `needs:` — leaves dependents SKIPPED when it fails, and a
      // skipped required check counts as satisfied. Copies that cannot be
      // deduplicated must instead be prevented from drifting, so this compares
      // them as text with the gate id normalised away.
      const normalised = CONVERTED.map(({ job, gate }) =>
        (resolveStep(job)?.run ?? "").split(gate).join("<GATE>")
      );
      const [first, ...rest] = normalised;
      expect(first).not.toBe("");
      for (const body of rest) {
        expect(body).toBe(first);
      }
    });

    it("differs between resolve blocks only in the GATE_ID env value", () => {
      const shapes = CONVERTED.map(({ job }) => {
        const { GATE_ID: _ignored, ...others } = (resolveStep(job)?.env ??
          {}) as Record<string, unknown>;
        return JSON.stringify(others);
      });
      expect(new Set(shapes).size).toBe(1);
    });

    it.each(CONVERTED)(
      "$job never swallows a resolution failure into a silent fallback",
      ({ job }) => {
        // A discarded stderr turns "the config is malformed" into "no gate is
        // configured", which reads as a measured zero and falls back to
        // tooling the project may have deliberately replaced.
        expect(resolveStep(job)?.run).not.toContain("2>/dev/null");
        expect(resolveStep(job)?.run).toContain("set -euo pipefail");
      }
    );
  });

  describe("the fallback path survives for every converted job", () => {
    it.each(CONVERTED)(
      "$job keeps its hardcoded invocation, gated on no $gate being configured",
      ({ job, fallbackSteps }) => {
        // Named rather than counted: a failure has to say WHICH fallback step
        // went missing, and `expect(actual, message)` is a vitest-only
        // two-argument form that @types/jest — which is installed here —
        // rejects, so the diagnostic goes in the assertion instead.
        const survivors = fallbackSteps.filter(
          name => stepNamed(job, name)?.if?.includes(NOT_CONFIGURED) === true
        );
        expect(survivors).toEqual([...fallbackSteps]);
      }
    );

    it.each(CONVERTED)(
      "$job falls back to the caller's package manager when no runner is declared",
      ({ job }) => {
        const resolve = resolveStep(job);
        expect(resolve?.env?.FALLBACK_RUNNER).toBe(
          "${{ inputs.package_manager }} run"
        );
        expect(resolve?.run).toContain('echo "configured=false"');
      }
    );

    it("keeps the oxlint hard-fail, but only on the fallback path", () => {
      const verify = stepNamed("lint", "🦀 Verify oxlint is installed");
      expect(verify?.run).toContain("oxlint is required but not installed");
      expect(verify?.if).toBe(NOT_CONFIGURED);
    });

    it.each(["🏗️ Run the build-integrity gate", "🏗️ Build project"])(
      "keeps the build cache-hit guard parenthesised on %s",
      name => {
        // GitHub Actions binds && tighter than ||, so an unparenthesised
        // `A || B && C` would run the step on a cache hit.
        expect(stepNamed("build", name)?.if).toContain(
          "(inputs.cache_build != true || steps.build_cache.outputs.cache-hit != 'true')"
        );
      }
    );

    it.each([
      "🧰 Start coverage service containers",
      "🧪 Apply coverage environment",
    ])("leaves the unit-test environment step %s keyed off test:unit", name => {
      // Environment, not tooling. Deliberately NOT moved onto the gate: the
      // exact condition string is pinned in quality-workflow.test.ts, and
      // Lisa force-ships `test:unit` into every host package.json, so a
      // configured project still satisfies it.
      expect(stepNamed("test_unit", name)?.if).toBe(
        `steps.check_script.outputs.exists == 'true' && inputs.${name.includes("service") ? "coverage_services" : "coverage_env"} != ''`
      );
    });

    it("suppresses the ast-grep 'no config' warning when a structural-rules task is configured", () => {
      expect(
        stepNamed("sg_scan", "⏭️ AST Grep Skipped (no config)")?.if
      ).toContain(NOT_CONFIGURED);
    });
  });

  describe("nothing was made to report green while failing", () => {
    it.each(CONVERTED)("$job carries no continue-on-error", ({ job }) => {
      expect(
        (workflow.jobs[job] as Record<string, unknown>)["continue-on-error"]
      ).toBeUndefined();
      for (const step of stepsIn(job)) {
        expect(
          (step as Record<string, unknown>)["continue-on-error"]
        ).toBeUndefined();
      }
    });

    it("adds no continue-on-error anywhere in the workflow", () => {
      const found: string[] = [];
      for (const [job, definition] of Object.entries(workflow.jobs)) {
        if ((definition as Record<string, unknown>)["continue-on-error"]) {
          found.push(job);
        }
        for (const step of definition.steps ?? []) {
          if ((step as Record<string, unknown>)["continue-on-error"]) {
            found.push(step.name ?? job);
          }
        }
      }
      expect(found).toEqual(PREEXISTING_CONTINUE_ON_ERROR);
    });

    it.each(CONVERTED)(
      "$job's own condition stays independent of the gates block",
      ({ job }) => {
        // A required context that runs zero steps reports SATISFIED on GitHub.
        // The façade may change what a job RUNS; it may never change whether
        // the job runs, because that is the skip_jobs defect.
        expect(workflow.jobs[job].if ?? "").not.toContain("lisa.config");
        expect(workflow.jobs[job].if ?? "").not.toContain("gates");
      }
    );
  });

  describe("skip_jobs is documented as the unsafe route", () => {
    it("still accepts skip_jobs, because installed repositories pass it today", () => {
      expect(source).toContain("      skip_jobs:");
      // Every job that was skip_jobs-gated BEFORE the façade must still be, so
      // converting a job never silently removes a caller's existing escape.
      //
      // This is deliberately not "every façade job is skip_jobs-gated".
      // `verification_coverage` never was — it gates on `verify_enforced` and
      // the event being a pull_request — and adding skip_jobs to it in order
      // to satisfy a uniform assertion would GROW the surface this workstream
      // exists to retire. The invariant is "no escape was taken away", not
      // "every job has one".
      const notSkipGated = new Set(["verification_coverage"]);
      for (const { job } of CONVERTED) {
        if (notSkipGated.has(job)) {
          expect(workflow.jobs[job].if ?? "").not.toContain("inputs.skip_jobs");
          continue;
        }
        expect(workflow.jobs[job].if ?? "").toContain("inputs.skip_jobs");
      }
    });

    it("names the gates block as the safe replacement and says why", () => {
      expect(source).toContain("PREFER `gates` IN .lisa.config.json");
      expect(source).toContain("SKIPPED required status check as");
      expect(source).toContain("contextsFor");
    });
  });
});
