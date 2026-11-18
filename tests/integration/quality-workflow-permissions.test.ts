/**
 * quality.yml reusable-workflow contract: retained release artifacts, e2e route
 * coverage dependencies, least-privilege permissions, cross-repo token and
 * approval handling, GitGuardian quota exhaustion, and audit delivery.
 * Sibling of quality-workflow.test.ts.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";

import { RETAINED_RELEASES } from "../../scripts/generate-nightly-e2e-guard-certificate.mjs";
import { jobOf } from "../helpers/workflow-job-graph.js";
import {
  PACKAGE_MANAGER_INPUT,
  QUALITY_YML,
  QUALITY_RAILS_YML,
  type QualityWorkflow,
} from "./quality-workflow-fixtures.js";

describe("quality.yml reusable workflow", () => {
  let workflow: QualityWorkflow;

  beforeAll(() => {
    workflow = yaml.load(
      fs.readFileSync(QUALITY_YML, "utf8")
    ) as QualityWorkflow;
  });

  describe("retained release artifact inputs", () => {
    it("derives exact scoped fetches from the certificate generator authority", () => {
      const retainedRefspecs = RETAINED_RELEASES.map(
        ref => `refs/tags/${ref}:refs/tags/${ref}`
      );
      for (const jobId of ["declared_gates", "test_unit"]) {
        const checkout = workflow.jobs[jobId]?.steps?.find(
          step => step.uses === "actions/checkout@v6"
        );
        expect(checkout, `${jobId} checkout`).toBeDefined();
        expect(checkout?.with?.["fetch-tags"], `${jobId} all tags`).toBeFalsy();
        const fetch = workflow.jobs[jobId]?.steps?.find(
          step => step.name === "📎 Fetch retained nightly guard release tags"
        );
        const actualRefspecs = [
          ...(fetch?.run ?? "").matchAll(
            /refs\/tags\/v[^\s:]+:refs\/tags\/v[^\s\\]+/gu
          ),
        ].map(match => match[0]);
        expect(actualRefspecs, `${jobId} retained refs`).toEqual(
          retainedRefspecs
        );
        expect(fetch?.if, `${jobId} caller scope`).toContain(
          "github.repository == 'CodySwannGT/lisa'"
        );
        expect(fetch?.env?.GH_TOKEN, `${jobId} step token`).toBe(
          "${{ github.token }}"
        );
        expect(fetch?.run, `${jobId} artifact scope`).toContain(
          "scripts/generate-nightly-e2e-guard-certificate.mjs"
        );
        expect(fetch?.run, `${jobId} ephemeral authentication`).toContain(
          "credential.helper"
        );
        expect(fetch?.run, `${jobId} retained tag fetch`).not.toContain(
          "refs/tags/*"
        );
      }
    });

    it("fetches export-removal ancestry and exact witnesses for Lisa unit tests", () => {
      const steps = workflow.jobs.test_unit?.steps ?? [];
      const fetch = steps.find(
        step => step.name === "📎 Fetch export-removal witness history"
      );

      expect(fetch).toBeDefined();
      expect(fetch?.if).toContain("github.repository == 'CodySwannGT/lisa'");
      expect(fetch?.env?.GH_TOKEN).toBe("${{ github.token }}");
      expect(fetch?.run).toContain("credential.helper");
      expect(fetch?.run).toContain(
        "--deepen=2147483647 --filter=blob:none --no-tags"
      );
      expect(fetch?.run).toContain(
        '"+${GITHUB_SHA}:refs/lisa-test-witnesses/export-head"'
      );
      expect(fetch?.run).toContain("refs/tags/v3.0.0:refs/tags/v3.0.0");
      expect(fetch?.run).toContain("refs/tags/v4.0.0:refs/tags/v4.0.0");
      expect(fetch?.run).toContain(
        "c32f33010f5e58879381b0d4c370c630bb179acc:refs/lisa-test-witnesses/export-before"
      );
      expect(fetch?.run).toContain(
        "f13bb00ec73e0ebbb2dfd9f030164d2913dcf98d:refs/lisa-test-witnesses/export-after"
      );
      expect(fetch?.run).not.toContain("fetch-depth: 0");
    });
  });

  describe("e2e route coverage dependencies", () => {
    it("installs host dependencies after detection and before route analysis", () => {
      const steps = jobOf(workflow, "e2e_coverage").steps ?? [];
      const checkIndex = steps.findIndex(step => step.id === "check_script");
      const bunIndex = steps.findIndex(step => step.name === "🍞 Setup Bun");
      const installIndex = steps.findIndex(
        step => step.name === "📦 Install dependencies"
      );
      const requireIndex = steps.findIndex(
        step => step.name === "🧭 Require e2e route/screen coverage thresholds"
      );

      expect(checkIndex).toBeGreaterThanOrEqual(0);
      expect(bunIndex).toBeGreaterThan(checkIndex);
      expect(installIndex).toBeGreaterThan(bunIndex);
      expect(requireIndex).toBeGreaterThan(installIndex);

      const setupBun = steps[bunIndex];
      expect(setupBun?.if).toContain(
        "steps.check_script.outputs.exists == 'true'"
      );
      expect(setupBun?.if).toContain("inputs.package_manager == 'bun'");

      const gateIndex = steps.findIndex(step => step.id === "gate");
      const gateRunIndex = steps.findIndex(
        step => step.name === "🧭 Run the journey-coverage gate"
      );
      // The gate resolves BEFORE the probe and both proving steps run after
      // the install, because either of them may need the project's
      // dependencies.
      expect(gateIndex).toBeGreaterThanOrEqual(0);
      expect(gateIndex).toBeLessThan(checkIndex);
      expect(gateRunIndex).toBeGreaterThan(installIndex);

      const install = steps[installIndex];
      // Both disjuncts, as one exact string. The gate arm is load-bearing: a
      // project that declared `journey-coverage` with its own task and has no
      // shipped script would otherwise run that task against a tree with no
      // node_modules.
      expect(install?.if).toBe(
        "steps.check_script.outputs.exists == 'true' || steps.gate.outputs.configured == 'true'"
      );
      expect(install?.env?.PACKAGE_MANAGER).toBe(PACKAGE_MANAGER_INPUT);
      expect(install?.run).not.toContain(PACKAGE_MANAGER_INPUT);
      expect(install?.run).toMatch(
        /case\s+"\$PACKAGE_MANAGER"\s+in[\s\S]*npm\)\s*npm ci/
      );
      // Fail closed: anything outside the allowlist stops the job before a
      // command position is reached (#3793).
      expect(install?.run).toContain(
        "package_manager must be one of npm, yarn, pnpm, bun"
      );
      expect(install?.run).toContain("yarn install --frozen-lockfile");
      expect(install?.run).toContain("bun install --frozen-lockfile");
      expect(install?.["working-directory"]).toBe(
        "${{ inputs.working_directory || '.' }}"
      );
    });
  });

  describe("least-privilege permissions floor", () => {
    it("declares NO workflow-level floor, because a floor is really a ceiling", () => {
      // Reverses #1769, which assumed a workflow-level block only *caps* callers
      // that grant too much. It does the opposite as well: it sets every scope it
      // OMITS to `none` for every job declaring none of its own. `contents: read`
      // here therefore capped work_item_traceability at contents+metadata no
      // matter what the caller granted.
      //
      // Measured 2026-08-14: AcmeOrgA/backend and acmeorgb/backend-v2
      // both granted contents/issues/pull-requests read on the calling job and
      // both received `Contents: read, Metadata: read`. The gate reported
      // "could verify NOTHING" and named the caller — which was already correct.
      //
      // The fix cannot be to add the scopes here. A called workflow requesting a
      // scope the caller never held is a startup_failure for the caller's ENTIRE
      // run (#2046, #2566), and these workflows are consumed @main by repos whose
      // ci.yml is create-only. So the old floor moved down onto every job that
      // relied on it, byte-for-byte, and only work_item_traceability is left
      // blank — the one job that must inherit the caller's grant.
      expect(workflow.permissions).toBeUndefined();
    });

    it("keeps the old floor on every job that used to inherit it", () => {
      // The floor-move must not have widened anything. Every job except the one
      // deliberate blank carries an explicit block, so a job added later cannot
      // silently inherit the caller's full grant.
      const blank = Object.entries(workflow.jobs)
        .filter(([, job]) => job.permissions === undefined)
        .map(([name]) => name);
      expect(blank).toEqual(["work_item_traceability"]);

      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (jobName === "work_item_traceability") {
          continue;
        }
        // Either the moved floor, or a stricter block the job already declared.
        const scopes = job.permissions ?? {};
        expect(
          scopes.contents === "read" || Object.keys(scopes).length === 0,
          `${jobName} lost or widened the moved floor: ${JSON.stringify(scopes)}`
        ).toBe(true);
      }
    });

    it("gives summary-only jobs an empty permissions block", () => {
      // These jobs neither check out the repository nor call the API.
      // `playwright_e2e_setup` left this list with the job: it moved to
      // `playwright-e2e.yml`, where the same assertion is made against it.
      // Leaving it here would have read `undefined?.permissions` and compared
      // it to `{}` — a failing assertion, and had it been written with `??`
      // it would have been a passing one about a job that is not there.
      for (const jobName of [
        "security_tools_summary",
        "compliance_validation",
        "performance_summary",
      ]) {
        expect(workflow.jobs[jobName]?.permissions, jobName).toEqual({});
      }
    });

    it("resolves every job to a scope with no write access", () => {
      // Effective scope = job-level block when present, otherwise the
      // workflow-level floor. An audit of all jobs found zero uses of `gh`,
      // `github.rest.*`, `GITHUB_TOKEN`, or `github.token`, so no job needs a
      // write scope. This assertion catches a future job silently regressing
      // the floor by declaring one.
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        const effective = job.permissions ?? workflow.permissions ?? {};
        const writeScopes = Object.entries(effective)
          .filter(([, value]) => value === "write")
          .map(([scope]) => scope);
        expect(writeScopes, `${jobName} must not hold a write scope`).toEqual(
          []
        );
      }
    });

    it("checks out without persisting the git credential", () => {
      // A persisted credential outlives the checkout step and is readable by
      // every later step (and any compromised third-party action) in the job.
      // No job in this workflow reuses the checkout credential.
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          if (!step.uses?.startsWith("actions/checkout@")) {
            continue;
          }

          expect(step.with?.["persist-credentials"], jobName).toBe(false);
        }
      }
    });
  });

  describe("cross-repo reusable workflow token handling", () => {
    it("does not declare reserved GITHUB_* environment keys", () => {
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          const envKeys = Object.keys(step.env ?? {});
          const reservedKeys = envKeys.filter(key => key.startsWith("GITHUB_"));
          expect(reservedKeys, `${jobName}: ${step.name ?? step.id}`).toEqual(
            []
          );
        }
      }
    });

    it("passes only SonarCloud's token to the SonarCloud action", () => {
      const steps = jobOf(workflow, "sonarcloud").steps ?? [];
      const scan = steps.find(
        s =>
          s.uses ===
          // The pinned SHA for v6.0.0 (#3585); the version lives in a trailing
          // YAML comment, which the parser strips before this comparison.
          "SonarSource/sonarqube-scan-action@fd88b7d7ccbaefd23d8f36f73b59db7a3d246602"
      );

      expect(scan).toBeDefined();
      expect(scan?.env?.SONAR_TOKEN).toBe("${{ secrets.SONAR_TOKEN }}");
      expect(scan?.env).not.toHaveProperty("GITHUB_TOKEN");
    });
  });

  describe("cross-repo reusable workflow approval gate", () => {
    it("does not bind a dynamic environment in the optional approval job", () => {
      expect(jobOf(workflow, "approval_gate").environment).toBeUndefined();
    });
  });

  describe("GitGuardian quota exhaustion", () => {
    it.each([
      ["quality.yml", QUALITY_YML],
      ["quality-rails.yml", QUALITY_RAILS_YML],
    ])("%s soft-fails only quota exhaustion", (_label, workflowPath) => {
      const raw = fs.readFileSync(workflowPath, "utf8");
      const parsed = yaml.load(raw) as QualityWorkflow;
      const steps = jobOf(parsed, "secret_scanning").steps ?? [];
      const scan = steps.find(s => s.name === "🔐 GitGuardian scan");

      expect(scan).toBeDefined();
      expect(scan?.uses).toBeUndefined();
      expect(scan?.run).toContain("ggshield secret scan ci");
      expect(scan?.run).not.toContain("--show-secrets");
      expect(scan?.run).not.toContain("--all-policies");
      expect(scan?.run).toContain("no more API calls available");
      expect(scan?.run).toContain('exit "$scan_status"');
    });
  });

  describe("canonical audit workflow delivery", () => {
    it("runs an immutable workflow-owned audit without requiring a newly applied caller adapter", () => {
      const steps = jobOf(workflow, "npm_security_scan").steps ?? [];
      const audit = steps.find(s => s.name === "🔒 Run security audit");
      expect(audit?.uses).toMatch(
        /^CodySwannGT\/lisa\/\.github\/actions\/dependency-audit@[0-9a-f]{40}$/u
      );
      expect(audit?.run).toBeUndefined();
      expect(audit?.with).toEqual({
        "package-manager": PACKAGE_MANAGER_INPUT,
        "working-directory": "${{ inputs.working_directory || '.' }}",
      });
    });
  });
});
