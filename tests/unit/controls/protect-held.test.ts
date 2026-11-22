/**
 * What `lisa controls protect` tells an operator to do about a check that
 * something reports, only not the source that would be required
 * (CodySwannGT/lisa#4993).
 *
 * The sentence is printed as it stands in the result document and in the file
 * handed to an administrator, so the step it names has to be one that works.
 * Naming an app works for a check run, which says which app reported it. It
 * cannot work for a commit status, which does not: there the operator either
 * declares the check without an app, so that any source may report it, or has
 * the app report a check run. And a check a pipeline job reports is required
 * from GitHub Actions whatever the configuration says about another app, so
 * for that one the step is to let the pipeline run.
 */
import { describe, expect, it } from "vitest";

import {
  reportedByAnother,
  type PinOrigin,
  type OtherReporters,
} from "../../../src/controls/protect-held.js";

const ON = "`main`";
const DECLARED_APP = 4242;
const ACTIONS_APP = 15_368;
const NAME_IT = /name it for the check in \.lisa\.config\.json/u;
const WITHOUT_AN_APP = /declare the check without an app/u;
const AS_A_CHECK_RUN = /have app 4242 report it as a check run/u;
const RUN_AGAIN = /run this command again\.$/u;

/** An awaited check whose gate names the app that reports it. */
const AWAITED_AND_NAMED: PinOrigin = "awaited";

/** A check a pipeline job reports. */
const PIPELINE: PinOrigin = "pipeline";

/** Nothing was seen from anywhere; each case says what was. */
const NOBODY: OtherReporters = {
  apps: [],
  unnamedRun: false,
  commitStatus: false,
};

/**
 * Build the sentence for one check.
 * @param seen - Who did report it
 * @param origin - How the app it is required from came to be chosen
 * @param wanted - The apps that would have to report it
 * @returns The sentence
 */
function sentence(
  seen: Partial<OtherReporters>,
  origin: PinOrigin = AWAITED_AND_NAMED,
  wanted: readonly (number | null)[] = [DECLARED_APP]
): string {
  return reportedByAnother(ON, wanted, { ...NOBODY, ...seen }, origin).detail;
}

describe("an awaited check that names its app, reported by another app", () => {
  it("says to name that app, in both places an app can be named", () => {
    const detail = sentence({ apps: [999] });

    expect(detail).toContain("but from app 999, not from app 4242.");
    expect(detail).toMatch(
      /If app 999 is what reports this check, name it for the check in \.lisa\.config\.json \(posted_by on the gate that awaits it, or integration_id under github\.rulesets\.requiredChecks\); otherwise let app 4242 report it once, then run this command again\.$/u
    );
    expect(detail).not.toMatch(WITHOUT_AN_APP);
  });
});

describe("an awaited check that names its app, reported as a commit status", () => {
  it("does not tell the operator to name a commit status, which names no app", () => {
    const detail = sentence({ commitStatus: true });

    expect(detail).toContain("but from a commit status, not from app 4242.");
    expect(detail).not.toMatch(NAME_IT);
    expect(detail).not.toMatch(/name it in/u);
  });

  it("says why, and the two things that do work", () => {
    const detail = sentence({ commitStatus: true });

    expect(detail).toContain(
      "A commit status does not say which app reported it, so it can never count for a check that names an app, and there is no app to name for it."
    );
    expect(detail).toContain(
      "If a commit status is what reports this check, declare the check without an app in .lisa.config.json (remove posted_by from the gate that awaits it, and any integration_id for it under github.rulesets.requiredChecks), so that any source may report it;"
    );
    expect(detail).toMatch(AS_A_CHECK_RUN);
    expect(detail).toMatch(RUN_AGAIN);
  });

  it("says the same of a check run that names no app", () => {
    const detail = sentence({ unnamedRun: true });

    expect(detail).toContain(
      "A check run that names no app does not say which app reported it"
    );
    expect(detail).not.toMatch(NAME_IT);
    expect(detail).toMatch(WITHOUT_AN_APP);
    expect(detail).toMatch(AS_A_CHECK_RUN);
  });

  it("gives each reporter its own step when an app and a commit status both reported it", () => {
    const detail = sentence({ apps: [999], commitStatus: true });

    expect(detail).toContain(
      "but from app 999 and a commit status, not from app 4242."
    );
    expect(detail).toMatch(
      /If app 999 is what reports this check, name it for the check/u
    );
    expect(detail).toMatch(
      /If a commit status is what reports this check, declare the check without an app/u
    );
    expect(detail).toMatch(RUN_AGAIN);
  });
});

describe("a check a pipeline job reports, seen from something else", () => {
  it.each([
    ["a commit status", { commitStatus: true }],
    ["another app", { apps: [999] }],
    ["a check run that names no app", { unnamedRun: true }],
  ] as const)("names nothing to declare when it was %s", (_who, seen) => {
    const detail = sentence(seen, PIPELINE, [ACTIONS_APP]);

    expect(detail).toContain("not from GitHub Actions (app 15368).");
    expect(detail).not.toMatch(/posted_by|integration_id/u);
    expect(detail).not.toMatch(WITHOUT_AN_APP);
    expect(detail).toContain(
      "This check is one a pipeline job in this repository reports, so only GitHub Actions counts for it, and what was seen comes from something else that uses the same name."
    );
    expect(detail).toMatch(
      /Merge the workflow that reports it and let it run once, then run this command again\.$/u
    );
  });
});

describe("a check whose entry under the required checks of a ruleset decides its app", () => {
  const PINNED_PIPELINE: PinOrigin = "entry";

  it("names the one place its app is declared", () => {
    const detail = sentence({ apps: [999] }, PINNED_PIPELINE);

    expect(detail).toMatch(
      /name it for the check in \.lisa\.config\.json \(integration_id under github\.rulesets\.requiredChecks\)/u
    );
    expect(detail).not.toMatch(/posted_by/u);
  });

  it("does not say that leaving the app out opens it to any source, because it would not", () => {
    const detail = sentence({ commitStatus: true }, PINNED_PIPELINE);

    expect(detail).not.toMatch(WITHOUT_AN_APP);
    expect(detail).not.toMatch(/any source/u);
    expect(detail).toMatch(/Have app 4242 report it as a check run/u);
    expect(detail).toMatch(RUN_AGAIN);
  });
});

describe("the source the sentence says is missing", () => {
  it("leaves out a declaration any source satisfies, which what was seen did satisfy", () => {
    const detail = sentence({ commitStatus: true }, AWAITED_AND_NAMED, [
      null,
      DECLARED_APP,
    ]);

    expect(detail).toContain("not from app 4242.");
    expect(detail).not.toMatch(/any source and/u);
  });

  it("names an app once however many declarations ask for it", () => {
    const detail = sentence({ apps: [999] }, AWAITED_AND_NAMED, [
      DECLARED_APP,
      DECLARED_APP,
    ]);

    expect(detail).toContain("not from app 4242.");
  });

  it("is always not-ready, whatever the step", () => {
    expect(
      reportedByAnother(
        ON,
        [DECLARED_APP],
        { ...NOBODY, commitStatus: true },
        AWAITED_AND_NAMED
      ).state
    ).toBe("not-ready");
  });
});
