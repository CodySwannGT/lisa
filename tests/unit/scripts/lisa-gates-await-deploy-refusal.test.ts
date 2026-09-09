/**
 * A `required` gate awaiting a signal at a deploy moment must be REFUSED (#4046).
 *
 * A gate declared `required` at `pre-deploy:<env>` with an `await:` was
 * accepted by `validate`, skipped by the only executor that moment has, and
 * reported green. Reproduced from an injected config at `origin/main`
 * `8f4d34016`:
 *
 * ```
 *   🚦 Gates at pre-deploy:production:
 *     SKIPPED    required runtime-web-vulnerability   awaits "External DAST App"; no signal exists locally
 *   ✅ pre-deploy:production: 0 proved, 0 failed (optional), 0 not proved, 0 killed,
 *      1 not applicable here, of 1 gate(s) declared.          exit 0
 * ```
 *
 * The release the gate was declared to hold proceeds, and nothing on any
 * surface says the gate proved nothing. This is the failure the gate subsystem
 * exists to prevent, sited at the one moment family with no comparison surface
 * watching it.
 *
 * ## Why refusal is the remedy, and not a deploy-time reader
 *
 * An awaited signal has exactly one consumer in the tree:
 * `lisa-reconcile-policy.mjs`, which writes required status contexts onto a
 * BRANCH RULESET. A branch ruleset governs a merge. Its `moment` defaults to
 * `pull-request` and nothing else reads `contextsFor` for enforcement, so at a
 * deploy family the derivation has no consumer at all — verified against
 * `origin/main`, not inferred from the ticket. Refusing the declaration is
 * therefore consistent with how `push` is already handled: the moment cannot
 * keep the promise, so it does not accept it.
 *
 * ## The message may not blame a missing pull request
 *
 * `push` is refused with "there is no pull request yet for a signal to post
 * against". At a deploy moment that sentence is FALSE — a deploy has a commit
 * and, normally, a merged pull request behind it. An operator who reads it
 * concludes the declaration would work once merged, which is the opposite of
 * the truth. The families get their own reason.
 *
 * ## THE TRAP THIS SUITE EXISTS TO DEFEAT
 *
 * Both `NO_STATUS_MOMENTS` call sites compare the RAW moment key. Adding
 * `pre-deploy` to that list changes nothing, because the key under test is
 * `pre-deploy:production`. Measured by the #3650 agent: that mutation left all
 * 14 of its assertions green while the source appeared to implement the
 * refusal. Every assertion below is therefore keyed on a moment WITH an
 * environment suffix, so the naive fix cannot satisfy it — and
 * `the naive list-only fix cannot satisfy this suite` states that property
 * directly rather than leaving it to be noticed.
 * @module tests/unit/scripts/lisa-gates-await-deploy-refusal
 */

import { describe, expect, it } from "vitest";

import {
  MOMENT_FAMILIES,
  momentFamily,
  REGISTRY,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** An external signal name no shipped registry entry can collide with. */
const SIGNAL = "External DAST App";

/** The moment the reproduction in #4046 was measured at. */
const PRE_DEPLOY_PROD = "pre-deploy:production";

/** The `post-deploy` moment every family sweep below names explicitly. */
const POST_DEPLOY_PROD = "post-deploy:production";

/**
 * One concrete moment per family, environment suffix included.
 *
 * The suffix is the point. A bare family name would be satisfiable by a fix
 * that adds the family to a list compared against the raw key, which is the
 * measured trap this suite is built to fail against.
 */
const DEPLOY_MOMENTS = [
  PRE_DEPLOY_PROD,
  "pre-deploy:staging",
  POST_DEPLOY_PROD,
  "continuous:staging",
] as const;

/** The gate the reproduction used: legal at every deploy family, no toolchain. */
const DEPLOY_GATE = "runtime-web-vulnerability";

/**
 * The problems `validate` reports for one gate awaiting a signal at one moment.
 *
 * @param id - The gate id
 * @param moment - The moment key, environment suffix and all
 * @returns The problem strings, empty when the declaration is accepted
 */
function awaitProblems(id: string, moment: string): string[] {
  return validateGates({
    [id]: { [moment]: { level: "required", await: SIGNAL } },
  }) as string[];
}

/**
 * Every registry gate a declaration may legally name at one moment.
 *
 * @param moment - The moment key, environment suffix and all
 * @returns Gate ids, in registry order
 */
function gatesLegalAt(moment: string): string[] {
  const family = momentFamily(moment);
  return Object.entries(
    REGISTRY as Record<string, { moments: readonly string[] }>
  )
    .filter(([, definition]) => definition.moments.includes(family))
    .map(([id]) => id);
}

describe("an awaited signal is refused at every deploy-family moment", () => {
  it.each(DEPLOY_MOMENTS)("refuses an await at %s", moment => {
    expect(awaitProblems(DEPLOY_GATE, moment).join(" ")).toContain(
      "consumes an awaited signal"
    );
  });

  it.each(DEPLOY_MOMENTS)(
    "refuses it for EVERY gate legal at %s, not just the one measured",
    moment => {
      const legal = gatesLegalAt(moment);
      // A moment with nothing legal at it would make the sweep pass by being
      // empty, which is the shape of a control that stopped measuring.
      expect(legal.length).toBeGreaterThan(0);
      const accepted = legal.filter(
        id => awaitProblems(id, moment).length === 0
      );
      expect(accepted).toEqual([]);
    }
  );

  it("states the answer for each family rather than inferring it from pre-deploy", () => {
    // The AC asks for each family answered, not for pre-deploy generalised.
    // Hardcoded rather than derived from MOMENT_FAMILIES so that shrinking
    // that constant cannot silently shrink this assertion.
    for (const moment of [
      PRE_DEPLOY_PROD,
      POST_DEPLOY_PROD,
      "continuous:production",
    ]) {
      expect(awaitProblems(DEPLOY_GATE, moment).length).toBeGreaterThan(0);
    }
    expect(MOMENT_FAMILIES).toEqual([
      "pre-deploy",
      "post-deploy",
      "continuous",
    ]);
  });
});

describe("the refusal says why, and does not blame a missing pull request", () => {
  it("names the absent consumer as the reason", () => {
    expect(awaitProblems(DEPLOY_GATE, PRE_DEPLOY_PROD).join(" ")).toContain(
      "nothing at this moment consumes an awaited signal"
    );
  });

  it("does NOT claim there is no pull request, since a deploy has a commit", () => {
    expect(awaitProblems(DEPLOY_GATE, PRE_DEPLOY_PROD).join(" ")).not.toContain(
      "there is no pull request"
    );
  });

  it("keeps the missing-pull-request wording where it is still true", () => {
    // The negative control on the message split: `push` genuinely runs before
    // a pull request exists, and its reason must not be replaced with the new
    // one just because both refusals now share a helper.
    expect(awaitProblems("dead-code", "push").join(" ")).toContain(
      "there is no pull request yet for a signal to post against"
    );
  });
});

describe("the naive list-only fix cannot satisfy this suite", () => {
  it("keys every deploy assertion on a moment carrying an environment suffix", () => {
    // The measured trap: both NO_STATUS_MOMENTS call sites compare the raw
    // moment key, so adding a bare family name to that list refuses
    // `pre-deploy` and leaves `pre-deploy:production` accepted. Any suite whose
    // deploy cases used bare family names would go green against that mutation.
    for (const moment of DEPLOY_MOMENTS) {
      expect(moment).toContain(":");
      expect(momentFamily(moment)).not.toBe(moment);
    }
  });

  it("still refuses when the environment is one nobody enumerated", () => {
    // A refusal keyed on a list of known environments would pass the four
    // moments above and fail here. The family comparison is what makes the
    // environment irrelevant.
    expect(
      awaitProblems(DEPLOY_GATE, "pre-deploy:some-env-nobody-listed").join(" ")
    ).toContain("consumes an awaited signal");
  });
});

describe("rejection controls: what this refusal must NOT reach", () => {
  it("still accepts an await at pull-request, where a consumer exists", () => {
    // Without this the sweeps above would still pass if `await:` had been
    // refused everywhere, which would prove nothing about where it is targeted.
    expect(awaitProblems("code-review", "pull-request")).toEqual([]);
  });

  it("still accepts a deploy-moment gate that declares a run instead of an await", () => {
    // Only the awaited declaration loses its home. A deploy gate with a real
    // command still has an executor and must be untouched.
    expect(
      validateGates({
        [DEPLOY_GATE]: {
          [PRE_DEPLOY_PROD]: { level: "required", run: "echo probe" },
        },
      })
    ).toEqual([]);
  });

  it("still accepts a plain level at a deploy moment", () => {
    expect(
      validateGates({
        [DEPLOY_GATE]: { [PRE_DEPLOY_PROD]: "optional" },
      })
    ).toEqual([]);
  });
});
