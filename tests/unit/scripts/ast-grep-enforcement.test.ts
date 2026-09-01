/**
 * `🔎 Structural Rules` must actually gate a merge (issue #2506).
 *
 * The job ran, and correctly failed on an `error`-severity diagnostic, but was
 * not a required status context — so with auto-merge on, a PR introducing an
 * ast-grep violation went red on that job and merged anyway. Every ast-grep
 * rule in the repository was advisory by accident.
 *
 * The issue demonstrated itself about forty minutes after it was filed: #2512
 * shipped an error-severity fs-extra rule, its own CI scan found 1142
 * violations, the job went red, and #2512 merged at a94dd44ba regardless. A
 * gate that cannot block the merge of a pull request that breaks the gate is
 * not a gate.
 *
 * @module tests/unit/scripts/ast-grep-enforcement
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

const AST_GREP_JOB_NAME = "🔎 Structural Rules";
const RAILS_RULESET = "rails/github-rulesets/quality-checks.json";

const requiredContexts = (relative: string): string[] => {
  const parsed = JSON.parse(
    readFileSync(path.join(REPO_ROOT, relative), "utf8")
  );
  return parsed.rules
    .filter((r: { type: string }) => r.type === "required_status_checks")
    .flatMap(
      (r: { parameters: { required_status_checks: { context: string }[] } }) =>
        r.parameters.required_status_checks.map(c => c.context)
    );
};

const jobs = (relative: string): Map<string, string> => {
  const workflow = readWorkflow(path.join(REPO_ROOT, relative));
  if (workflow === null) throw new Error(`unreadable workflow: ${relative}`);
  return workflow.jobs;
};

describe("ast-grep rules enforce rather than advise", () => {
  it("makes the scan a required context on the TypeScript stack", () => {
    expect(
      requiredContexts("typescript/github-rulesets/quality-checks.json")
    ).toContain("🔍 Quality Checks / 🔎 Structural Rules");
  });

  it("names a job that actually exists, spelled exactly as the context", () => {
    // Failure mode 1 from #2509: a context no job reports never goes green, so
    // it blocks every pull request in the repository forever. The caller job
    // supplies the prefix and the reusable workflow supplies the suffix.
    expect(jobs(".github/workflows/ci.yml").get("quality")).toBe(
      "🔍 Quality Checks"
    );
    expect(jobs(".github/workflows/quality.yml").get("sg_scan")).toBe(
      AST_GREP_JOB_NAME
    );
  });

  it("keeps the reporting workflow unfiltered so the context always reports", () => {
    // Failure mode 2 from #2509, measured on PR #2496: a `paths:`-filtered
    // workflow does not run, so its context never reports at all and the pull
    // request waits forever on "Expected — waiting for status to be reported".
    const workflow = readWorkflow(
      path.join(REPO_ROOT, ".github/workflows/ci.yml")
    );
    expect(workflow?.onPullRequest).toBe(true);
    expect(workflow?.pathFilterKeys).toEqual([]);
  });

  it("keeps the scan step failing the job, blocking unless the declaration says otherwise", () => {
    const quality = readFileSync(
      path.join(REPO_ROOT, ".github/workflows/quality.yml"),
      "utf8"
    );
    const start = quality.indexOf("\n  sg_scan:");
    const block = quality.slice(
      start,
      quality.indexOf("\n  floor_collisions:")
    );
    expect(block).toContain("run: ${{ inputs.package_manager }} run sg:scan");
    // Not "no continue-on-error at all" — "none that goes green on its own
    // say-so". An UNCONDITIONAL carrier is the defect this pins: a scan that
    // can report green having analysed nothing. The one carrier the job has is
    // the gate step, keyed on the DECLARED LEVEL, so `required` still blocks
    // and only a project that wrote `optional` gets a non-blocking red. The
    // `sg:scan` fallback above carries none at all.
    expect(block).not.toContain("continue-on-error: true");
    expect(block.match(/continue-on-error: .*/g) ?? []).toEqual([
      "continue-on-error: ${{ steps.gate.outputs.level == 'optional' }}",
    ]);
  });

  it("records the promotion as PROVEN, not grandfathered", () => {
    const ledger = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, ".github/required-check-promotions.json"),
        "utf8"
      )
    );
    const entry = ledger.promotions.find(
      (p: { context: string }) =>
        p.context === "🔍 Quality Checks / 🔎 Structural Rules"
    );
    expect(entry.headroom.status).toBe("proven");
    expect(entry.headroom.budget_ms).toBe(600_000);
    expect(entry.headroom.observed_worst_ms).toBe(40_000);
  });
});

describe("the Rails half is deferred, and the reason is not the job name", () => {
  it("has an identically named ast-grep job, so the context IS derivable", () => {
    // #2506 warned that adding a context to the Rails template "by symmetry"
    // would name a job nothing reports, because that file mixes emoji and
    // non-emoji contexts. Parsing the workflow disproves the hazard:
    // quality-rails.yml genuinely names this job with emoji, exactly as
    // quality.yml does. The correct Rails context is therefore
    // `Quality Checks / 🔎 Structural Rules` — the mixing is real but benign,
    // because the Rails CALLER job is named without emoji and the newer called
    // jobs are named with it.
    expect(
      jobs("rails/create-only/.github/workflows/ci.yml").get("quality")
    ).toBe("Quality Checks");
    expect(jobs(".github/workflows/quality-rails.yml").get("sg_scan")).toBe(
      AST_GREP_JOB_NAME
    );
  });

  it("does not promote it yet, because no Rails measurement exists", () => {
    // The real blocker is #2509's precondition, not the naming. The 15x
    // headroom proven for this job was measured on THIS repository's runs;
    // carrying it over to a Rails project is argument by analogy, which is the
    // error #2490 made when it sized sonar-secrets' budget from a
    // plugin-sync-scripts probe. Promote this once a Rails project's job has
    // actually been measured.
    expect(requiredContexts(RAILS_RULESET)).not.toContain(
      "Quality Checks / 🔎 Structural Rules"
    );
  });
});
