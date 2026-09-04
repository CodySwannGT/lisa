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
  readonly REVIEW_GATE_CONDITIONS: Record<string, string>;
  reviewGateState(
    reading: {
      present: boolean;
      state?: string;
      description?: string;
      waitExpired?: boolean;
    },
    vocabulary?: { waive?: readonly string[]; satisfy?: readonly string[] }
  ): { state: string; condition: string; why: string };
  evaluateReviewGate(
    declaration: Record<string, unknown>,
    checks: readonly CheckRow[],
    options?: { headSha?: string; waitExpired?: boolean }
  ): {
    violations: Violation[];
    states: Record<string, string>;
    conditions: Record<string, string>;
    descriptions: Record<string, string>;
    checked: number;
  };
  fetchSettledChecks(
    declaration: Record<string, unknown>,
    pr: string | number,
    repo: string | undefined,
    options?: {
      timeoutSeconds?: number;
      intervalSeconds?: number;
      fetch?: (
        pr: string | number,
        repo: string | undefined,
        headSha: string | undefined
      ) => readonly CheckRow[];
      now?: () => number;
      sleep?: (ms: number) => void;
      headSha?: (
        pr: string | number,
        repo: string | undefined
      ) => string | undefined;
    }
  ): { checks: CheckRow[]; settled: boolean; headSha: string | undefined };
  readonly REVIEW_VERDICT_CONCLUSIONS: Record<string, string>;
  readonly REVIEW_VERDICT_TITLE_LIMIT: number;
  reviewGateVerdict(reading?: {
    states?: Record<string, string>;
    conditions?: Record<string, string>;
    descriptions?: Record<string, string>;
    refusal?: { kind: string } | null;
    waiveRate?: { waived: number; sampled: number };
    carried?: {
      unreviewed?: readonly string[];
      reviewed?: number;
      unread?: string;
    };
  }): { verdict: string; conclusion: string; title: string };
  readonly CARRIED_PULL_REQUEST_LIMIT: number;
  evaluateCarriedReview(
    declaration: Record<string, unknown>,
    carried: readonly {
      number: number | string;
      headSha?: string;
      checks?: readonly CheckRow[];
      unreadable?: string;
    }[]
  ): { violations: Violation[]; unreviewed: string[]; reviewed: number };
  readCarriedReview(
    declaration: Record<string, unknown>,
    pr: string | number,
    repo?: string,
    options?: {
      fetchCarried?: (
        pr: string | number,
        repo?: string
      ) => { number: number; headSha: string }[];
      fetchCarriedChecks?: (sha: string, repo?: string) => CheckRow[];
    }
  ): {
    violations: Violation[];
    unreviewed: string[];
    reviewed: number;
    unread?: string;
  };
  summarizeWaiveRate(samples: readonly Record<string, string>[]): {
    sampled: number;
    waived: number;
    satisfied: number;
    unsatisfied: number;
  };
  sampleWaiveRate(
    declaration: Record<string, unknown>,
    limit: number,
    repo?: string,
    fetch?: (limit: number, repo?: string) => CheckRow[][]
  ):
    | {
        sampled: number;
        waived: number;
        satisfied: number;
        unsatisfied: number;
      }
    | undefined;
  writeVerdictOutputs(
    verdict: { verdict: string; conclusion: string; title: string },
    env?: NodeJS.ProcessEnv
  ): boolean;
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
 * The measured base-branch string, byte-exact off #3632 / #3633 / #3634 / #3636.
 *
 * All four reported `state: success` carrying this, all four merged into a
 * batching branch no ruleset watches, and all four reached the default branch
 * inside one integration pull request whose own review had completed.
 */
const BASE_BRANCH_DISABLED =
  "Review skipped: reviews are disabled for this base branch";

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

  describe("a waived gate must not render the way a satisfied one renders (#3639)", () => {
    // MEASURED 2026-09-03. `Review rate limited` is an EXPLICIT waiver with a
    // written rationale, and that rationale stands: a pull-request author
    // cannot fix a vendor's billing state, and a gate that reddened every pull
    // request on one would be worse than no gate. What was defective is that
    // "loud and nonblocking" was not loud. The job exited 0 for a waiver and 0
    // for a satisfaction, so at the only layer a merge decision consults:
    //
    //     🕵️ Did the required review checks do any work?   pass
    //     CodeRabbit                                        pass
    //
    // Both hollow. Seven pull requests merged on that pair in one afternoon
    // (#3632, #3633, #3634, #3636, #3637, #3647) and shipped in v4.33.0 and
    // v4.33.1. The guard's own header had already measured 39 of the last 40
    // merged pull requests waiving — a default path wearing the success path's
    // clothes.

    it("gives a WAIVED verdict a different conclusion from a SATISFIED one", () => {
      // THE regression. Before #3639 there was no verdict to compare: both
      // states left the job at exit 0 and there was nothing else to read.
      const waived = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.waived },
        descriptions: { [CODERABBIT]: RATE_LIMITED },
      });
      const satisfied = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.satisfied },
        descriptions: { [CODERABBIT]: COMPLETED },
      });

      expect(waived.conclusion).not.toBe(satisfied.conclusion);
      expect(waived.conclusion).toBe("neutral");
      expect(satisfied.conclusion).toBe("success");
    });

    it("says WAIVED and UNREVIEWED in the title, not only in the log", () => {
      // A log is not a control. The title is what a check run renders, which is
      // what somebody reads at the moment they decide to merge.
      const waived = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.waived },
        descriptions: { [CODERABBIT]: RATE_LIMITED },
      });

      expect(waived.verdict).toBe(mod.REVIEW_GATE_STATES.waived);
      expect(waived.title).toContain("WAIVED");
      expect(waived.title).toContain("UNREVIEWED");
      expect(waived.title).toContain(RATE_LIMITED);
    });

    it("keeps the waiver NONBLOCKING while making it visible", () => {
      // The fence keeps its reason. `neutral` is neither a pass nor a failure:
      // `gh pr checks` buckets it as `skipping`, contributing no failure to its
      // exit code and no satisfied context to branch protection.
      expect(mod.REVIEW_VERDICT_CONCLUSIONS.waived).toBe("neutral");
      expect(mod.REVIEW_VERDICT_CONCLUSIONS.waived).not.toBe("failure");
      expect(mod.NEVER_BLOCKING).toContain(mod.VIOLATIONS.reviewWaived);
    });

    it("renders every non-satisfied state as its own conclusion", () => {
      // Four states, four renderings. Collapsing any pair reintroduces exactly
      // the indistinguishability this fixes, one state over.
      const conclusions = [
        mod.reviewGateVerdict({
          states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.satisfied },
        }).conclusion,
        mod.reviewGateVerdict({
          states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.waived },
        }).conclusion,
        mod.reviewGateVerdict({
          states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.unsatisfied },
        }).conclusion,
      ];

      expect(conclusions).toEqual(["success", "neutral", "failure"]);
    });

    it("does not render a refusal as anything a merge could read as clean", () => {
      // NOBODY LOOKED and THE REVIEW WAS FAKE are opposite facts, and neither
      // is a pass.
      const refused = mod.reviewGateVerdict({
        refusal: { kind: "vacuity_unresolved_pr" },
      });

      expect(refused.verdict).toBe("uninspected");
      expect(refused.conclusion).toBe("failure");
      expect(refused.title).toContain("NOT INSPECTED");
      expect(refused.title).toContain("vacuity_unresolved_pr");
    });

    it("takes the WORST state when one check waives and another satisfies", () => {
      const mixed = mod.reviewGateVerdict({
        states: {
          [CODERABBIT]: mod.REVIEW_GATE_STATES.satisfied,
          Other: mod.REVIEW_GATE_STATES.waived,
        },
        descriptions: { [CODERABBIT]: COMPLETED, Other: RATE_LIMITED },
      });

      expect(mixed.conclusion).toBe("neutral");
      expect(mixed.title).toContain("Other");
    });

    it("fails CLOSED at the rendering layer for an unrecognised description", () => {
      // The allowlist arm, pinned where it is now VISIBLE. Four distinct
      // vacuous descriptions appeared in one afternoon; enumerating bad strings
      // goes stale, so anything that is not positively a known-good "a review
      // ran" form has to render as a failure, not as a pass.
      const gate = mod.evaluateReviewGate(declarationWith(), [
        {
          name: CODERABBIT,
          state: "SUCCESS",
          description:
            "Review skipped: reviews are disabled for this base branch",
        },
      ]);
      const rendered = mod.reviewGateVerdict({
        states: gate.states,
        descriptions: gate.descriptions,
      });

      expect(gate.states[CODERABBIT]).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
      expect(rendered.conclusion).toBe("failure");
      expect(rendered.title).toContain("UNREVIEWED");
      expect(rendered.title).toContain("disabled for this base branch");
    });

    it("does not say a check REPORTED when it posted nothing", () => {
      // MEASURED on this fix's own first commit: the published verdict read
      // `UNREVIEWED — review evidence unsatisfied: CodeRabbit reported ""`,
      // which asserts a report that never happened. `absent` and `reported an
      // empty description` are different facts and the file turns on the
      // difference — a verdict that blurs them reintroduces the collapse one
      // layer out from where it was just fixed.
      const gate = mod.evaluateReviewGate(declarationWith(), []);
      const rendered = mod.reviewGateVerdict({
        states: gate.states,
        descriptions: gate.descriptions,
      });

      expect(gate.states[CODERABBIT]).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
      expect(rendered.title).toContain("posted NO review status at all");
      expect(rendered.title).not.toContain('reported ""');
    });

    it("still quotes a genuinely EMPTY description as a report", () => {
      // The negative control for the case above. A check that reported and said
      // nothing has still reported, and must not be rendered as absent.
      const gate = mod.evaluateReviewGate(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: "" },
      ]);
      const rendered = mod.reviewGateVerdict({
        states: gate.states,
        descriptions: gate.descriptions,
      });

      expect(rendered.title).toContain('reported ""');
      expect(rendered.title).not.toContain("posted NO review status");
    });

    it("carries the description a verdict was read from, not just the state", () => {
      // Without this a title could say WAIVED and not say by which sentence,
      // which is the fact that decides whether to wait for the entitlement.
      const gate = mod.evaluateReviewGate(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: MANUAL_REQUIRED },
      ]);

      expect(gate.descriptions[CODERABBIT]).toBe(MANUAL_REQUIRED);
    });

    it("flattens a title to ONE line and fits a check-run output title", () => {
      // Correctness, not tidiness. This string is written to `$GITHUB_OUTPUT`
      // as `key=value`, and a description is arbitrary vendor text: a newline
      // in it would end the assignment and let the remainder be parsed as more
      // output keys.
      const hostile = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.waived },
        descriptions: {
          [CODERABBIT]: `Review rate limited\nreview_evidence_conclusion=success\n${"x".repeat(400)}`,
        },
      });

      expect(hostile.title).not.toContain("\n");
      expect(hostile.title.length).toBeLessThanOrEqual(
        mod.REVIEW_VERDICT_TITLE_LIMIT
      );
    });
  });

  describe("the waive rate is emitted, not commented (#3639)", () => {
    // The 39-of-40 number already existed — in a comment at the top of the
    // workflow — and changed nothing for the eight months it sat there. A rate
    // an operator reads at merge time is a different artefact from a rate
    // somebody once measured.

    it("counts worst-wins per pull request", () => {
      const tally = mod.summarizeWaiveRate([
        { [CODERABBIT]: "satisfied" },
        { [CODERABBIT]: "waived" },
        { [CODERABBIT]: "waived" },
        { [CODERABBIT]: "satisfied", Other: "unsatisfied" },
      ]);

      expect(tally).toEqual({
        sampled: 4,
        satisfied: 1,
        waived: 2,
        unsatisfied: 1,
      });
    });

    it("does not count a pull request it could read nothing for", () => {
      // A denominator that absorbs unreadable pull requests reports a LOWER
      // waive rate than the truth — the direction that makes the number
      // reassuring instead of useful.
      const tally = mod.summarizeWaiveRate([{}, { [CODERABBIT]: "waived" }]);

      expect(tally.sampled).toBe(1);
      expect(tally.waived).toBe(1);
    });

    it("appends the rate to a waived title", () => {
      const waived = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.waived },
        descriptions: { [CODERABBIT]: RATE_LIMITED },
        waiveRate: { waived: 39, sampled: 40 },
      });

      expect(waived.title).toContain("39 of the last 40");
    });

    it("claims no rate at all when nothing was sampled", () => {
      const waived = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.waived },
        descriptions: { [CODERABBIT]: RATE_LIMITED },
        waiveRate: { waived: 0, sampled: 0 },
      });

      expect(waived.title).not.toContain("of the last");
    });

    it("is OFF unless a positive sample size is asked for", () => {
      const thrower = (): CheckRow[][] => {
        throw new Error("the sampler must not have been called");
      };

      expect(
        mod.sampleWaiveRate(declarationWith(), 0, undefined, thrower)
      ).toBe(undefined);
      expect(
        mod.sampleWaiveRate(declarationWith(), -1, undefined, thrower)
      ).toBe(undefined);
    });

    it("summarises a sample through the same gate the verdict uses", () => {
      const tally = mod.sampleWaiveRate(declarationWith(), 3, undefined, () => [
        [{ name: CODERABBIT, state: "SUCCESS", description: COMPLETED }],
        [{ name: CODERABBIT, state: "SUCCESS", description: RATE_LIMITED }],
        [{ name: CODERABBIT, state: "SUCCESS", description: MANUAL_REQUIRED }],
      ]);

      expect(tally).toEqual({
        sampled: 3,
        satisfied: 1,
        waived: 2,
        unsatisfied: 0,
      });
    });

    it("never lets a failed sample change the verdict", () => {
      // The rate is CONTEXT for a decision already taken from this pull
      // request's own evidence. An unreachable API costs one sentence, not a
      // red build — and the missing sentence is the honest rendering of "not
      // measured".
      const tally = mod.sampleWaiveRate(
        declarationWith(),
        40,
        undefined,
        () => {
          throw new Error("gh: API rate limit exceeded");
        }
      );

      expect(tally).toBe(undefined);
    });
  });

  describe("an expired wait is not an observation (#3716)", () => {
    /**
     * Drives the settle loop with a scripted sequence of reads and a fake clock.
     *
     * `sleep` advances the same clock `now` reads, so the loop's real 300s
     * ceiling is exercised without the suite waiting for any of it.
     *
     * @param reads - One check roster per poll; the last repeats once exhausted
     * @returns The loop's result plus how many polls it took
     */
    function settleWith(reads: readonly (readonly CheckRow[])[]) {
      let clock = 0;
      let polls = 0;
      const result = mod.fetchSettledChecks(declarationWith(), "1", undefined, {
        timeoutSeconds: 300,
        intervalSeconds: 15,
        now: () => clock,
        sleep: (ms: number) => {
          clock += ms;
        },
        headSha: () => HEAD_SHA,
        fetch: () => {
          const roster = reads[Math.min(polls, reads.length - 1)];
          polls += 1;
          return roster;
        },
      });
      return { ...result, polls };
    }

    const pendingRow: CheckRow = {
      name: CODERABBIT,
      state: "PENDING",
      bucket: "pending",
    };
    // `Review completed` rather than `Review approved`: the former is in the
    // shipped satisfy vocabulary, the latter is only satisfying where a
    // declaration names it, and this case is about the WAIT, not the phrase.
    const completedRow: CheckRow = {
      name: CODERABBIT,
      state: "SUCCESS",
      bucket: "pass",
      description: COMPLETED,
    };

    // REGRESSION GUARD, NOT A DISCRIMINATOR. The settle loop already waits, and
    // this passes with or without the rest of this commit — it is here because
    // nothing covered `fetchSettledChecks` at all, which is how a defect about
    // waiting shipped past a suite of 52 tests.
    it("waits through a pending review and reads the success that follows", () => {
      const settled = settleWith([[pendingRow], [pendingRow], [completedRow]]);

      expect(settled.settled).toBe(true);
      expect(settled.polls).toBeGreaterThan(1);
      const gate = mod.evaluateReviewGate(declarationWith(), settled.checks, {
        waitExpired: settled.settled === false,
      });
      expect(gate.states[CODERABBIT]).toBe(mod.REVIEW_GATE_STATES.satisfied);
    });

    it("gives up after the ceiling when the review never settles", () => {
      const settled = settleWith([[pendingRow]]);

      expect(settled.settled).toBe(false);
    });

    it("reports an expired wait on an absent check as undetermined, not absent", () => {
      const verdict = mod.reviewGateState({
        present: false,
        waitExpired: true,
      });

      expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
      expect(verdict.condition).toBe(mod.REVIEW_GATE_CONDITIONS.undetermined);
      expect(verdict.why).toContain("EXPIRED");
      // The sentence this replaces sent operators to audit the change.
      expect(verdict.why).not.toContain(
        "did not report on this pull request at all"
      );
    });

    it("reports an expired wait on a pending check as undetermined, not pending", () => {
      const verdict = mod.reviewGateState({
        present: true,
        state: "PENDING",
        waitExpired: true,
      });

      expect(verdict.condition).toBe(mod.REVIEW_GATE_CONDITIONS.undetermined);
      // Which shape it expired on still has to survive: "never started" and
      // "started and ran long" are different things to go and look at.
      expect(verdict.why).toContain("PENDING");
    });

    it("keeps absent and pending for readings taken when the wait completed", () => {
      expect(mod.reviewGateState({ present: false }).condition).toBe(
        mod.REVIEW_GATE_CONDITIONS.absent
      );
      expect(
        mod.reviewGateState({ present: true, state: "PENDING" }).condition
      ).toBe(mod.REVIEW_GATE_CONDITIONS.pending);
    });

    it("publishes UNDETERMINED where a merge decision reads it", () => {
      const gate = mod.evaluateReviewGate(declarationWith(), [], {
        waitExpired: true,
      });
      const rendered = mod.reviewGateVerdict({
        states: gate.states,
        conditions: gate.conditions,
        descriptions: gate.descriptions,
      });

      expect(rendered.title).toContain("UNDETERMINED");
      expect(rendered.title).toContain("RE-RUN");
      // The exact sentence #3716 was filed about.
      expect(rendered.title).not.toContain("posted NO review status at all");
    });

    // THE CONTROL. A gate that waits and then passes would satisfy every test
    // above and be silently catastrophic, so the severity is pinned here.
    it("still BLOCKS an unreviewed pull request, however it is labelled", () => {
      for (const waitExpired of [false, true]) {
        const gate = mod.evaluateReviewGate(declarationWith(), [], {
          waitExpired,
        });
        const rendered = mod.reviewGateVerdict({
          states: gate.states,
          conditions: gate.conditions,
          descriptions: gate.descriptions,
        });

        expect(gate.states[CODERABBIT]).toBe(
          mod.REVIEW_GATE_STATES.unsatisfied
        );
        expect(rendered.conclusion).toBe(
          mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied
        );
      }
    });

    it("leads with UNREVIEWED when a real objection sits beside a slow reviewer", () => {
      const rendered = mod.reviewGateVerdict({
        states: {
          [CODERABBIT]: mod.REVIEW_GATE_STATES.unsatisfied,
          Other: mod.REVIEW_GATE_STATES.unsatisfied,
        },
        conditions: {
          [CODERABBIT]: mod.REVIEW_GATE_CONDITIONS.undetermined,
          Other: mod.REVIEW_GATE_CONDITIONS.objected,
        },
        descriptions: { Other: "Changes requested" },
      });

      expect(rendered.title).toContain("UNREVIEWED");
      expect(rendered.title).not.toContain("UNDETERMINED");
    });

    it("does not relabel a check that settled while another was still late", () => {
      // `waitExpired` is a property of the WAIT, not of this check. One that
      // reached a terminal read keeps its own verdict.
      expect(
        mod.reviewGateState(
          { present: true, state: "SUCCESS", description: APPROVED },
          { satisfy: [APPROVED] }
        ).state
      ).toBe(mod.REVIEW_GATE_STATES.satisfied);
      expect(
        mod.reviewGateState({
          present: true,
          state: "SUCCESS",
          description: RATE_LIMITED,
          waitExpired: true,
        }).condition
      ).toBe(mod.REVIEW_GATE_CONDITIONS.waived);
      expect(
        mod.reviewGateState({
          present: true,
          state: "FAILURE",
          waitExpired: true,
        }).condition
      ).toBe(mod.REVIEW_GATE_CONDITIONS.objected);
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
      }
    });
  });

  describe("the pull requests a batch CARRIES (#3658)", () => {
    /**
     * One constituent row, as the carried arm consumes it.
     *
     * @param number - The carried pull request number
     * @param description - What its CodeRabbit status said
     * @returns One entry for `evaluateCarriedReview`
     */
    const constituent = (number: number, description: string) => ({
      number,
      headSha: HEAD_SHA,
      checks: [{ name: CODERABBIT, state: "SUCCESS", description }],
    });

    it("does not render a batch carrying an UNREVIEWED pull request the way it renders a reviewed one", () => {
      // THE regression, and the shape #3639 fixed one level down. MEASURED
      // 2026-09-03: an integration pull request whose OWN review completed
      // carried four constituents that each reported the base-branch string.
      // Every constituent's own gate went red on its own pull request, on a
      // branch outside every ruleset ref condition, so the red changed nothing
      // — and the batch that carried all four into the default branch rendered
      // `success`, character for character what a fully reviewed batch renders.
      const own = mod.evaluateReviewGate(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: COMPLETED },
      ]);
      const carried = mod.evaluateCarriedReview(declarationWith(), [
        constituent(3632, BASE_BRANCH_DISABLED),
        constituent(3629, COMPLETED),
      ]);

      const batch = mod.reviewGateVerdict({
        states: own.states,
        descriptions: own.descriptions,
        carried,
      });
      const reviewed = mod.reviewGateVerdict({
        states: own.states,
        descriptions: own.descriptions,
        carried: { unreviewed: [], reviewed: 2 },
      });

      expect(reviewed.conclusion).toBe("success");
      expect(batch.conclusion).not.toBe(reviewed.conclusion);
      expect(batch.conclusion).toBe("neutral");
      expect(batch.title).toContain("UNREVIEWED");
      expect(batch.title).toContain("#3632");
    });

    it("refuses to render a green batch from the RENDERER alone", () => {
      // Deliberately built by hand rather than through the carried arm. Every
      // other case in this block would fail on a tree where the arm is simply
      // ABSENT, which proves a symbol exists rather than that a behaviour
      // changed. This one calls only `reviewGateVerdict`, which already
      // shipped, hands it a batch tally, and pins that the tally is READ: on
      // the code this replaces, the identical call returns `success`.
      const green = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.satisfied },
        descriptions: { [CODERABBIT]: COMPLETED },
        carried: { unreviewed: ["#3632", "#3636"], reviewed: 3 },
      });

      expect(green.conclusion).toBe("neutral");
      expect(green.verdict).toBe(mod.REVIEW_GATE_STATES.waived);
      expect(green.title).toContain("#3636");
    });

    it("names which constituents were carried unreviewed, not just how many", () => {
      // The acceptance criterion is that an operator inspecting a merged
      // integration pull request can tell WHICH constituents were read. A count
      // alone sends them back to the raw statuses, which is where the fact was
      // already lost.
      const carried = mod.evaluateCarriedReview(declarationWith(), [
        constituent(3632, BASE_BRANCH_DISABLED),
        constituent(3633, BASE_BRANCH_DISABLED),
        constituent(3629, COMPLETED),
      ]);

      expect(carried.unreviewed).toEqual(["#3632", "#3633"]);
      expect(carried.reviewed).toBe(1);
      expect(carried.violations).toHaveLength(2);
      expect(carried.violations[0]?.message).toContain("CARRIES #3632");
      expect(carried.violations[0]?.message).toContain(BASE_BRANCH_DISABLED);
    });

    it("counts an unreadable constituent AGAINST the batch", () => {
      // Refusing to report a clean scan that never ran. A constituent whose
      // evidence could not be fetched is not a reviewed one, and the arm whose
      // silence would read as approval is exactly the one that must not be
      // allowed to fall silent.
      const carried = mod.evaluateCarriedReview(declarationWith(), [
        { number: 3634, headSha: HEAD_SHA, unreadable: "gh: 404 Not Found" },
      ]);

      expect(carried.unreviewed).toEqual(["#3634"]);
      expect(carried.reviewed).toBe(0);
      expect(carried.violations[0]?.message).toContain("could NOT be read");
    });

    it("treats a batch it could not enumerate as unaccounted, never as clean", () => {
      const unread = mod.readCarriedReview(declarationWith(), 3637, "o/r", {
        fetchCarried: () => {
          throw new Error("gh: API rate limit exceeded");
        },
      });
      const own = mod.evaluateReviewGate(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: COMPLETED },
      ]);

      expect(unread.unread).toContain("rate limit");
      expect(
        mod.reviewGateVerdict({
          states: own.states,
          descriptions: own.descriptions,
          carried: unread,
        }).conclusion
      ).toBe("neutral");
    });

    it("leaves an ordinary pull request — one that carries nothing — untouched", () => {
      // The cost and the blast radius are both zero where there is no batch:
      // no constituents, no extra reads, and the same `success` as before.
      const own = mod.evaluateReviewGate(declarationWith(), [
        { name: CODERABBIT, state: "SUCCESS", description: COMPLETED },
      ]);
      const carried = mod.readCarriedReview(declarationWith(), 42, "o/r", {
        fetchCarried: () => [],
        fetchCarriedChecks: () => {
          throw new Error("must not be called when nothing is carried");
        },
      });

      expect(carried.unreviewed).toEqual([]);
      expect(carried.violations).toEqual([]);
      expect(
        mod.reviewGateVerdict({
          states: own.states,
          descriptions: own.descriptions,
          carried,
        }).conclusion
      ).toBe("success");
    });

    it("reports a batch past the cap as unread rather than as the part it read", () => {
      // A silently truncated scan is the fail-open this file exists to refuse.
      const many = Array.from(
        { length: mod.CARRIED_PULL_REQUEST_LIMIT + 1 },
        (_ignored, index) => ({ number: index + 1, headSha: HEAD_SHA })
      );
      const carried = mod.readCarriedReview(declarationWith(), 3637, "o/r", {
        fetchCarried: () => many,
        fetchCarriedChecks: () => [
          { name: CODERABBIT, state: "SUCCESS", description: COMPLETED },
        ],
      });

      expect(carried.unread).toContain(
        String(mod.CARRIED_PULL_REQUEST_LIMIT + 1)
      );
      expect(carried.reviewed).toBe(0);
    });

    it("reads each constituent at its OWN head, never at the batch's", () => {
      // A status description is not stable across commits, and the constituent
      // head is the commit branch protection recorded on the constituent. The
      // batch's head carries the MERGES and none of their review statuses,
      // which is why the existing one-commit read cannot see this at all.
      const seen: string[] = [];
      mod.readCarriedReview(declarationWith(), 3637, "o/r", {
        fetchCarried: () => [
          { number: 3632, headSha: "506c87ae" },
          { number: 3633, headSha: "59b19d2f" },
        ],
        fetchCarriedChecks: sha => {
          seen.push(sha);
          return [
            { name: CODERABBIT, state: "SUCCESS", description: COMPLETED },
          ];
        },
      });

      expect(seen).toEqual(["506c87ae", "59b19d2f"]);
    });

    it("reports the carried gap without ever blocking on it", () => {
      // The constituents\' own gates already reached the failing verdict where
      // the diff lives. Reddening the batch as well would fail a pull request
      // for a vendor condition its author cannot reach — the "gate that gets
      // deleted" failure this file names twice. Visibility, not enforcement.
      expect(mod.NEVER_BLOCKING).toContain(mod.VIOLATIONS.reviewCarried);
      expect(mod.REVIEW_GATE_BLOCKING).not.toContain(
        mod.VIOLATIONS.reviewCarried
      );
    });
  });
});
