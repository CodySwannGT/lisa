/**
 * Tests for the ABSENT-required-check arm of the skipped-required-check guard.
 *
 * The third member of the family this file's own header already names:
 * *"required-and-red is loud; required-and-vacuous is not; advisory-and-stale
 * is invisible... the useful question is never 'did the check pass' but 'did
 * the check do anything'."* Skipped and vacuous were implemented. **Absent was
 * not**, and absent is the one that cost a day.
 *
 * The defect it reports (CodySwannGT/lisa#3580, measured on PR #3573): a
 * required status context that posted **no check-run at all**. Not red, not
 * pending — absent. On the PR page an absent context renders exactly as one
 * still in flight, so every surface a human or an agent consults says "wait".
 *
 * ```
 * head 86daf7c7  required contexts: 15   reported: 2   absent: 13
 *   GET /commits/86daf7c7/check-runs -> total_count: 1  (GitGuardian)
 *   GET /commits/86daf7c7/status     -> [("CodeRabbit", "success")]
 * ```
 *
 * The three workflow runs that would have posted the other thirteen sat at
 * `conclusion: action_required` with `created_at == updated_at` — parked,
 * never executed, awaiting an approval nobody gives.
 *
 * **Why the existing arms could not see it.** `evaluateVacuousChecks` iterates
 * `evidence_bearing_checks`, which on that repository holds exactly one name.
 * `required_contexts` held fifteen. The guard already knew the full required
 * set and used it only as an ANNOTATION on findings about the one — it never
 * iterated it to ask which members reported nothing.
 *
 * Every case below is written against the byte-exact shape the GitHub API
 * returned for PR #3573, read through `gh api` and `gh pr checks --json`.
 */
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

/** One violation, as this suite consumes it. */
interface Violation {
  readonly kind: string;
  readonly token: string | null;
  readonly message: string;
}

/** One check as `gh pr checks --json name,state,bucket,description` returns it. */
interface CheckRow {
  readonly name: string;
  readonly state: string;
  readonly bucket?: string;
  readonly description?: string;
}

/** One parked workflow run, as `gh api .../actions/runs` returns one. */
interface RunRow {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string;
}

/** The guard's absence exports. */
interface GuardModule {
  readonly VIOLATIONS: Record<string, string>;
  readonly NEVER_BLOCKING: readonly string[];
  readonly ALWAYS_BLOCKING?: readonly string[];
  evaluateAbsentRequiredChecks(
    declaration: Record<string, unknown>,
    checks: readonly CheckRow[],
    options?: {
      trustRequiredContexts?: boolean;
      headSha?: string;
      parkedRuns?: readonly RunRow[];
    }
  ): { violations: Violation[]; checked: number; absent: string[] };
}

/** The two contexts that DID report on the measured head. */
const GITGUARDIAN = "GitGuardian Security Checks";
const CODERABBIT = "CodeRabbit";

/**
 * The thirteen that reported nothing, named exactly as the ruleset names them.
 *
 * Emoji and the ` / ` job separator included deliberately: contexts are
 * compared byte for byte, and a test that tidies the names would pass against
 * a guard that could never match the real ones.
 */
const ABSENT_THIRTEEN = [
  "🔍 Quality Checks / 🧹 Lint",
  "🔍 Quality Checks / 🔍 Type Check",
  "🔍 Quality Checks / 🏗️ Build",
  "🔍 Quality Checks / 📐 Check Formatting",
  "🔍 Quality Checks / 🔒 Security Scan",
  "🔍 Quality Checks / 🧪 Run Unit Tests",
  "🔍 Quality Checks / 🧪 Run Integration Tests",
  "🔍 Quality Checks / 🔗 Work-Item Traceability",
  "🔍 Quality Checks / 🐢 Slow Lint Rules",
  "🔍 Quality Checks / 🗑️ Dead Code Detection",
  "🧩 Plugin artifacts match source",
  "🔍 Quality Checks / 🔎 Structural Rules",
  "🔍 Quality Checks / 📚 Learnings Budget",
] as const;

/** The measured trapped head on PR #3573. */
const HEAD_SHA = "86daf7c72f5f4e2b1a0d8c3e9b7a6f5d4c3b2a19";

/** The measured parked run — `created_at == updated_at`, never executed. */
const PARKED_RUN: RunRow = {
  id: 33655664741,
  name: "🔍 CI Quality Checks",
  status: "completed",
  conclusion: "action_required",
};

/**
 * Builds the measured declaration: fifteen required, one evidence-bearing.
 *
 * That ratio is the defect's whole shape — the guard knew all fifteen and
 * looked at one.
 *
 * @param overrides - Keys merged over the base declaration
 * @returns A declaration object
 */
function declarationWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    required_contexts: [CODERABBIT, GITGUARDIAN, ...ABSENT_THIRTEEN],
    workflows: [".github/workflows/ci.yml"],
    skip_job_declarations: {},
    evidence_bearing_checks: { [CODERABBIT]: {} },
    ...overrides,
  };
}

/** The two rows the merge gate could actually see on the trapped head. */
function reportedRows(): CheckRow[] {
  return [
    { name: CODERABBIT, state: "SUCCESS", bucket: "pass" },
    { name: GITGUARDIAN, state: "SUCCESS", bucket: "pass" },
  ];
}

describe("absent required checks", () => {
  let mod: GuardModule;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    )) as unknown as GuardModule;
  });

  it("names a distinct violation kind for absence", () => {
    // Absence is its own state. Reusing `unproven` would fold "reported
    // something that proves nothing" into "reported nothing", and the two have
    // different remedies: one is read the check, the other is make it run.
    expect(mod.VIOLATIONS.absent).toBe("absent_required_check");
  });

  it("classifies a required context with no check-run as absent", () => {
    const result = mod.evaluateAbsentRequiredChecks(
      declarationWith(),
      reportedRows(),
      { headSha: HEAD_SHA }
    );

    expect(result.absent).toEqual([...ABSENT_THIRTEEN]);
    expect(result.violations).toHaveLength(ABSENT_THIRTEEN.length);
    expect(result.violations.every(v => v.kind === mod.VIOLATIONS.absent)).toBe(
      true
    );
  });

  it("reproduces the measured #3573 ratio: 15 required, 2 reported", () => {
    const result = mod.evaluateAbsentRequiredChecks(
      declarationWith(),
      reportedRows(),
      { headSha: HEAD_SHA }
    );

    expect(result.checked).toBe(15);
    expect(result.absent).toHaveLength(13);
  });

  it("does not flag a context that reported, in any state", () => {
    // PENDING is PRESENT. A check in flight has posted a row and will post a
    // verdict; an absent one never will. Collapsing them is the confusion that
    // made the stall invisible, so the guard must not make it in reverse.
    const rows: CheckRow[] = [
      ...reportedRows(),
      ...ABSENT_THIRTEEN.map((name, index) => ({
        name,
        state: index % 2 === 0 ? "PENDING" : "FAILURE",
        bucket: index % 2 === 0 ? "pending" : "fail",
      })),
    ];

    const result = mod.evaluateAbsentRequiredChecks(declarationWith(), rows, {
      headSha: HEAD_SHA,
    });

    expect(result.absent).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it("blocks — it is not in NEVER_BLOCKING, unlike the vacuous arm", () => {
    // The asymmetry is deliberate and is the point. `vacuous` is report-only
    // because a hollow check usually means a THIRD-PARTY vendor hit a spending
    // cap, and reddening every PR over an unpaid bill is a worse gate than the
    // one it criticises. Absence is not that: these are the repository's OWN
    // required contexts, and nothing outside the repository decides whether
    // they run. There is no billing artefact to be charitable about.
    // Assert the kind EXISTS before asserting where it is not listed.
    // `expect(NEVER_BLOCKING).not.toContain(undefined)` passes against code
    // that has no absence arm at all — a test that reports satisfied having
    // proven nothing, which is the exact defect this file is about. It would
    // have been the one green line in a red suite, and it would have meant
    // nothing.
    expect(mod.VIOLATIONS.absent).toBeTypeOf("string");
    expect(mod.NEVER_BLOCKING).not.toContain(mod.VIOLATIONS.absent);
    expect(mod.NEVER_BLOCKING).toContain(mod.VIOLATIONS.vacuous);
  });

  it("stays silent when required_contexts was never transcribed", () => {
    // Without the snapshot the guard does not know what was required, and a
    // guard that invents a required set would flag every repository that has
    // not adopted the declaration. Absence of knowledge is not knowledge of
    // absence — the same distinction this arm exists to enforce.
    const result = mod.evaluateAbsentRequiredChecks(
      declarationWith({ required_contexts: undefined }),
      reportedRows(),
      { headSha: HEAD_SHA }
    );

    expect(result.violations).toEqual([]);
    expect(result.checked).toBe(0);
  });

  it("cites the head SHA, because absence is a property of a commit", () => {
    const result = mod.evaluateAbsentRequiredChecks(
      declarationWith(),
      reportedRows(),
      { headSha: HEAD_SHA }
    );

    expect(result.violations[0]?.message).toContain(HEAD_SHA);
  });

  it("names the approval gate when a run for the head is parked", () => {
    // AC scenario 1: "reports the pull request as blocked with a reason naming
    // the approval gate". A message that only says "absent" sends the operator
    // looking for a broken workflow; naming `action_required` and the approve
    // call is the difference between a diagnosis and a shrug.
    const result = mod.evaluateAbsentRequiredChecks(
      declarationWith(),
      reportedRows(),
      { headSha: HEAD_SHA, parkedRuns: [PARKED_RUN] }
    );

    const message = result.violations[0]?.message ?? "";
    expect(message).toContain("action_required");
    expect(message).toContain(String(PARKED_RUN.id));
    expect(message).toContain("approve");
  });

  it("still reports absence when no parked run can be read", () => {
    // The run lookup is an ENRICHMENT, never a precondition. A guard that only
    // reports absence when it can also explain the cause reports nothing on
    // every path where the explanation is unavailable — which is the silent
    // failure it was written to end.
    const result = mod.evaluateAbsentRequiredChecks(
      declarationWith(),
      reportedRows(),
      { headSha: HEAD_SHA, parkedRuns: [] }
    );

    expect(result.absent).toHaveLength(13);
    expect(result.violations[0]?.message).toContain("did not report");
  });
});
