import { pathToFileURL } from "node:url";

import {
  CONFIGURED,
  CONVERTED,
  GATES_SCRIPT,
  NOT_CONFIGURED,
  PREEXISTING_CONTINUE_ON_ERROR,
  QUALITY_YML,
  WORKFLOW_FILES,
  jobIn,
  loadRegistry,
  resolveStep,
  source,
  stepNamed,
  stepsIn,
  workflowIn,
} from "./quality-gate-facade-fixture.js";
import type { GateDefinition } from "./quality-gate-facade-fixture.js";

/**
 * Everything in one workflow that carries `continue-on-error`.
 *
 * Jobs report by id and steps by name, which is what makes the pinned list
 * readable as "the SonarCloud scan, and nothing else".
 * @param file One of `WORKFLOW_FILES`.
 * @returns Job ids and step names, in file order.
 */
const continueOnErrorCarriers = (file: string): string[] =>
  Object.entries(workflowIn(file).jobs).flatMap(([job, definition]) => [
    ...((definition as Record<string, unknown>)["continue-on-error"]
      ? [job]
      : []),
    ...(definition.steps ?? [])
      .filter(step => (step as Record<string, unknown>)["continue-on-error"])
      .map(step => step.name ?? job),
  ]);

/**
 * The workflow name `contextsFor` prefixes a run gate's context with.
 *
 * A literal, matching the default in the shipped registry. Reading it from
 * there would make the assertion agree with whatever the registry says,
 * including a value no ruleset was ever written against.
 */
const WORKFLOW_NAME = "🔍 Quality Checks";

/** The moment `quality.yml` runs at, and the one a ruleset is derived for. */
const PULL_REQUEST = "pull-request";

let registry: Record<string, GateDefinition>;

beforeAll(async () => {
  registry = await loadRegistry();
});

describe("quality.yml gate façade", () => {
  describe("job names are unchanged", () => {
    it.each(CONVERTED)(
      "$job still declares the exact context name $jobName",
      ({ job, jobName, file }) => {
        expect((jobIn(job, file) as { name?: string }).name).toBe(jobName);
      }
    );

    it.each(CONVERTED)(
      "$job's name matches REGISTRY.$gate.label, so the derived required-context list still names it",
      ({ jobName, gate }) => {
        expect(registry[gate]?.label).toBe(jobName);
      }
    );

    it.each(CONVERTED)(
      "declaring $gate required derives a context $job actually posts",
      async ({ job, jobName, gate, file }) => {
        // The label assertion above compares two strings. This one runs the
        // derivation a ruleset is built from and compares its OUTPUT to the
        // job name, because that is the failure this whole family caused: a
        // derived context nothing ever posts is not a wrong string, it is a
        // pull request that can never merge.
        const loaded = (await import(pathToFileURL(GATES_SCRIPT).href)) as {
          contextsFor: (
            gates: unknown,
            options?: { moment?: string }
          ) => string[];
          REGISTRY: Record<string, { moments: string[] }>;
        };
        const moments = loaded.REGISTRY[gate]?.moments ?? [];
        // Pull-request where the gate is legal there, because that is the
        // moment `quality.yml` runs at. The few deploy-only gates fall back to
        // their first legal moment rather than being skipped: a context that
        // is only derived at pre-deploy still has to be one a job posts.
        const moment = moments.includes(PULL_REQUEST)
          ? PULL_REQUEST
          : (moments[0] ?? PULL_REQUEST);
        const derived = loaded.contextsFor(
          { [gate]: { [moment]: "required" } },
          { moment }
        );
        expect(derived).toContain(
          `${WORKFLOW_NAME} / ${(jobIn(job, file) as { name?: string }).name}`
        );
        expect(derived).toContain(`${WORKFLOW_NAME} / ${jobName}`);
      }
    );

    it.each(CONVERTED)(
      "$job is not a matrix, which would rewrite its context name",
      ({ job, file }) => {
        expect(
          (jobIn(job, file) as { strategy?: unknown }).strategy
        ).toBeUndefined();
      }
    );

    it("leaves every converted job id in place", () => {
      for (const { job, file } of CONVERTED) {
        expect(Object.keys(workflowIn(file).jobs)).toContain(job);
      }
    });
  });

  describe("each converted job resolves its gate from config", () => {
    it.each(CONVERTED)(
      "$job resolves $gate through the shipped registry script",
      ({ job, gate, file }) => {
        const resolve = resolveStep(job, file);
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
      ({ job, gateStep, file }) => {
        const step = stepNamed(job, gateStep, file);
        expect(step).toBeDefined();
        expect(step?.if).toContain(CONFIGURED);
      }
    );

    it.each(CONVERTED)(
      "$job passes the resolved command through env, never interpolated into the shell",
      ({ job, gateStep, file }) => {
        const step = stepNamed(job, gateStep, file);
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
      ({ job, file }) => {
        // It previously gave up the moment the COPIED resolver was missing,
        // which made every declaration unreadable for a project carrying only
        // the installed package — the direction the copies are being retired
        // in. So `off` stopped working precisely where it will soon be the
        // only shape.
        const body = resolveStep(job, file)?.run ?? "";
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
      ({ job, file }) => {
        const body = resolveStep(job, file)?.run ?? "";
        expect(body.indexOf("node_modules/@codyswann/lisa")).toBeLessThan(
          body.indexOf('"scripts/lisa-gates.mjs"')
        );
      }
    );

    it.each(CONVERTED)(
      "$job refuses a $gate task or runner that is not a plain word",
      ({ job, file }) => {
        // Presence only. What these validators actually REJECT is proven by
        // executing the block against fixture configs in
        // quality-gate-runner-validation.test.ts — a text assertion alone
        // passed for the whole period `gates.runner: ":"` silenced every gate.
        const resolve = resolveStep(job, file);
        expect(resolve?.run).toContain("const plain = (value, pattern) =>");
        expect(resolve?.run).toContain("is not a plain word");
        // The type check must PRECEDE the pattern, because `test` coerces.
        expect(resolve?.run).toContain('typeof value === "string" &&');
        // Two classes, not one: a task may carry a colon, a runner may not.
        expect(resolve?.run).toContain("/^[A-Za-z0-9:._@\\/= -]+$/");
        expect(resolve?.run).toContain("/^[A-Za-z0-9._@\\/= -]+$/");
        expect(resolve?.run).toContain("is not a task runner");
      }
    );

    it("resolves every gate with one byte-identical block, differing only in GATE_ID", () => {
      // One copy per converted job exists because the single-copy alternative — a resolver job
      // read through `needs:` — leaves dependents SKIPPED when it fails, and a
      // skipped required check counts as satisfied. Copies that cannot be
      // deduplicated must instead be prevented from drifting, so this compares
      // them as text with the gate id normalised away.
      const normalised = CONVERTED.map(({ job, gate, file }) =>
        (resolveStep(job, file)?.run ?? "").split(gate).join("<GATE>")
      );
      const [first, ...rest] = normalised;
      expect(first).not.toBe("");
      for (const body of rest) {
        expect(body).toBe(first);
      }
    });

    it("differs between resolve blocks only in the GATE_ID env value", () => {
      const shapes = CONVERTED.map(({ job, file }) => {
        const { GATE_ID: _ignored, ...others } = (resolveStep(job, file)?.env ??
          {}) as Record<string, unknown>;
        return JSON.stringify(others);
      });
      expect(new Set(shapes).size).toBe(1);
    });

    it.each(CONVERTED)(
      "$job never swallows a resolution failure into a silent fallback",
      ({ job, file }) => {
        // A discarded stderr turns "the config is malformed" into "no gate is
        // configured", which reads as a measured zero and falls back to
        // tooling the project may have deliberately replaced.
        expect(resolveStep(job, file)?.run).not.toContain("2>/dev/null");
        expect(resolveStep(job, file)?.run).toContain("set -euo pipefail");
      }
    );
  });

  describe("the fallback path survives for every converted job", () => {
    it.each(CONVERTED)(
      "$job keeps its hardcoded invocation, gated on no $gate being configured",
      ({ job, fallbackSteps, file }) => {
        // Named rather than counted: a failure has to say WHICH fallback step
        // went missing, and `expect(actual, message)` is a vitest-only
        // two-argument form that @types/jest — which is installed here —
        // rejects, so the diagnostic goes in the assertion instead.
        const survivors = fallbackSteps.filter(
          name =>
            stepNamed(job, name, file)?.if?.includes(NOT_CONFIGURED) === true
        );
        expect(survivors).toEqual([...fallbackSteps]);
      }
    );

    it.each(CONVERTED)(
      "$job falls back to the caller's package manager when no runner is declared",
      ({ job, file }) => {
        const resolve = resolveStep(job, file);
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
    it.each(CONVERTED)("$job carries no continue-on-error", ({ job, file }) => {
      expect(
        (jobIn(job, file) as Record<string, unknown>)["continue-on-error"]
      ).toBeUndefined();
      for (const step of stepsIn(job, file)) {
        // The one pre-existing carrier stays exempt HERE and only here. It is
        // still pinned by name in the whole-file assertion below, so the
        // exemption cannot grow: a second carrier fails that test even though
        // it would pass this one.
        if (PREEXISTING_CONTINUE_ON_ERROR.includes(step.name ?? "")) continue;
        expect(
          (step as Record<string, unknown>)["continue-on-error"]
        ).toBeUndefined();
      }
    });

    it.each(CONVERTED)(
      "$job never lets the DECLARED path continue on error",
      ({ job, file }) => {
        // The sharper half of the rule, and the reason the exemption above is
        // survivable. A pre-existing carrier on the fallback path is behaviour
        // this conversion deliberately did not change; the same step on the
        // declared path would mean a project that said `required` inherited a
        // step that can go green having analysed nothing. `📊 SonarCloud Scan`
        // is exactly that step, which is why it is asserted rather than
        // assumed to have stayed put.
        const declared = stepsIn(job, file).filter(step =>
          String((step as Record<string, unknown>)["if"] ?? "").includes(
            CONFIGURED
          )
        );
        expect(declared.length).toBeGreaterThan(0);
        for (const step of declared) {
          expect(
            (step as Record<string, unknown>)["continue-on-error"],
            `${step.name ?? job} runs on the declared path and may not continue on error`
          ).toBeUndefined();
        }
      }
    );

    it("adds no continue-on-error anywhere in either workflow", () => {
      // Both files, not just `quality.yml`. The set is pinned rather than
      // checked per converted job precisely so that it catches growth in jobs
      // this fixture does not list — and the sharded matrix that implements
      // the browser fallback is now such a job, in the other file.
      expect(WORKFLOW_FILES.flatMap(continueOnErrorCarriers)).toEqual(
        PREEXISTING_CONTINUE_ON_ERROR
      );
    });

    it.each(CONVERTED)(
      "$job's own condition stays independent of the gates block",
      ({ job, file }) => {
        // A required context that runs zero steps reports SATISFIED on GitHub.
        // The façade may change what a job RUNS; it may never change whether
        // the job runs, because that is the skip_jobs defect.
        expect(jobIn(job, file).if ?? "").not.toContain("lisa.config");
        expect(jobIn(job, file).if ?? "").not.toContain("gates");
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
      // `performance_budget` joins for the same reason and not by exception:
      // it is a NEW job, so no caller ever had a skip_jobs escape for it to
      // lose. Giving it one to satisfy a uniform assertion is exactly the
      // growth this invariant forbids. It is declined by declaring the gate
      // `off`, which empties the job rather than skipping it.
      const notSkipGated = new Set([
        "verification_coverage",
        "performance_budget",
      ]);
      for (const { job, file } of CONVERTED) {
        if (file !== QUALITY_YML) {
          // A job that left `quality.yml` did not lose an escape a caller of
          // `quality.yml` still has — the job is not there to skip. Its new
          // workflow declares no `skip_jobs` at all, which is the point of it:
          // a single-suite caller selects the suite by calling the workflow
          // rather than by naming the two dozen jobs it does not want. Proved
          // here rather than assumed, so this branch cannot become a silent
          // pass for a job that moved and kept a stale gate.
          expect(
            Object.keys(workflowIn(file).on?.workflow_call?.inputs ?? {})
          ).not.toContain("skip_jobs");
          continue;
        }
        if (notSkipGated.has(job)) {
          expect(jobIn(job, file).if ?? "").not.toContain("inputs.skip_jobs");
          continue;
        }
        expect(jobIn(job, file).if ?? "").toContain("inputs.skip_jobs");
      }
    });

    it("names the gates block as the safe replacement and says why", () => {
      expect(source).toContain("PREFER `gates` IN .lisa.config.json");
      expect(source).toContain("SKIPPED required status check as");
      expect(source).toContain("contextsFor");
    });
  });
});
