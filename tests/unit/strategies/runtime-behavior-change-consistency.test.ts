/**
 * Internal-consistency coverage for the `runtime_behavior_change` contract —
 * the falsifiable half of the decidability suite.
 *
 * Read this together with `runtime-behavior-change-decidability.test.ts`. The
 * two files divide one contract along the axis that actually broke:
 *
 * - **Decidability (sibling file)** asserts the contract wording is *present*.
 *   That pins it against silent deletion or a lossy regeneration. Every
 *   assertion there is existential — "some copy says the right thing".
 * - **Consistency (this file)** asserts no copy says the *wrong* thing. Every
 *   assertion here is universal — quantified over every occurrence in the
 *   corpus, so a second copy cannot contradict the first.
 *
 * The distinction is not academic. The defect that produced this file shipped
 * twice. `lisa-linear-validate-issue` spelled the discriminator `` `None -` ``
 * in its execution step while its own gate S8 spelled it `` `None —` ``, and a
 * suite of 192 existential assertions stayed green through the mutation both
 * times: `toContain` is satisfied by any one correct occurrence, and so is a
 * regex for the correct sentence, because these files state the grammar twice.
 * The correct S8 copy vouched for the broken execution step.
 *
 * A validator whose execution step disagrees with its own documented gate
 * reads a correctly-exempt item as *underivable* — or, far worse in the other
 * direction, reads an absent section as `false`, which is exactly the silent
 * assumption that made S8, S11, S14, and S19 unauditable on a live item.
 *
 * **What this can and cannot prove.** `SKILL.md` *is* the validators'
 * execution substrate — `runtime_behavior_change` has no compiled artifact
 * underneath, so there is no function to call and no return value to assert.
 * These are still assertions over prose. What changed is the quantifier, and
 * that is the half that binds: a universal negative over the whole corpus
 * cannot be satisfied by a correct copy elsewhere in the file. Deletion is the
 * sibling file's job; contradiction is this one's. Neither catches an agent
 * that reads a correct instruction and disobeys it.
 * @module tests/unit/strategies/runtime-behavior-change-consistency
 */
import { describe, expect, it } from "vitest";

import {
  CONTRACT_SKILLS,
  RULE_ROOTS,
  SKILL_ROOTS,
  VALIDATORS,
  readRule,
  readSkill,
} from "./runtime-behavior-change-sources.js";

/** Every `` `None …` `` code span, tolerating a markdown line wrap inside it. */
const MARKER_SPAN = /`None[^`]*`/gs;

/** Every place the prose points at a missing declaration. */
const ABSENCE_SITE = /\babsent\b\W{0,4}\bsection\b/gi;

/**
 * Phrasings that read a missing declaration as `false`.
 *
 * Stated as a universal negative on purpose. The positive form — "the file
 * says underivable somewhere" — is what let the marker mutation through twice.
 */
const ABSENCE_AS_FALSE: readonly RegExp[] = [
  /\babsent\b\W{0,4}\bsection\b[^.\n]{0,30}?(?:\b(?:means|is|reads as)\b|→|=)\s*\*{0,2}`?false`?/i,
  /\babsence\b[^.\n]{0,30}?(?:\b(?:means|is|reads as)\b|→|=)\s*\*{0,2}`?false`?/i,
  /\bno section\b[^.\n]{0,30}?(?:\b(?:means|is|reads as)\b|→|=)\s*\*{0,2}`?false`?/i,
  /\|[^|\n]*\babsent\b[^|\n]*\|\s*\*{0,2}`?false`?\*{0,2}\s*\|/i,
];

/** Phrasings that hand authority back to the caller's assertion. */
const CALLER_BEATS_STORED: readonly RegExp[] = [
  /\bcallers?(?:'s|')?\b[^.\n]{0,60}?\b(?:is taken as given|takes precedence|is authoritative|is trusted|is believed)\b/i,
  /\basserted\b[^.\n]{0,40}?\bbeats\b[^.\n]{0,40}?\bpersisted\b/i,
];

/**
 * How many times each skill must state the absence rule.
 *
 * Two for a validator is load-bearing, not incidental: the gate prose and the
 * execution step each carry a copy, and that duplication is the structure the
 * marker bug hid in. Requiring both means neither can be quietly dropped, and
 * the per-site check below means neither can quietly disagree.
 */
const ABSENCE_SITE_MINIMUM: Readonly<Record<string, number>> = {
  "lisa-github-validate-issue": 2,
  "lisa-jira-validate-ticket": 2,
  "lisa-linear-validate-issue": 2,
  "lisa-github-write-issue": 1,
  "lisa-jira-write-ticket": 1,
  "lisa-linear-write-issue": 1,
  "lisa-implement": 1,
};

/** Characters of context a derivation site gets to resolve to a verdict. */
const SITE_WINDOW = 90;

/**
 * Collapse markdown line wrapping so a span split across lines compares
 * against the same literal as one written on a single line.
 * @param value - Raw matched text.
 * @returns The text with runs of whitespace collapsed to one space.
 */
const unwrap = (value: string): string => value.replace(/\s+/gu, " ");

/**
 * Every marker span in a document, unwrapped.
 * @param content - The document body.
 * @returns The normalized spans, in source order.
 */
const markerSpans = (content: string): readonly string[] =>
  [...content.matchAll(MARKER_SPAN)].map(match => unwrap(match[0]));

/**
 * Every absence-derivation site in a document, with its trailing context.
 * @param content - The document body.
 * @returns One window per site, in source order.
 */
const absenceWindows = (content: string): readonly string[] =>
  [...content.matchAll(ABSENCE_SITE)].map(match =>
    content.slice(match.index, match.index + SITE_WINDOW)
  );

describe("every declaration marker uses the em-dash discriminator", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(CONTRACT_SKILLS)("%s spells every marker `None —`", slug => {
      const spans = markerSpans(readSkill(root, slug));

      // Non-vacuity. A universal check over an empty corpus passes trivially,
      // which is the one way this assertion could rot into a no-op.
      expect(spans.length).toBeGreaterThan(0);

      for (const span of spans) expect(span).toMatch(/^`None —/u);
    });
  });
});

describe("every rule copy uses the em-dash discriminator", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    // #3992 demoted `derived-branch-plan` out of the eager tier, folding its
    // head into the reference body. One copy per root now, so the sweep runs
    // over the tier that has it — still every root, still a universal negative.
    it.each(["reference"] as const)("%s tier", tier => {
      const spans = markerSpans(readRule(root, tier));

      expect(spans.length).toBeGreaterThan(0);

      for (const span of spans) expect(span).toMatch(/^`None —/u);
    });
  });
});

describe("no copy reads an absent declaration as false", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(CONTRACT_SKILLS)("%s states the rule the same way twice", slug => {
      const content = readSkill(root, slug);
      const windows = absenceWindows(content);

      expect(windows.length).toBeGreaterThanOrEqual(
        ABSENCE_SITE_MINIMUM[slug] ?? 1
      );

      // Each site must resolve to a verdict on its own. A correct copy
      // elsewhere in the file is not allowed to vouch for a broken one.
      for (const window of windows) expect(window).toMatch(/underivable/iu);

      for (const pattern of ABSENCE_AS_FALSE) {
        expect(content).not.toMatch(pattern);
      }
    });
  });
});

describe("no rule copy reads an absent declaration as false", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    // #3992 demoted `derived-branch-plan` out of the eager tier, folding its
    // head into the reference body. One copy per root now, so the sweep runs
    // over the tier that has it — still every root, still a universal negative.
    it.each(["reference"] as const)("%s tier", tier => {
      const content = readRule(root, tier);

      expect(content).toMatch(/underivable/iu);

      for (const pattern of ABSENCE_AS_FALSE) {
        expect(content).not.toMatch(pattern);
      }
    });
  });
});

describe("no copy hands authority back to the caller", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(VALIDATORS)("%s keeps the stored declaration on top", slug => {
      const content = readSkill(root, slug);

      for (const pattern of CALLER_BEATS_STORED) {
        expect(content).not.toMatch(pattern);
      }
    });
  });

  describe.each(RULE_ROOTS)("%s", root => {
    it("the reference tier keeps the stored declaration on top", () => {
      const content = readRule(root, "reference");

      for (const pattern of CALLER_BEATS_STORED) {
        expect(content).not.toMatch(pattern);
      }
    });
  });
});
