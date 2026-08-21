/**
 * `🐢 Slow Lint Rules` and `🗑️ Dead Code Detection` must gate a merge, not just
 * a push (issue #2861, item 4 of #2829).
 *
 * Both gates were declared `"push": "required"` in `.lisa.config.json` and
 * required by nothing at merge. The cost landed on every developer — ~33s and
 * ~30s on each push — and bought no guarantee: a push from CI, or from any
 * runtime where the pre-push hook is absent, skipped both and merged anyway.
 *
 * Promoting a job to a required context is only safe when the job cannot be
 * SKIPPED, because a context that never reports blocks every pull request
 * forever (#2496, #2843). Both jobs carry exactly one job-level condition — the
 * `skip_jobs` token — and no shipped caller passes either token. This suite
 * pins all of it, so removing the contexts, renaming a job, filtering the
 * caller workflow, or teaching a template caller to skip one of these jobs
 * fails by name rather than silently un-gating the merge.
 *
 * @module tests/unit/scripts/slow-lint-dead-code-enforcement
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readWorkflow } from "../../../scripts/check-required-check-promotions.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

const TYPESCRIPT_RULESET = "typescript/github-rulesets/quality-checks.json";
const LEDGER = ".github/required-check-promotions.json";
const QUALITY_WORKFLOW = ".github/workflows/quality.yml";
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** Integration id GitHub Actions posts status checks under. */
const ACTIONS_INTEGRATION_ID = 15_368;

/**
 * The two gates this suite promotes, each with the job that reports it.
 *
 * Kept as one table because every assertion below has to agree on the exact
 * spelling: the context string, the job id, and the job's `name:` are three
 * copies of the same fact, and a promotion survives only while all three match.
 */
const PROMOTED = [
  {
    jobId: "lint_slow",
    jobName: "🐢 Slow Lint Rules",
    context: "🔍 Quality Checks / 🐢 Slow Lint Rules",
  },
  {
    jobId: "dead_code",
    jobName: "🗑️ Dead Code Detection",
    context: "🔍 Quality Checks / 🗑️ Dead Code Detection",
  },
] as const;

/**
 * Every caller that passes `skip_jobs` into the shared quality workflow.
 *
 * A required context is only safe while no caller can switch its job off, so
 * the roster is enumerated rather than sampled — a new stack template that
 * skipped one of these jobs would strand every pull request in that stack.
 */
const CALLERS_PASSING_SKIP_JOBS = [
  CI_WORKFLOW,
  "typescript/create-only/.github/workflows/ci.yml",
  "nestjs/create-only/.github/workflows/ci.yml",
  "expo/create-only/.github/workflows/ci.yml",
] as const;

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, relative), "utf8"));

const requiredChecks = (
  relative: string
): { context: string; integration_id?: number }[] => {
  const parsed = readJson(relative) as {
    rules: {
      type: string;
      parameters?: {
        required_status_checks?: { context: string; integration_id?: number }[];
      };
    }[];
  };
  return parsed.rules
    .filter(rule => rule.type === "required_status_checks")
    .flatMap(rule => rule.parameters?.required_status_checks ?? []);
};

const jobs = (relative: string): Map<string, string> => {
  const workflow = readWorkflow(path.join(REPO_ROOT, relative));
  if (workflow === null) throw new Error(`unreadable workflow: ${relative}`);
  return workflow.jobs;
};

describe("slow lint and dead code gate the merge, not only the push", () => {
  it.each(PROMOTED)(
    "makes $jobName a required context on the TypeScript stack",
    ({ context }) => {
      const contexts = requiredChecks(TYPESCRIPT_RULESET).map(
        check => check.context
      );
      expect(contexts).toContain(context);
    }
  );

  it.each(PROMOTED)(
    "pins $jobName to the GitHub Actions app that posts it",
    ({ context }) => {
      const check = requiredChecks(TYPESCRIPT_RULESET).find(
        entry => entry.context === context
      );
      expect(check?.integration_id).toBe(ACTIONS_INTEGRATION_ID);
    }
  );

  it.each(PROMOTED)(
    "names a job that exists, spelled exactly as the $context half it reports",
    ({ jobId, jobName }) => {
      // Failure mode 1 from #2509: a context no job reports never goes green,
      // so it blocks every pull request forever. The caller job supplies the
      // prefix and the reusable workflow supplies the suffix.
      expect(jobs(CI_WORKFLOW).get("quality")).toBe("🔍 Quality Checks");
      expect(jobs(QUALITY_WORKFLOW).get(jobId)).toBe(jobName);
    }
  );

  it("keeps the reporting workflow unfiltered so the contexts always report", () => {
    // Failure mode 2 from #2509, measured on PR #2496: a `paths:`-filtered
    // workflow does not run, so its context never reports at all.
    const workflow = readWorkflow(path.join(REPO_ROOT, CI_WORKFLOW));
    expect(workflow?.onPullRequest).toBe(true);
    expect(workflow?.pathFilterKeys).toEqual([]);
  });

  it.each(CALLERS_PASSING_SKIP_JOBS)(
    "%s never skips either promoted job",
    relative => {
      const source = readFileSync(path.join(REPO_ROOT, relative), "utf8");
      const declared = /skip_jobs:\s*'([^']*)'/u.exec(source)?.[1] ?? "";
      const tokens = declared.split(",").map(token => token.trim());
      for (const { jobId } of PROMOTED) {
        expect(tokens).not.toContain(jobId);
      }
    }
  );

  it.each(PROMOTED)(
    "records proven headroom for $context in the promotion ledger",
    ({ context, jobId }) => {
      const ledger = readJson(LEDGER) as {
        promotions: {
          context: string;
          job_id?: string;
          headroom?: { status?: string };
        }[];
      };
      const entry = ledger.promotions.find(item => item.context === context);
      expect(entry?.job_id).toBe(jobId);
      // `grandfathered` is frozen to contexts required on 2026-08-13, so a
      // promotion made after that date can only ever be `proven`.
      expect(entry?.headroom?.status).toBe("proven");
    }
  );

  it("leaves the push moment for both gates exactly as it was", () => {
    // The owner's ruling was to PROMOTE, explicitly not to make either gate
    // cheaper at push. If a later change flips these to make pushes faster, it
    // is reversing a decision rather than tuning a number.
    const config = readJson(".lisa.config.json") as {
      gates: Record<string, { push?: string }>;
    };
    expect(config.gates["code-style-slow"]?.push).toBe("required");
    expect(config.gates["dead-code"]?.push).toBe("required");
  });
});
