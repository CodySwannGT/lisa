/**
 * Tests for the OUTCOME arm of the skipped-required-check guard.
 *
 * The defect it refuses is the one the declaration arm stopped being able to
 * see once `skip_jobs` was retired: a ruleset-required context whose job
 * concluded `skipped` — which GitHub counts as SATISFIED — while the guard
 * printed `✅ 0 skip_jobs token(s) examined; none silences a ruleset-required
 * status check`. Measured on a caller repository in the portfolio: a required
 * `🧾 BDD Behavior Contract` context skipped on seven of its sixty most recent
 * merges, and the guard was green on every one.
 *
 * Three properties, each asserted on both halves so that a guard which failed
 * unconditionally could not satisfy the suite:
 *
 *  1. A skipped required context FAILS — in every enforcement mode.
 *  2. "Examined nothing" never renders as "found nothing": zero contexts
 *     examined, an untranscribed snapshot, or unreadable results each refuse.
 *  3. The vestigial token arm cannot produce the pass on its own.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";
const CI_WORKFLOW = ".github/workflows/ci.yml";
const DECLARATION_REL = path.join(".github", "required-checks.json");

/** A required context a job in the run posts. */
const LINT = "🔍 Quality Checks / 🧹 Lint";

/** The required context measured skipping under a green guard. */
const BDD = "🔍 Quality Checks / 🧾 BDD Behavior Contract";

/** A required context no job in the run posts — an external app. */
const REVIEW = "CodeRabbit";

/** Job id → display name, as the workflow hands it to the prover. */
const NAMES: Readonly<Record<string, string>> = {
  lint: "🧹 Lint",
  lint_slow: "🐢 Slow Lint Rules",
  bdd_coverage: "🧾 BDD Behavior Contract",
};

const OUTCOMES = "--outcomes";
const TRUSTED = { trusted: true, reason: "" };

/** One violation. */
interface Violation {
  readonly kind: string;
  readonly token: string | null;
  readonly message: string;
}

/** One examined required context. */
interface Examined {
  readonly context: string;
  readonly job: string;
  readonly result: string;
}

/** What the outcome arm returns. */
interface Inspection {
  readonly moment: string;
  readonly applicable: boolean;
  readonly examined: readonly Examined[];
  readonly notExamined: readonly string[];
  readonly violations: readonly Violation[];
  readonly refusal: { kind: string; reason: string } | null;
}

/** What the guard exports, as this suite consumes it. */
interface GuardModule {
  readonly VIOLATIONS: Record<string, string>;
  readonly OUTCOME_REFUSALS: Record<string, string>;
  readonly OUTCOME_ENV: Record<string, string>;
  readonly OUTCOMES_FLAG: string;
  producesContext(jobName: string, context: string): boolean;
  evaluateRequiredOutcomes(
    declaration: Record<string, unknown>,
    results: Record<string, { result?: string }>,
    names: Record<string, string>
  ): Pick<Inspection, "examined" | "notExamined" | "violations"> & {
    prefix: { prefix: string | null; source: string };
  };
  inspectOutcomes(
    argv: readonly string[],
    declaration: Record<string, unknown>,
    options?: {
      env?: Record<string, string>;
      trust?: { trusted: boolean; reason: string };
    }
  ): Inspection | undefined;
}

/**
 * Shapes job results the way `toJSON(needs)` does.
 *
 * @param results - Job id → result
 * @returns The `needs` object
 */
function needs(
  results: Record<string, string>
): Record<string, { result: string; outputs: Record<string, string> }> {
  return Object.fromEntries(
    Object.entries(results).map(([job, result]) => [
      job,
      { result, outputs: {} },
    ])
  );
}

/**
 * The environment the workflow step sets.
 *
 * @param results - Job id → result
 * @param moment - The workflow's `moment` input
 * @returns Environment variables for the prover
 */
function outcomeEnv(
  results: Record<string, string>,
  moment = "pull-request"
): Record<string, string> {
  return {
    LISA_GATE_MOMENT: moment,
    LISA_JOB_RESULTS: JSON.stringify(needs(results)),
    LISA_JOB_NAMES: JSON.stringify(NAMES),
  };
}

/** Options for {@link repoRequiring}. */
interface RepoOptions {
  readonly enforcement?: string;
  readonly stamped?: boolean;
  readonly skipJobs?: string;
}

/**
 * Builds a repository whose declaration requires the given contexts.
 *
 * @param required - `required_contexts`
 * @param options - Enforcement mode, stamp, and an optional `skip_jobs` value
 * @returns The repository root
 */
function repoRequiring(
  required: readonly string[],
  options: RepoOptions = {}
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skipreq-outcomes-"));
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(root, CI_WORKFLOW.replace(/\//gu, path.sep)),
    options.skipJobs === undefined
      ? "jobs: {}\n"
      : [
          "jobs:",
          "  quality:",
          "    with:",
          `      skip_jobs: '${options.skipJobs}'`,
          "",
        ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, DECLARATION_REL),
    JSON.stringify({
      ...(options.enforcement === undefined
        ? {}
        : { enforcement: options.enforcement }),
      ruleset: {
        repo: "owner/name",
        ids: [1],
        baseline_fetched_at: options.stamped === false ? "" : "2026-09-11",
      },
      required_contexts: required,
      workflows: [CI_WORKFLOW],
      skip_job_declarations: {},
    })
  );
  return root;
}

/**
 * Runs the guard CLI against a repository.
 *
 * @param root - Repository root
 * @param args - Flags after the root
 * @param env - Extra environment
 * @returns Exit status and combined output
 */
function runCli(
  root: string,
  args: readonly string[],
  env: Record<string, string> = {}
): { status: number; output: string } {
  const run = boundedSpawnSync({
    label: "check-skipped-required-checks.mjs (outcome arm)",
    command: process.execPath,
    args: [path.join(REPO_ROOT, SCRIPT_REL), root, ...args],
    env: { ...process.env, ...env },
  });
  return {
    status: run.status ?? -1,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

describe("check-skipped-required-checks, the outcome arm", () => {
  let mod: GuardModule;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    )) as unknown as GuardModule;
  });

  describe("judging each required context by what its job did", () => {
    it("FAILS the shape that merged green: a required context whose job skipped", () => {
      const result = mod.evaluateRequiredOutcomes(
        { required_contexts: [LINT, BDD, REVIEW] },
        needs({
          lint: "success",
          lint_slow: "success",
          bdd_coverage: "skipped",
        }),
        NAMES
      );
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.requiredSkipped,
      ]);
      const [finding] = result.violations;
      expect(finding?.token).toBe(BDD);
      expect(finding?.message).toContain("SATISFIED");
      expect(result.examined).toEqual([
        { context: LINT, job: "lint", result: "success" },
        { context: BDD, job: "bdd_coverage", result: "skipped" },
      ]);
      expect(result.notExamined).toEqual([REVIEW]);
    });

    it("passes a context whose job RAN — red included, which GitHub blocks by itself", () => {
      for (const ran of ["success", "failure", "cancelled"]) {
        const result = mod.evaluateRequiredOutcomes(
          { required_contexts: [LINT] },
          needs({ lint: ran }),
          NAMES
        );
        expect(result.violations, ran).toEqual([]);
        expect(result.examined, ran).toHaveLength(1);
      }
    });

    it("REFUSES a result it cannot read rather than assuming the job ran", () => {
      const result = mod.evaluateRequiredOutcomes(
        { required_contexts: [LINT] },
        {},
        NAMES
      );
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.requiredNotRun,
      ]);
    });

    it("matches a context on the ` / ` boundary, never on a bare suffix", () => {
      expect(mod.producesContext("🧹 Lint", LINT)).toBe(true);
      expect(mod.producesContext("🧹 Lint", "🧹 Lint")).toBe(true);
      expect(
        mod.producesContext("🧹 Lint", "🔍 Quality Checks / 🐢 Slow Lint Rules")
      ).toBe(false);
      expect(mod.producesContext("Lint", "🔍 Quality Checks / Slow Lint")).toBe(
        false
      );
    });

    it("does NOT judge a context another workflow posts, name match or not", () => {
      // The collision CodeRabbit raised on this change, and the one that would
      // put this guard back in the business of false greens: the trailing
      // segment is the local job's name, the prefix says the check belongs to a
      // workflow this run cannot see, and reporting the local result for it
      // claims a check nobody here read. It is NOT EXAMINED, and its skipped
      // local twin is still caught under the prefix this run does own.
      const foreign = "🌙 Nightly E2E Health / 🧹 Lint";
      const result = mod.evaluateRequiredOutcomes(
        { required_contexts: [LINT, BDD, foreign] },
        needs({ lint: "skipped", bdd_coverage: "success" }),
        NAMES
      );
      expect(result.notExamined).toEqual([foreign]);
      expect(result.examined.map(entry => entry.context)).toEqual([LINT, BDD]);
      expect(result.violations.map(violation => violation.token)).toEqual([
        LINT,
      ]);
      expect(result.prefix.prefix).toBe("🔍 Quality Checks");
    });

    it("judges nothing when no prefix has a majority, rather than coin-tossing", () => {
      // One context each: nothing evidences which workflow this run is, so
      // neither is attributed. Coverage lost, and reported as lost.
      const result = mod.evaluateRequiredOutcomes(
        {
          required_contexts: ["A / 🧹 Lint", "B / 🐢 Slow Lint Rules"],
        },
        needs({ lint: "skipped", lint_slow: "skipped" }),
        NAMES
      );
      expect(result.examined).toEqual([]);
      expect(result.violations).toEqual([]);
      expect(result.notExamined).toEqual([
        "A / 🧹 Lint",
        "B / 🐢 Slow Lint Rules",
      ]);
      expect(result.prefix.prefix).toBeNull();
      expect(result.prefix.source).toContain("not evidenced");
    });

    it("takes a DECLARED prefix over any inference", () => {
      // The escape from the inference: a repository that states its caller job
      // name gets exact ownership, and a majority of foreign contexts cannot
      // out-vote it.
      const result = mod.evaluateRequiredOutcomes(
        {
          ruleset: { context_prefix: "🔍 Quality Checks" },
          required_contexts: [
            LINT,
            "🌙 Other / 🐢 Slow Lint Rules",
            "🌙 Other / 🧾 BDD Behavior Contract",
          ],
        },
        needs({
          lint: "skipped",
          lint_slow: "success",
          bdd_coverage: "success",
        }),
        NAMES
      );
      expect(result.examined.map(entry => entry.context)).toEqual([LINT]);
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.requiredSkipped,
      ]);
      expect(result.prefix.source).toContain("declared");
    });

    it("REFUSES a context two jobs could both post instead of guessing", () => {
      const result = mod.evaluateRequiredOutcomes(
        { required_contexts: ["Caller / Inner / Lint"] },
        needs({ outer: "success", inner: "skipped" }),
        { outer: "Lint", inner: "Inner / Lint" }
      );
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.requiredAmbiguous,
      ]);
      expect(result.examined).toEqual([]);
    });
  });

  describe("refusing to render examined-nothing as found-nothing", () => {
    it("reads the environment the workflow step sets", () => {
      expect(mod.OUTCOME_ENV).toEqual({
        results: "LISA_JOB_RESULTS",
        names: "LISA_JOB_NAMES",
        moment: "LISA_GATE_MOMENT",
      });
      expect(mod.OUTCOMES_FLAG).toBe(OUTCOMES);
    });

    it("does nothing unless asked", () => {
      expect(
        mod.inspectOutcomes(
          [],
          { required_contexts: [LINT] },
          { env: outcomeEnv({ lint: "skipped" }), trust: TRUSTED }
        )
      ).toBeUndefined();
    });

    it("refuses when not one required context is posted by a job in this run", () => {
      const inspection = mod.inspectOutcomes(
        [OUTCOMES],
        { required_contexts: [REVIEW] },
        { env: outcomeEnv({ lint: "success" }), trust: TRUSTED }
      );
      expect(inspection?.refusal?.kind).toBe(
        mod.OUTCOME_REFUSALS.examinedNothing
      );
      expect(inspection?.examined).toEqual([]);
      expect(inspection?.notExamined).toEqual([REVIEW]);
    });

    it("refuses an untranscribed snapshot", () => {
      const inspection = mod.inspectOutcomes(
        [OUTCOMES],
        { required_contexts: [] },
        {
          env: outcomeEnv({ lint: "success" }),
          trust: { trusted: false, reason: "never transcribed" },
        }
      );
      expect(inspection?.refusal?.kind).toBe(mod.OUTCOME_REFUSALS.untrusted);
    });

    it("refuses results or names it cannot parse", () => {
      for (const env of [
        { ...outcomeEnv({ lint: "success" }), LISA_JOB_RESULTS: "not json" },
        { ...outcomeEnv({ lint: "success" }), LISA_JOB_RESULTS: "[]" },
        { ...outcomeEnv({ lint: "success" }), LISA_JOB_NAMES: "{}" },
        { ...outcomeEnv({ lint: "success" }), LISA_JOB_NAMES: '{"lint":1}' },
      ]) {
        const inspection = mod.inspectOutcomes(
          [OUTCOMES],
          { required_contexts: [LINT] },
          { env, trust: TRUSTED }
        );
        expect(inspection?.refusal?.kind).toBe(mod.OUTCOME_REFUSALS.unreadable);
      }
    });

    it("refuses an empty moment rather than guessing whether this run gates a merge", () => {
      const inspection = mod.inspectOutcomes(
        [OUTCOMES],
        { required_contexts: [LINT] },
        { env: outcomeEnv({ lint: "skipped" }, ""), trust: TRUSTED }
      );
      expect(inspection?.refusal?.kind).toBe(mod.OUTCOME_REFUSALS.unreadable);
    });

    it("is NOT APPLICABLE at a moment that gates no merge, and examines nothing there", () => {
      const inspection = mod.inspectOutcomes(
        [OUTCOMES],
        { required_contexts: [LINT] },
        {
          env: outcomeEnv({ lint: "skipped" }, "continuous:dev"),
          trust: TRUSTED,
        }
      );
      expect(inspection?.applicable).toBe(false);
      expect(inspection?.examined).toEqual([]);
      expect(inspection?.violations).toEqual([]);
      expect(inspection?.refusal).toBeNull();
    });
  });

  describe("the CLI verdict", () => {
    it("goes RED on a skipped required context, even under `enforcement: warn`", () => {
      const { status, output } = runCli(
        repoRequiring([LINT, BDD, REVIEW], { enforcement: "warn" }),
        [OUTCOMES],
        outcomeEnv({
          lint: "success",
          lint_slow: "success",
          bdd_coverage: "skipped",
        })
      );
      expect(status).toBe(1);
      expect(output).toContain("required_context_skipped");
      expect(output).toContain(BDD);
      expect(output).not.toContain("none was skipped");
    });

    it("is green only while stating what it examined and what it could not see", () => {
      const { status, output } = runCli(
        repoRequiring([LINT, BDD, REVIEW]),
        [OUTCOMES],
        outcomeEnv({
          lint: "success",
          lint_slow: "success",
          bdd_coverage: "success",
        })
      );
      expect(status).toBe(0);
      expect(output).toContain(
        "✅ 2 ruleset-required context(s) examined against this run's job results; none was skipped."
      );
      expect(output).toContain(`\`${LINT}\` ← job \`lint\`: \`success\``);
      expect(output).toContain(
        `\`${BDD}\` ← job \`bdd_coverage\`: \`success\``
      );
      expect(output).toContain("Not examined — 1 required context(s)");
      expect(output).toContain(`- \`${REVIEW}\``);
      expect(output).not.toContain("::error");
    });

    it("FAILS having examined nothing, under `enforcement: warn` too", () => {
      const { status, output } = runCli(
        repoRequiring([REVIEW], { enforcement: "warn" }),
        [OUTCOMES],
        outcomeEnv({ lint: "success" })
      );
      expect(status).toBe(1);
      expect(output).toContain(mod.OUTCOME_REFUSALS.examinedNothing);
      expect(output).not.toContain("✅");
    });

    it("FAILS on an untranscribed snapshot, under `enforcement: warn` too", () => {
      const { status, output } = runCli(
        repoRequiring([], { enforcement: "warn", stamped: false }),
        [OUTCOMES],
        outcomeEnv({ lint: "success" })
      );
      expect(status).toBe(1);
      expect(output).toContain(mod.OUTCOME_REFUSALS.untrusted);
      expect(output).not.toContain("✅");
    });

    it("exits 0 at a moment that gates no merge, saying nothing was examined", () => {
      const { status, output } = runCli(
        repoRequiring([LINT]),
        [OUTCOMES],
        outcomeEnv({ lint: "skipped" }, "continuous:dev")
      );
      expect(status).toBe(0);
      expect(output).toContain("Outcome arm not applicable");
      expect(output).not.toContain("✅");
    });
  });

  describe("the declaration arm is vestigial", () => {
    it("never prints a ✅ or claims nothing was silenced on its own", () => {
      const { status, output } = runCli(repoRequiring([LINT]), []);
      expect(output).toContain("VESTIGIAL");
      expect(output).toContain("NOT a verdict");
      expect(output).not.toContain("✅");
      expect(output).not.toContain(
        "none silences a ruleset-required status check"
      );
      // No hygiene defect was found, so the bare form does not fail — but it
      // has not claimed anything about a required context, and says so above.
      expect(status).toBe(0);
    });

    it("cannot turn a refused outcome inspection into a pass", () => {
      // Zero tokens, so the token arm has nothing to object to. The outcome
      // arm examined nothing, and its refusal is what decides the exit code.
      const { status, output } = runCli(
        repoRequiring([REVIEW]),
        [OUTCOMES],
        outcomeEnv({ lint: "success" })
      );
      expect(status).toBe(1);
      expect(output).toContain("0 `skip_jobs` token(s) examined");
    });

    it("still ADDS its findings on top of a clean outcome", () => {
      const { status, output } = runCli(
        repoRequiring([LINT], { skipJobs: "surprise" }),
        [OUTCOMES],
        outcomeEnv({ lint: "success" })
      );
      expect(status).toBe(1);
      expect(output).toContain("undeclared_skip_token");
      expect(output).toContain(
        "violation(s) across 1 required-context outcome(s) and 1 `skip_jobs` token(s)"
      );
    });
  });
});
