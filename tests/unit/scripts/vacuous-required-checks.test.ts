/**
 * Tests for the VACUOUS-required-check arm of the skipped-required-check guard.
 *
 * The defect it reports (CodySwannGT/lisa#2497, measured): a required status
 * check posted `success` while performing zero reviews.
 *
 * ```
 * PR #2483  reviews: 0   status: success — "Review rate limited"
 * PR #2484  reviews: 0   status: success — "Review rate limited"
 * ```
 *
 * Both merged on that green, both carried security-relevant changes, both are
 * in published tag `v3.5.1`. Branch protection recorded "reviewed" for work
 * nothing reviewed. **The status column says `pass` either way — only the
 * DESCRIPTION distinguishes a real review from a hollow one.**
 *
 * Every case below is written against the byte-exact strings GitHub really
 * returned for those PRs, read through `gh pr checks --json`.
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

/** The guard's vacuity exports. */
interface GuardModule {
  readonly VIOLATIONS: Record<string, string>;
  readonly NEVER_BLOCKING: readonly string[];
  readonly REVIEW_DESCRIPTION_DEFAULTS: {
    readonly proof: readonly string[];
    readonly no_work: readonly string[];
  };
  classifyCheckDescription(
    description: string | undefined,
    vocabulary?: Record<string, readonly string[]>
  ): string;
  evaluateVacuousChecks(
    declaration: Record<string, unknown>,
    checks: readonly CheckRow[],
    options?: { trustRequiredContexts?: boolean; headSha?: string }
  ): { violations: Violation[]; checked: number };
  citeHeadSha(headSha: string | undefined): string;
  readonly ENTITLEMENT_WAIVERS: readonly string[];
  readonly REVIEW_SATISFACTIONS: readonly string[];
  readonly REVIEW_GATE_STATES: Record<string, string>;
  readonly REVIEW_GATE_BLOCKING: readonly string[];
  readonly NEVER_BLOCKING: readonly string[];
  reviewGateState(
    reading: { present: boolean; state?: string; description?: string },
    vocabulary?: { waive?: readonly string[]; satisfy?: readonly string[] }
  ): { state: string; why: string };
  evaluateReviewGate(
    declaration: Record<string, unknown>,
    checks: readonly CheckRow[],
    options?: { headSha?: string }
  ): {
    violations: Violation[];
    states: Record<string, string>;
    checked: number;
  };
}

/** The measured CodeRabbit context name. */
const CODERABBIT = "CodeRabbit";

/** The measured hollow description — `success` while reviewing nothing. */
const RATE_LIMITED = "Review rate limited";

/** A head commit, spelled the way `gh pr view --json headRefOid` returns one. */
const HEAD_SHA = "6006820ec1ac55ce4e91279a600924ee9744ecb9";

/** The other measured entitlement string — 29 of the 40 PRs read on #3221. */
const MANUAL_REQUIRED =
  "Review skipped: manual review required for this OSS repository";

/** The one description that satisfies the gate, measured on #3185. */
const COMPLETED = "Review completed";

/** A description this fleet has seen but nobody has confirmed the meaning of. */
const APPROVED = "Review approved";

/**
 * Builds a declaration that treats CodeRabbit as evidence-bearing.
 *
 * @param overrides - Keys merged over the base declaration
 * @returns A declaration object
 */
function declarationWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    required_contexts: [CODERABBIT],
    workflows: [".github/workflows/ci.yml"],
    skip_job_declarations: {},
    evidence_bearing_checks: { [CODERABBIT]: {} },
    ...overrides,
  };
}

describe("vacuous required checks", () => {
  let mod: GuardModule;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    )) as unknown as GuardModule;
  });

  describe("classifying a description", () => {
    it("reads the two measured CodeRabbit strings on opposite sides", () => {
      // The whole point of #2497: `pass` either way, description differs.
      expect(mod.classifyCheckDescription(RATE_LIMITED)).toBe("no-work");
      expect(mod.classifyCheckDescription(APPROVED)).toBe("proved");
    });

    it("treats an unrecognised description as UNPROVEN, never as proof", () => {
      // Fail-safe: a vocabulary nobody enumerated must not read as a pass.
      expect(mod.classifyCheckDescription("Somebody rephrased this")).toBe(
        "unproven"
      );
      expect(mod.classifyCheckDescription("")).toBe("unproven");
      expect(mod.classifyCheckDescription(undefined)).toBe("unproven");
    });

    it("matches proof STRICTLY and no-work LOOSELY", () => {
      // Strict where a match grants credit; loose where a match denies it.
      // A suffixed proof string is no longer the phrase that was reviewed...
      expect(mod.classifyCheckDescription("Review approved with caveats")).toBe(
        "unproven"
      );
      // ...but a suffixed no-work string still means no work was done.
      expect(
        mod.classifyCheckDescription("Review rate limited (retry in 12m)")
      ).toBe("no-work");
    });

    it("ignores case and surrounding whitespace on both sides", () => {
      expect(mod.classifyCheckDescription("  REVIEW APPROVED  ")).toBe(
        "proved"
      );
      expect(mod.classifyCheckDescription("REVIEW RATE LIMITED")).toBe(
        "no-work"
      );
    });

    it("lets a repository extend the vocabulary without losing the defaults", () => {
      const vocabulary = { proof: ["Deep scan finished"] };
      expect(
        mod.classifyCheckDescription("Deep scan finished", vocabulary)
      ).toBe("proved");
      // The shipped no-work list still applies to the same check.
      expect(mod.classifyCheckDescription(RATE_LIMITED, vocabulary)).toBe(
        "no-work"
      );
    });

    it("ships a vocabulary whose two lists never overlap", () => {
      // An overlapping phrase would make the verdict depend on evaluation
      // order, which is how a guard silently starts granting credit.
      const proof = mod.REVIEW_DESCRIPTION_DEFAULTS.proof.map(value =>
        value.toLowerCase()
      );
      for (const phrase of mod.REVIEW_DESCRIPTION_DEFAULTS.no_work) {
        expect(proof).not.toContain(phrase.toLowerCase());
      }
    });
  });

  describe("evaluating one PR's checks", () => {
    it("reports the measured #2483 shape — SUCCESS that reviewed nothing", () => {
      const result = mod.evaluateVacuousChecks(declarationWith(), [
        {
          name: CODERABBIT,
          state: "SUCCESS",
          bucket: "pass",
          description: RATE_LIMITED,
        },
      ]);
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.vacuous,
      ]);
      expect(result.checked).toBe(1);
    });

    it("says branch protection recorded it when the check is ruleset-required", () => {
      const [violation] = mod.evaluateVacuousChecks(declarationWith(), [
        {
          name: CODERABBIT,
          state: "SUCCESS",
          description: RATE_LIMITED,
        },
      ]).violations;
      expect(violation.message).toMatch(/branch protection/i);
    });

    it("still reports a vacuous check that is NOT ruleset-required", () => {
      // advisory-and-stale is the invisible end of the family, not a non-issue.
      const result = mod.evaluateVacuousChecks(
        declarationWith({ required_contexts: [] }),
        [
          {
            name: CODERABBIT,
            state: "SUCCESS",
            description: RATE_LIMITED,
          },
        ]
      );
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).not.toMatch(/branch protection/i);
    });

    it("does not claim required-ness it cannot prove when the snapshot is untrusted", () => {
      const [violation] = mod.evaluateVacuousChecks(
        declarationWith(),
        [
          {
            name: CODERABBIT,
            state: "SUCCESS",
            description: RATE_LIMITED,
          },
        ],
        { trustRequiredContexts: false }
      ).violations;
      expect(violation.kind).toBe(mod.VIOLATIONS.vacuous);
      expect(violation.message).not.toMatch(/branch protection/i);
      expect(violation.message).toMatch(/not transcribed|cannot say/i);
    });

    it("passes a check that proved it did work", () => {
      const result = mod.evaluateVacuousChecks(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: APPROVED },
      ]);
      expect(result.violations).toEqual([]);
    });

    it("reports an unrecognised green description as UNPROVEN", () => {
      const result = mod.evaluateVacuousChecks(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: "Reviewed, maybe" },
      ]);
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.unproven,
      ]);
    });

    it("reports a declared evidence check that never reported at all", () => {
      // Measured on #2493/#2491/#2488: CodeRabbit posted no context whatsoever.
      const result = mod.evaluateVacuousChecks(declarationWith(), [
        { name: "🔍 Quality Checks / 🧹 Lint", state: "SUCCESS" },
      ]);
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.unproven,
      ]);
      expect(result.violations[0].message).toMatch(/did not report/i);
    });

    it("stays silent about a check that is genuinely RED", () => {
      // required-and-red is the loud case; it needs no help from this arm.
      const result = mod.evaluateVacuousChecks(declarationWith(), [
        {
          name: CODERABBIT,
          state: "FAILURE",
          description: "Changes requested",
        },
      ]);
      expect(result.violations).toEqual([]);
    });

    it("reports a check still PENDING rather than calling it proof", () => {
      const result = mod.evaluateVacuousChecks(declarationWith(), [
        { name: CODERABBIT, state: "PENDING", description: "Review queued" },
      ]);
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.unproven,
      ]);
    });

    it("ignores every check the repository has not declared evidence-bearing", () => {
      // Most CI jobs ship an empty description; flagging them all would be
      // noise, and the obvious fix for a noisy guard is to delete it.
      const result = mod.evaluateVacuousChecks(
        declarationWith({ evidence_bearing_checks: {} }),
        [
          { name: "🔍 Quality Checks / 🧹 Lint", state: "SUCCESS" },
          {
            name: CODERABBIT,
            state: "SUCCESS",
            description: RATE_LIMITED,
          },
        ]
      );
      expect(result.violations).toEqual([]);
      expect(result.checked).toBe(0);
    });

    it("matches the check NAME with exact string equality", () => {
      // The sibling rules compare contexts byte for byte for the same reason:
      // repos carry confusable pairs, and a fuzzy match raises a false alarm.
      const result = mod.evaluateVacuousChecks(declarationWith(), [
        {
          name: "CodeRabbit (legacy)",
          state: "SUCCESS",
          description: RATE_LIMITED,
        },
      ]);
      expect(result.violations.map(violation => violation.kind)).toEqual([
        mod.VIOLATIONS.unproven,
      ]);
      expect(result.violations[0].message).toMatch(/did not report/i);
    });

    it("answers nothing at all when no check is declared evidence-bearing", () => {
      const result = mod.evaluateVacuousChecks(
        { required_contexts: [], workflows: [], skip_job_declarations: {} },
        [
          {
            name: CODERABBIT,
            state: "SUCCESS",
            description: RATE_LIMITED,
          },
        ]
      );
      expect(result.violations).toEqual([]);
    });
  });

  describe("a finding names the commit it was read at", () => {
    // MEASURED (CodySwannGT/lisa#3221): a status description is a property of a
    // SHA, not of a pull request. Two readers quoted the same PR's CodeRabbit
    // verdict confidently and disagreed — one had read the head, one a commit
    // pushed to the same branch moments later. Neither had misread anything;
    // both had omitted the only fact that reconciles them.

    it("names the head SHA in a vacuous finding", () => {
      const { violations } = mod.evaluateVacuousChecks(
        declarationWith(),
        [{ name: CODERABBIT, state: "SUCCESS", description: RATE_LIMITED }],
        { headSha: HEAD_SHA }
      );

      expect(violations[0]?.message).toContain(
        `Read at head commit ${HEAD_SHA}`
      );
    });

    it("names the head SHA in an unproven finding, and in an absent one", () => {
      // Both other outcomes carry evidence a reader may quote, so both have to
      // say where it came from — a citation on only the loudest finding is the
      // one nobody needed.
      const unproven = mod.evaluateVacuousChecks(
        declarationWith(),
        [{ name: CODERABBIT, state: "SUCCESS", description: "Something else" }],
        { headSha: HEAD_SHA }
      );
      const absent = mod.evaluateVacuousChecks(declarationWith(), [], {
        headSha: HEAD_SHA,
      });

      expect(unproven.violations[0]?.message).toContain(HEAD_SHA);
      expect(absent.violations[0]?.message).toContain(HEAD_SHA);
    });

    it("says the SHA is unresolved rather than omitting it", () => {
      // The anti-inertness clause. A finding with no SHA and a finding with an
      // unresolvable one must not read identically — silence is what let the
      // disagreement above happen in the first place.
      const { violations } = mod.evaluateVacuousChecks(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: RATE_LIMITED },
      ]);

      expect(violations[0]?.message).toContain("could NOT be resolved");
      expect(violations[0]?.message).not.toContain("Read at head commit");
    });

    it("renders the two citations distinguishably", () => {
      expect(mod.citeHeadSha(HEAD_SHA)).toContain(HEAD_SHA);
      expect(mod.citeHeadSha(undefined)).toContain("could NOT be resolved");
      expect(mod.citeHeadSha(undefined)).not.toContain("undefined");
    });
  });

  describe("the review gate: three states, never two", () => {
    // The owner's ruling on CodySwannGT/lisa#3221: CodeRabbit stays a required
    // context, and the gate waives when CodeRabbit ITSELF says it could not
    // review. Nothing blocks today; the gate becomes real the moment the
    // entitlement behind those two strings is fixed, with no code change.

    it("SATISFIED — the one description that means a review ran", () => {
      expect(
        mod.reviewGateState({
          present: true,
          state: "SUCCESS",
          description: COMPLETED,
        }).state
      ).toBe(mod.REVIEW_GATE_STATES.satisfied);
    });

    it("WAIVED — both measured entitlement strings, and nothing else", () => {
      // 10 of 40 and 29 of 40 respectively. One condition reported two ways:
      // the bot claims `Plan: Pro Plus` while saying the free OSS reviews are
      // exhausted, so neither string is a limit the other is not.
      for (const description of [MANUAL_REQUIRED, "Review rate limited"]) {
        expect(
          mod.reviewGateState({ present: true, state: "SUCCESS", description })
            .state
        ).toBe(mod.REVIEW_GATE_STATES.waived);
      }
    });

    it("UNSATISFIED — absent, which is not the same as waived", () => {
      // Measured on #3221: 40 of 40 MERGE COMMITS carry no CodeRabbit status at
      // all. A gate that read absence as permission would pass forever the
      // first time somebody keyed it on the wrong commit — inert, and green.
      const verdict = mod.reviewGateState({ present: false });

      expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
      expect(verdict.why).toContain("ABSENT is not the same as waived");
    });

    it("UNSATISFIED — a review that ran and OBJECTED", () => {
      // No live example exists in this repository, which is exactly why it is
      // tested rather than assumed: an untested path is one nobody has watched
      // work, and this is the single case the whole gate exists to let through.
      const verdict = mod.reviewGateState({
        present: true,
        state: "FAILURE",
        description: "Review completed with blocking issues",
      });

      expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
      expect(verdict.why).toContain("RAN AND OBJECTED");
    });

    it("UNSATISFIED — an unrecognised description surfaces, never waives", () => {
      const verdict = mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: "Review deferred pending vendor maintenance",
      });

      expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
      expect(verdict.why).toContain("UNRECOGNISED");
    });

    it("does not waive on a SUBSTRING, which is where a loose list leaks", () => {
      // The asymmetry inverts here and this is the case that proves it. In the
      // report layer a `no_work` phrase matches loosely because matching DENIES
      // credit. In the gate a match GRANTS PERMISSION TO MERGE, so the same
      // looseness becomes the bypass — `no_work` contains bare "skipped", and a
      // completed review that skipped some files must not be waived by it.
      const verdict = mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: "Review completed, 3 generated files skipped",
      });

      expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
      expect(
        mod.classifyCheckDescription(
          "Review completed, 3 generated files skipped"
        )
      ).toBe("no-work");
    });

    it("lets a repository widen either list deliberately, by name", () => {
      const reading = {
        present: true,
        state: "SUCCESS",
        description: APPROVED,
      };

      expect(mod.reviewGateState(reading).state).toBe(
        mod.REVIEW_GATE_STATES.unsatisfied
      );
      expect(mod.reviewGateState(reading, { satisfy: [APPROVED] }).state).toBe(
        mod.REVIEW_GATE_STATES.satisfied
      );
    });

    it("reports a waiver as loudly as a block, and blocks only one of them", () => {
      // A waived pull request is an UNREVIEWED pull request. The waiver changes
      // the exit code, never the visibility — an operator must be able to see
      // it without reading raw commit statuses.
      const waived = mod.evaluateReviewGate(
        declarationWith(),
        [{ name: CODERABBIT, state: "SUCCESS", description: MANUAL_REQUIRED }],
        { headSha: HEAD_SHA }
      );

      expect(waived.violations).toHaveLength(1);
      expect(waived.violations[0]?.kind).toBe("review_evidence_waived");
      expect(waived.violations[0]?.message).toContain("UNREVIEWED");
      expect(waived.violations[0]?.message).toContain(HEAD_SHA);
      expect(mod.NEVER_BLOCKING).toContain("review_evidence_waived");
      expect(mod.REVIEW_GATE_BLOCKING).toContain("review_evidence_unsatisfied");
      expect(mod.REVIEW_GATE_BLOCKING).not.toContain("review_evidence_waived");
    });

    it("says nothing at all when the review genuinely ran", () => {
      // The negative control. Without it, a gate that flagged every reading
      // would satisfy every assertion above.
      const satisfied = mod.evaluateReviewGate(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: COMPLETED },
      ]);

      expect(satisfied.violations).toEqual([]);
      expect(satisfied.states[CODERABBIT]).toBe("satisfied");
      expect(satisfied.checked).toBe(1);
    });

    it("keeps the waiver list disjoint from the satisfaction list", () => {
      const overlap = mod.ENTITLEMENT_WAIVERS.filter(phrase =>
        mod.REVIEW_SATISFACTIONS.includes(phrase)
      );

      expect(overlap).toEqual([]);
    });
  });

  describe("this arm REPORTS and never blocks", () => {
    it("lists both vacuity kinds as never-blocking", () => {
      // Gating is downstream of an open owner decision, and a new blocking
      // check that fires on a vendor's BILLING state would be exactly wrong.
      expect(mod.NEVER_BLOCKING).toContain(mod.VIOLATIONS.vacuous);
      expect(mod.NEVER_BLOCKING).toContain(mod.VIOLATIONS.unproven);
    });

    it("never lets a kind be both always-blocking and never-blocking", () => {
      for (const kind of mod.NEVER_BLOCKING) {
        expect(mod.VIOLATIONS.suppressesRequired).not.toBe(kind);
        expect(mod.VIOLATIONS.remoteDrift).not.toBe(kind);
      }
    });
  });
});
