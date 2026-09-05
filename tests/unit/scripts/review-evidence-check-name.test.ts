/**
 * Tests for what the review-evidence check ROW asserts, as opposed to what its
 * verdict says.
 *
 * The gate itself is not under test here and needs no change. It already has a
 * distinct third outcome, states the negative it is not making, names the
 * cause, and rules out the wrong investigation:
 *
 * ```
 * UNDETERMINED — the gate stopped waiting before review evidence settled, and
 * is NOT reporting that nobody reviewed: CodeRabbit had not settled when the
 * gate's wait EXPIRED — not observed to be unreviewed. RE-RUN this job; do not
 * investigate the change
 * ```
 *
 * MEASURED (CodySwannGT/lisa#3917): none of that reached the reader. The job
 * publishing it was named `🕵️ Did the required review checks do any work?` and
 * an unsatisfied verdict exits non-zero, so the row rendered
 *
 * ```
 * 🕵️ Did the required review checks do any work?   fail
 * ```
 *
 * **A yes/no question answered `fail` composes to "no."** The row therefore
 * asserted *the required review checks did no work* at exactly the moment the
 * verdict said it was NOT reporting that. A reader who was actively hunting
 * this class of defect read the row, believed the negative, and ranked "the
 * review genuinely did no work" first among the explanations — the name did
 * that, not the reader's care.
 *
 * THE DEFECT IS COMPOSITIONAL, so the assertions below are too. Pinning the
 * name as a string would pass against a rename to another question. What has to
 * hold is that the name and the conclusion the gate really publishes do not
 * combine into an answer the verdict denies, so the conclusion is read from
 * {@link reviewGateVerdict} rather than assumed.
 *
 * WHY THE NAME AND NOT THE CONCLUSION. The obvious alternative — publish
 * `UNDETERMINED` as `neutral` — does not reach this defect. `neutral` is chosen
 * by `REVIEW_VERDICT_CONCLUSIONS`, which governs the SEPARATE check run named
 * `🕵️ Review evidence verdict`; that name is already declarative and already
 * correct. The question-shaped name belongs to the workflow JOB, whose
 * conclusion is its exit code. Converting the map would recolour the row that
 * was right, leave the row that was wrong untouched, and demote the gate's
 * genuine `absent` and `objected` verdicts on the way past.
 *
 * AND THE RULE IS NARROWER THAN "NO QUESTIONS". A question-shaped name is safe
 * on a gate with two outcomes, because then `fail` really does establish the
 * negative. Audited at the time of writing, the other two question-named jobs
 * in this repository are both two-valued and both correct: `🧬 Did the mutation
 * gate measure anything?` runs only on a proven measurement and is `skipped`
 * otherwise, so it has no failure path at all, and `🕵️ Was this head reviewed,
 * or reviewed for?` exits non-zero only on a settled `unsatisfied` outcome, with
 * no settle-wait and no undetermined state to manufacture a third. This gate is
 * the only one of the three carrying a settle-timeout, and the settle-timeout is
 * what produces the third outcome. Re-run that audit rather than trusting this
 * paragraph; an allowlist of "these are fine" is the shape a later change walks
 * out of unnoticed.
 *
 * @module tests/unit/scripts/review-evidence-check-name
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { loadWorkflow } from "../../helpers/workflow-test-utils.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

/**
 * Both copies of the workflow, because the seed is what consumers install.
 *
 * Lisa's own copy is the one that measured the defect; the seed is the one that
 * ships it onward. Fixing either alone leaves the composition live somewhere.
 */
const WORKFLOWS = Object.freeze([
  ".github/workflows/review-evidence.yml",
  "typescript/create-only/.github/workflows/review-evidence.yml",
]);

/** The job whose name is the check row a merge decision reads. */
const JOB_ID = "vacuity";

const CODERABBIT = "CodeRabbit";

/**
 * The guard exports this suite consumes.
 *
 * The two token maps are declared by the exact members used rather than as
 * `Record<string, string>`, so `noUncheckedIndexedAccess` does not widen them
 * to `string | undefined` at the point they build a reading.
 */
interface GuardModule {
  readonly REVIEW_GATE_STATES: { readonly unsatisfied: string };
  readonly REVIEW_GATE_CONDITIONS: { readonly undetermined: string };
  reviewGateVerdict(reading?: {
    states?: Record<string, string>;
    conditions?: Record<string, string>;
    descriptions?: Record<string, string>;
  }): { verdict: string; conclusion: string; title: string };
  evaluateReviewGate(
    declaration: Record<string, unknown>,
    checks: readonly {
      name: string;
      state: string;
      description?: string;
    }[]
  ): {
    states: Record<string, string>;
    descriptions: Record<string, string>;
  };
}

/**
 * Strips the decoration a check name carries so the sentence can be read.
 *
 * Names in this repository lead with an emoji and a space. That is presentation
 * and must not change whether the name parses as a question.
 * @param name - The published check-row name
 * @returns The name reduced to its words and terminal punctuation
 */
function sentenceOf(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}\s?,'-]/gu, "")
    .trim()
    .toLowerCase();
}

/**
 * The auxiliaries that open a yes/no question in English.
 *
 * Kept alongside the `?` test rather than in place of it: a name can be phrased
 * as a question and lose its question mark to a style pass, and it would still
 * compose the same way in a reader's head.
 */
const INTERROGATIVE_OPENERS = Object.freeze([
  "did",
  "does",
  "do",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "who",
  "what",
  "when",
  "where",
  "why",
  "how",
]);

/**
 * True when the name asks the reader a question rather than making a claim.
 * @param name - The published check-row name
 * @returns Whether the row's name is interrogative
 */
function isInterrogative(name: string): boolean {
  const sentence = sentenceOf(name);
  const [opener = ""] = sentence.split(/\s+/u);
  return sentence.endsWith("?") || INTERROGATIVE_OPENERS.includes(opener);
}

/**
 * How a reader composes one check row into a belief.
 *
 * This is the defect modelled directly. A declarative name plus `failure` reads
 * as "this was not established", which is true of every unsatisfied verdict the
 * gate reaches. An interrogative name plus `failure` reads as a positive
 * assertion of the negative — safe only when the gate actually established it.
 * @param name - The published check-row name
 * @param conclusion - The conclusion published alongside it
 * @returns Whether the row asserts a negative answer to its own question
 */
function readsAsNegativeAnswer(name: string, conclusion: string): boolean {
  return isInterrogative(name) && conclusion === "failure";
}

/**
 * Reads the published name of the review-evidence job from a workflow.
 * @param relative - Repository-relative path to the workflow
 * @returns The job's `name:`, which is what GitHub renders as the check row
 */
function publishedJobName(relative: string): string {
  const workflow = loadWorkflow(path.join(REPO_ROOT, relative));
  const job = workflow.jobs?.[JOB_ID];
  expect(job, `${relative} must declare the \`${JOB_ID}\` job`).toBeDefined();
  const name = job?.name ?? "";
  expect(name, `${relative}: \`${JOB_ID}\` must publish a name`).not.toBe("");
  return name;
}

describe("the review-evidence check row (#3917)", () => {
  let mod: GuardModule;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    )) as unknown as GuardModule;
  });

  describe("the reading model this defect is defined in terms of", () => {
    it("reads a question answered `failure` as a negative answer", () => {
      // The composition that fired, reconstructed from the name that fired it.
      expect(
        readsAsNegativeAnswer(
          "🕵️ Did the required review checks do any work?",
          "failure"
        )
      ).toBe(true);
    });

    it("reads a declarative name answered `failure` as an unmet claim", () => {
      // The same conclusion, carrying no assertion about what was observed.
      expect(
        readsAsNegativeAnswer("🕵️ Required review checks did work", "failure")
      ).toBe(false);
    });

    it("does not depend on the emoji or the question mark alone", () => {
      // Presentation must not decide it, and neither must one punctuation mark.
      expect(
        isInterrogative("Did the required review checks do any work")
      ).toBe(true);
      expect(isInterrogative("🕵️ Required review checks did work")).toBe(false);
    });
  });

  describe("the verdict the row has to carry", () => {
    it("publishes an expired wait as `failure` while denying the negative", () => {
      // Read from the guard, not assumed: this is the input to the composition,
      // and it is deliberately unchanged by this fix. Failing closed is right —
      // an expired wait has not established that a review happened.
      const undetermined = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.unsatisfied },
        conditions: { [CODERABBIT]: mod.REVIEW_GATE_CONDITIONS.undetermined },
      });

      expect(undetermined.conclusion).toBe("failure");
      expect(undetermined.title).toContain("UNDETERMINED");
      expect(undetermined.title).toContain(
        "is NOT reporting that nobody reviewed"
      );
    });
  });

  describe("so the row must not answer the question the verdict refuses", () => {
    it.each(WORKFLOWS)("%s does not name the job as a question", relative => {
      expect(
        isInterrogative(publishedJobName(relative)),
        `${relative}: a question-shaped name cannot carry this gate's three outcomes`
      ).toBe(false);
    });

    it.each(WORKFLOWS)(
      "%s does not compose UNDETERMINED into a false negative",
      relative => {
        const undetermined = mod.reviewGateVerdict({
          states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.unsatisfied },
          conditions: { [CODERABBIT]: mod.REVIEW_GATE_CONDITIONS.undetermined },
        });
        const name = publishedJobName(relative);

        expect(
          readsAsNegativeAnswer(name, undetermined.conclusion),
          `${relative}: "${name}" + \`${undetermined.conclusion}\` asserts the review checks did no work, which this verdict explicitly denies`
        ).toBe(false);
      }
    );
  });

  describe("and it can still report a real absence", () => {
    // THIS PASSES IN BOTH STATES BY DESIGN. It is the control on the fix rather
    // than on the defect: a rename that made the gate unable to report a
    // genuinely unreviewed pull request would be worse than the composition it
    // removed. Nothing here touches severity, and this is what says so.
    it("renders a genuinely unreviewed pull request as a failure", () => {
      const declaration = {
        required_contexts: [CODERABBIT],
        workflows: [".github/workflows/ci.yml"],
        skip_job_declarations: {},
        evidence_bearing_checks: { [CODERABBIT]: {} },
      };
      const gate = mod.evaluateReviewGate(declaration, [
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

      expect(rendered.conclusion).toBe("failure");
      expect(rendered.title).toContain("UNREVIEWED");
      expect(rendered.title).not.toContain("UNDETERMINED");
    });

    it("keeps a declarative name honest about that failure", () => {
      // The other half of the same guarantee: `failure` on a declarative name
      // still reports the absence, it just stops asserting it as an answer.
      for (const relative of WORKFLOWS) {
        const name = publishedJobName(relative);
        expect(readsAsNegativeAnswer(name, "failure")).toBe(false);
        expect(isInterrogative(name)).toBe(false);
      }
    });
  });
});
