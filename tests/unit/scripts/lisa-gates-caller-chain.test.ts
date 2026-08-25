/**
 * Tests for the caller chain a derived required context is prefixed with.
 *
 * A required context that never reports does not fail a pull request. GitHub
 * holds it at "Expected — Waiting for status to be reported", indefinitely,
 * with no red tick to chase and no log to open. So the depth of the prefix
 * fails in both directions and neither direction is visible: one level too few
 * and a nested consumer's rulesets pin names nothing posts; one too many, or
 * any change to what the single-level default derives, and every repository
 * pinned to today's strings goes the same way.
 *
 * Which is why the assertions here are anchored to what real runs POSTED, not
 * to what the YAML implies. Measured on this repository: pull request #3129's
 * head `b1307c42` posted `🔍 Quality Checks / 🧹 Lint` (one level, `ci.yml`'s
 * job calling `quality.yml` directly), and commit `6b44d6258` posted
 * `Release / 🔍 Quality Checks / 🧹 Lint` (two, `deploy.yml`'s `Release` job
 * calling `release.yml`, whose `🔍 Quality Checks` job calls the same
 * `quality.yml`). Same jobs, same labels, different names.
 * @module tests/unit/scripts/lisa-gates-caller-chain
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CONTEXT_VERDICTS,
  contextsFor,
  postedCallerChains,
  verifyContextsPosted,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  LINT_LABEL,
  LINT_TASK,
  PULL_REQUEST,
  QUALITY,
  REVIEW_BOT,
} from "./lisa-gates-fixtures.js";

/** The outermost job on the release path, from `deploy.yml`. */
const RELEASE = "Release";

/** What the release path posts for the lint gate, read off `6b44d6258`. */
const NESTED_LINT = "Release / 🔍 Quality Checks / 🧹 Lint";

/** A gates block with one run gate and one awaited gate at pull-request. */
const GATES = {
  "code-style": { run: LINT_TASK, [PULL_REQUEST]: "required" },
  "code-review": { [PULL_REQUEST]: { level: "required", await: REVIEW_BOT } },
};

describe("contextsFor caller chain", () => {
  it("derives every level of an explicit caller chain", () => {
    // The bug: the chain was never an input, so a two-hop consumer derived a
    // one-hop name and required a context its own runs never post.
    expect(contextsFor(GATES, { callerChain: [RELEASE, QUALITY] })).toEqual([
      REVIEW_BOT,
      NESTED_LINT,
    ]);
  });

  it("takes the same chain as one slash-joined workflow value", () => {
    // So `--workflow "Release / 🔍 Quality Checks"` reaches it without a new
    // flag, and the long-standing single-level value is the one-element chain.
    expect(
      contextsFor(GATES, { workflowName: `${RELEASE} / ${QUALITY}` })
    ).toEqual([REVIEW_BOT, NESTED_LINT]);
  });

  it("leaves an awaited signal unprefixed however deep the chain", () => {
    // A bot posts under its own name from wherever it runs. Prefixing it would
    // invent a context nothing posts, which is the same trap from the far side.
    expect(contextsFor(GATES, { callerChain: [RELEASE, QUALITY] })).toContain(
      REVIEW_BOT
    );
  });

  it("refuses a blank caller level instead of deriving a name nothing posts", () => {
    // `" / 🔍 Quality Checks / 🧹 Lint"` is a perfectly plausible-looking
    // string that no run has ever posted. Failing loudly here is the only
    // place it can still fail loudly.
    expect(() => contextsFor(GATES, { workflowName: `/ ${QUALITY}` })).toThrow(
      /caller chain/
    );
    expect(() => contextsFor(GATES, { callerChain: [] })).toThrow(
      /caller chain/
    );
  });
});

describe("contextsFor single-level default (negative control)", () => {
  it("derives exactly what it derived before the chain existed", () => {
    // Hardcoded, not computed: this is the string every live ruleset in the
    // fleet is pinned to. A fix that served the nested case by moving the
    // common one would strand all of them, and would fail here.
    expect(contextsFor(GATES)).toEqual([LINT_LABEL, REVIEW_BOT]);
    expect(contextsFor(GATES, { workflowName: QUALITY })).toEqual([
      LINT_LABEL,
      REVIEW_BOT,
    ]);
  });

  it("still matches the one-level context the shipped rulesets pin", () => {
    // The seed is the consumer contract. If the default ever derives something
    // this file does not carry, a fresh install requires a name nothing posts.
    const seed = readFileSync(
      "typescript/github-rulesets/quality-checks.json",
      "utf8"
    );
    expect(JSON.parse(seed)).toBeTruthy();
    expect(seed).toContain(`"context": "${LINT_LABEL}"`);
    expect(contextsFor(GATES)).toContain(LINT_LABEL);
  });
});

describe("postedCallerChains", () => {
  it("reads the depth off what a run actually posted", () => {
    // How the derivation learns its own depth without anyone reasoning about
    // YAML: hand it a completed run's names and the labels in play.
    expect(
      postedCallerChains(
        [
          NESTED_LINT,
          "Release / 🔍 Quality Checks / 🏗️ Build",
          LINT_LABEL,
          "Release / 📦 Version Management",
        ],
        ["🧹 Lint", "🏗️ Build"]
      )
    ).toEqual([[QUALITY], [RELEASE, QUALITY]]);
  });

  it("ignores a name that is nothing but the label", () => {
    // A top-level job posting under its bare label has no caller chain, and
    // inventing an empty one would derive `" / 🧹 Lint"`.
    expect(postedCallerChains(["🧹 Lint"], ["🧹 Lint"])).toEqual([]);
  });
});

describe("verifyContextsPosted", () => {
  const posted = [NESTED_LINT, "Release / 🔍 Quality Checks / 🏗️ Build"];

  it("fails a one-level derivation against a nested run", () => {
    // The whole defect, reproduced: the derived name is plausible, the run
    // posted a different one, and requiring it would hold every pull request
    // pending forever.
    const result = verifyContextsPosted({ derived: [LINT_LABEL], posted });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe(CONTEXT_VERDICTS.NEVER_POSTED);
    expect(result.missing).toEqual([LINT_LABEL]);
  });

  it("passes once the derivation carries the chain the run posted", () => {
    expect(verifyContextsPosted({ derived: [NESTED_LINT], posted })).toEqual({
      ok: true,
      missing: [],
      verdict: null,
      reason: null,
    });
  });

  it("refuses to report clear over an empty derived set", () => {
    // Vacuity, arm one. "Nothing missing" over nothing derived reads exactly
    // like a full match, and is the only failure mode a comparison of two
    // lists can hide from itself.
    const result = verifyContextsPosted({ derived: [], posted });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe(CONTEXT_VERDICTS.VACUOUS_DERIVED);
  });

  it("refuses to report clear when nothing was posted", () => {
    // Vacuity, arm two: an empty evidence side proves nothing about a
    // non-empty derived side, whichever way the loop is written.
    const result = verifyContextsPosted({ derived: [LINT_LABEL], posted: [] });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe(CONTEXT_VERDICTS.VACUOUS_POSTED);
    expect(result.missing).toEqual([LINT_LABEL]);
  });

  it("refuses to report clear when called with nothing at all", () => {
    expect(verifyContextsPosted().ok).toBe(false);
    expect(verifyContextsPosted().verdict).toBe(
      CONTEXT_VERDICTS.VACUOUS_DERIVED
    );
  });
});
