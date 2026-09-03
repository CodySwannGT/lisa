/**
 * The verdicts for a gate whose merge declaration awaits an external signal.
 *
 * Split from the main comparator suite for the same reason the retirement
 * verdict has its own file: one defect, one account of it. #3609 is the case
 * where the two derivations of "what does this declaration promise" disagreed
 * — the shipped registry emitted only the awaited signal's name, the ownership
 * map emitted the facade name too — and the comparator turned that into a
 * contradiction that did not exist, with a remedy that would have required a
 * string no run can post.
 * @module tests/unit/core/gate-declaration-drift-awaited
 */
import { describe, expect, it } from "vitest";

import {
  classifyDeclarationDrift,
  declaredRequiredContexts,
} from "../../../src/core/gate-declaration-drift.js";
import {
  AWAITED_ELSEWHERE,
  CODERABBIT,
  LIVE_SURFACE,
  REQUIRED,
  SECURITY,
  WORKFLOW,
  awaitingOwner,
  plainOwner,
} from "./gate-declaration-drift-fixtures.js";

const LIVE_SOURCE_NAME = "the live rulesets";
const BASE = "base";

/**
 * A gate declared `required` with an `await:` promises the awaited signal's
 * own name, and nothing else.
 *
 * Both halves are here because either one alone is a lie in a different
 * direction. Listing the facade name as promised reports a contradiction that
 * does not exist and sends the operator to require a string nothing posts;
 * calling the facade name `matched` when a ruleset does require it reports
 * agreement about a string the settings file never named.
 */
describe("a gate whose declaration awaits an external signal", () => {
  const FACADE = `${WORKFLOW} / 👁️ Code Review`;

  it("does not promise its own facade context, so nothing is unenforced", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([
        [FACADE, awaitingOwner(REQUIRED)],
        [CODERABBIT, plainOwner(REQUIRED)],
      ]),
      enforced: [
        { context: CODERABBIT, ruleset: BASE, source: LIVE_SOURCE_NAME },
      ],
    });

    expect(report.counts["declared-not-enforced"]).toBe(0);
    expect(report.contradictions).toBe(0);
    expect(report.entries.map(entry => entry.context)).toEqual([CODERABBIT]);
  });

  it("names the awaited signal as the promise, not the facade context", () => {
    expect(
      declaredRequiredContexts(
        new Map([
          [FACADE, awaitingOwner(REQUIRED)],
          [CODERABBIT, plainOwner(REQUIRED)],
        ])
      )
    ).toEqual([CODERABBIT]);
  });

  it("refuses to call a ruleset requiring the facade context a match", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([[FACADE, awaitingOwner(REQUIRED)]]),
      enforced: [{ context: FACADE, ruleset: BASE, source: LIVE_SOURCE_NAME }],
    });

    expect(report.entries[0]?.verdict).toBe(AWAITED_ELSEWHERE);
    expect(report.entries[0]?.remedy).toBe("decide-which-surface-wins");
    expect(report.counts.matched).toBe(0);
    expect(report.gaps).toBe(1);
    expect(report.entries[0]?.detail).toContain(CODERABBIT);
  });

  it("still reports a genuinely unenforced required gate alongside it", () => {
    const report = classifyDeclarationDrift({
      surface: LIVE_SURFACE,
      owners: new Map([
        [FACADE, awaitingOwner(REQUIRED)],
        [CODERABBIT, plainOwner(REQUIRED)],
        [SECURITY, plainOwner(REQUIRED)],
      ]),
      enforced: [
        { context: CODERABBIT, ruleset: BASE, source: LIVE_SOURCE_NAME },
      ],
    });

    const unenforced = report.entries.filter(
      entry => entry.verdict === "declared-not-enforced"
    );
    expect(unenforced.map(entry => entry.context)).toEqual([SECURITY]);
    expect(report.contradictions).toBe(1);
  });
});
