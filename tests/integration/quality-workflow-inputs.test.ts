/**
 * quality.yml reusable-workflow contract: template skip_jobs defaults, newer
 * optional inputs, the opt-in concurrency mutex, and coverage-job inputs.
 * Sibling of quality-workflow.test.ts.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";

import { RETIRED_SKIP_JOB_TOKENS } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { jobOf } from "../helpers/workflow-job-graph.js";
import {
  QUALITY_YML,
  NESTJS_CI_YML,
  EXPO_CI_YML,
  type QualityWorkflow,
} from "./quality-workflow-fixtures.js";

describe("quality.yml reusable workflow", () => {
  let workflow: QualityWorkflow;

  beforeAll(() => {
    workflow = yaml.load(
      fs.readFileSync(QUALITY_YML, "utf8")
    ) as QualityWorkflow;
  });

  describe("template skip_jobs defaults", () => {
    // Test hardened to kill mutant M003 (Risk Factor: Release confidence / promotion branch test coverage).
    it("keeps promotion-branch test jobs enabled in JS templates", () => {
      for (const file of [NESTJS_CI_YML, EXPO_CI_YML]) {
        const ci = yaml.load(fs.readFileSync(file, "utf8")) as QualityWorkflow;
        expect(ci.jobs.quality?.with?.skip_jobs).toBe(
          "test:e2e,playwright_e2e"
        );
      }
    });

    it("passes no token the workflow has retired", () => {
      // A caller carrying a retired token is not merely untidy: the token
      // silences nothing, so it reads as an off-switch that still works.
      // CodySwannGT/lisa#2938 retired `zap_baseline` when the pull-request ZAP
      // job was deleted, and these two templates were the only shipped callers
      // passing it.
      for (const file of [NESTJS_CI_YML, EXPO_CI_YML]) {
        const ci = yaml.load(fs.readFileSync(file, "utf8")) as QualityWorkflow;
        const tokens = String(ci.jobs.quality?.with?.skip_jobs ?? "").split(
          ","
        );
        const retired = tokens.filter(token =>
          Object.hasOwn(RETIRED_SKIP_JOB_TOKENS, token)
        );
        expect(retired).toEqual([]);
      }
    });
  });

  describe("SE-4551 + SE-4552 new inputs", () => {
    // The two Playwright inputs are INERT here — the suite they configured
    // moved to `playwright-e2e.yml`, which declares its own copies. What they
    // still have to be is DECLARED. A caller that passes an input a reusable
    // workflow does not declare is a `startup_failure` for its ENTIRE run,
    // decided before any `if:` is evaluated, and installed callers pass both
    // today. So deleting them would break every one of them at once, on a
    // change that is otherwise invisible to them.
    //
    // Their live behaviour is asserted against the workflow that now owns it,
    // in `playwright-e2e-workflow.test.ts`. Asserting a default here would
    // describe a value nothing reads.
    it.each(["playwright_setup_command", "playwright_shards"])(
      "keeps %s declared and optional, so installed callers still start",
      name => {
        const input = workflow.on.workflow_call?.inputs?.[name];
        expect(input).toBeDefined();
        expect(input?.required).toBe(false);
        // Says so in the description, because the only way a caller finds out
        // an input stopped doing anything is by being told.
        expect(input?.description).toContain("INERT");
      }
    );

    // `cache_build` configured the hand-written `build` job, which #3052
    // deleted: the build now runs as the build-integrity gate's declared leg,
    // and a leg always builds. Still DECLARED for the same reason as the two
    // Playwright inputs above — installed callers pass it, and an undeclared
    // input is a startup_failure for the caller's whole run.
    it("keeps cache_build declared and optional, and says it is inert", () => {
      const input = workflow.on.workflow_call?.inputs?.cache_build;
      expect(input).toBeDefined();
      expect(input?.required).toBe(false);
      expect(input?.default).toBe(false);
      expect(input?.type).toBe("boolean");
      expect(input?.description).toContain("INERT");
    });

    it("no longer computes a build cache key anywhere in quality.yml", () => {
      // The fingerprint and cache steps went with the job. Their regression
      // guards for #2418 (unanchored hashFiles globs) live on in
      // `playwright-e2e-workflow.test.ts`, which still carries a build cache.
      const steps = Object.values(workflow.jobs).flatMap(
        job => job.steps ?? []
      );
      expect(
        steps.filter(
          step => step.id === "build_fingerprint" || step.id === "build_cache"
        )
      ).toEqual([]);
    });
  });

  describe("cross-run concurrency mutex (opt-in)", () => {
    it("declares concurrency_group input defaulting to '' (no serialization)", () => {
      const input = workflow.on.workflow_call?.inputs?.concurrency_group;
      expect(input).toBeDefined();
      expect(input?.required).toBe(false);
      expect(input?.default).toBe("");
      expect(input?.type).toBe("string");
    });

    it("sets a top-level concurrency that queues rather than cancels", () => {
      // cancel-in-progress must be false so opted-in runs queue (serialize)
      // instead of cancelling each other — cancelling mid-run is what leaves
      // shared external state (e.g. a test user's server-side org) dirty.
      expect(workflow.concurrency).toBeDefined();
      expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
    });

    it("falls back to a per-run unique group when the input is unset", () => {
      // Default behavior must be identical to having no concurrency: when
      // concurrency_group is empty the group resolves to a github.run_id-keyed
      // string, so no run ever waits on another (and no parent/child deadlock).
      const group = workflow.concurrency?.group ?? "";
      expect(group).toContain("inputs.concurrency_group");
      expect(group).toContain("github.run_id");
    });
  });

  describe("verification coverage labels", () => {
    it("passes event labels to the coverage script without live GitHub context", () => {
      const job = jobOf(workflow, "verification_coverage");
      // This job used to inherit the workflow-level floor (#1769); that floor is
      // now written onto each job directly, because as a workflow-level block it
      // also zeroed the scopes it omitted for work_item_traceability. The scope
      // this job resolves to is unchanged — assert it where it now lives.
      //
      // What must never change is that it gains no `pull-requests` scope: the
      // gate reads PR labels from the event payload, not the API.
      expect(job.permissions).toEqual({ contents: "read" });
      expect(job.permissions?.["pull-requests"]).toBeUndefined();

      const steps = job.steps ?? [];
      const check = steps.find(s =>
        s.run?.includes("check-verification-coverage.mjs")
      );
      expect(check).toBeDefined();
      expect(check?.env?.VERIFY_PR_NUMBER).toBeUndefined();
      expect(check?.env?.VERIFY_GITHUB_REPOSITORY).toBeUndefined();
      expect(check?.env?.VERIFY_GITHUB_TOKEN).toBeUndefined();
      expect(check?.env?.VERIFY_LABELS).toContain(
        "github.event.pull_request.labels"
      );
    });
  });

  describe("coverage job service inputs", () => {
    it("declares inert coverage service and env inputs", () => {
      const inputs = workflow.on.workflow_call?.inputs ?? {};

      expect(inputs.coverage_services).toEqual({
        description:
          "Optional JSON service-container spec for the coverage job. Empty string preserves prior behavior. Accepts an object map or array with image plus optional name, ports, env, options, and healthTimeoutSeconds.",
        required: false,
        default: "",
        type: "string",
      });
      expect(inputs.coverage_env).toEqual({
        description:
          "Optional JSON object of extra environment variables scoped to the coverage job before test:cov. Empty string preserves prior behavior.",
        required: false,
        default: "",
        type: "string",
      });
    });

    it("starts optional service containers and applies env before coverage", () => {
      const steps = jobOf(workflow, "test_unit").steps ?? [];
      const checkIndex = steps.findIndex(step => step.id === "check_script");
      const serviceIndex = steps.findIndex(
        step => step.name === "🧰 Start coverage service containers"
      );
      const envIndex = steps.findIndex(
        step => step.name === "🧪 Apply coverage environment"
      );
      const coverageIndex = steps.findIndex(
        step => step.name === "🧪 Run unit tests with coverage"
      );

      expect(checkIndex).toBeGreaterThanOrEqual(0);
      expect(serviceIndex).toBeGreaterThan(checkIndex);
      expect(envIndex).toBeGreaterThan(serviceIndex);
      expect(coverageIndex).toBeGreaterThan(envIndex);

      const serviceStep = steps[serviceIndex];
      expect(serviceStep?.if).toBe(
        "steps.check_script.outputs.exists == 'true' && inputs.coverage_services != ''"
      );
      expect(serviceStep?.env?.COVERAGE_SERVICES).toBe(
        "${{ inputs.coverage_services }}"
      );
      expect(serviceStep?.run).toContain("docker rm -f");
      expect(serviceStep?.run).toContain("docker inspect");
      expect(serviceStep?.run).toContain(
        "options must be an array of docker flags"
      );
      expect(serviceStep?.run).toContain(
        "Math.trunc(Number(service.healthTimeoutSeconds ?? 60))"
      );
      expect(serviceStep?.run).not.toContain("optionSuffix");

      const envStep = steps[envIndex];
      expect(envStep?.if).toBe(
        "steps.check_script.outputs.exists == 'true' && inputs.coverage_env != ''"
      );
      expect(envStep?.env?.COVERAGE_ENV).toBe("${{ inputs.coverage_env }}");
      expect(envStep?.run).toContain(
        'const { randomUUID } = require("node:crypto");'
      );
      expect(envStep?.run).toContain("randomUUID().replace");
      expect(envStep?.run).toContain("JSON.stringify(value)");
      expect(envStep?.run).not.toContain('lines.push("LISA_COVERAGE_ENV")');
      expect(envStep?.run).toContain(
        "fs.appendFileSync(process.env.GITHUB_ENV"
      );
    });
  });
});
