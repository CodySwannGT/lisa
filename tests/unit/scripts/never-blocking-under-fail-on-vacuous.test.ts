/**
 * Tests for the two findings that stay report-only under `--fail-on-vacuous`.
 *
 * ## The gap
 *
 * `violationBlocks` gives `reviewWaived` and `reviewCarried` an exemption that
 * runs BEFORE the `NEVER_BLOCKING` lookup, because that lookup's own rule is
 * `return policy.failOnVacuous` — reaching it would make both kinds block the
 * moment the flag is passed. **No test exercised either kind under that flag.**
 * Across the three files covering this guard, 141 tests passed and none combined
 * `--fail-on-vacuous` with either finding, so deleting or reordering one line
 * converted two deliberately report-only findings into build failures with
 * nothing noticing (CodySwannGT/lisa#3902).
 *
 * ## Why the fourth scenario is mandatory, and what makes it possible
 *
 * The first two scenarios assert that something does **not** happen, which is
 * the easiest kind of test to write vacuously: a fixture that never produces the
 * finding passes both. Two things answer that here.
 *
 * The **matrix** is the first. `vacuous` and `unproven` sit in the same array and
 * DO block under the flag, so the same call with the same policy produces both
 * answers. A suite that could only produce "does not block" would pass while the
 * other half rotted; one that produces both cannot.
 *
 * The **policy** is the second. `cliPolicy` is asserted to turn the literal
 * `--fail-on-vacuous` into `failOnVacuous: true`, so a passing report-only case
 * means the flag was live and chose not to block — not that it never arrived.
 * That is exactly the distinction between a finding and an absence of one, which
 * is this guard's own subject applied to its tests.
 *
 * ## Both directions
 *
 * A suite pinning only "never-blocking stays never-blocking" leaves the more
 * expensive direction free: a blocking finding quietly stopping blocking. Both
 * are asserted, and the bite check removes the exemption AND empties the
 * blocking arm to confirm each half is load-bearing.
 * @module tests/unit/scripts/never-blocking-under-fail-on-vacuous
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs"
);

/** The literal an operator or a workflow passes. */
const FLAG = "--fail-on-vacuous";

/** The guard module, loaded once. */
let mod: {
  VIOLATIONS: Record<string, string>;
  NEVER_BLOCKING: readonly string[];
  REPORT_ONLY: readonly string[];
  cliPolicy: (
    argv: readonly string[],
    result: { enforcement?: string }
  ) => {
    warnOnly: boolean;
    failOnVacuous: boolean;
    requireReviewEvidence: boolean;
  };
  violationBlocks: (
    violation: { kind: string },
    policy: {
      warnOnly: boolean;
      failOnVacuous: boolean;
      requireReviewEvidence: boolean;
    }
  ) => boolean;
};

beforeAll(async () => {
  mod = (await import(pathToFileURL(SCRIPT).href)) as typeof mod;
});

/**
 * Whether one kind blocks under the policy `--fail-on-vacuous` produces.
 * @param kind - The violation kind under test.
 * @returns Whether the guard would fail the build for it.
 */
const blocksUnderFlag = (kind: string): boolean =>
  mod.violationBlocks(
    { kind },
    mod.cliPolicy([FLAG], { enforcement: "active" })
  );

describe("the flag is live, so a non-block is a decision", () => {
  it("turns the literal flag into failOnVacuous", () => {
    // Without this, every "does not block" case below could be passing because
    // the flag never arrived — which is the vacuous test this file is about,
    // one level up from the vacuous CHECK the guard is about.
    expect(mod.cliPolicy([FLAG], { enforcement: "active" }).failOnVacuous).toBe(
      true
    );
    expect(mod.cliPolicy([], { enforcement: "active" }).failOnVacuous).toBe(
      false
    );
  });
});

describe("a waived review stays report-only under the flag", () => {
  it("does not block", () => {
    // The owner's ruling on #3221: a waived pull request is an unreviewed one,
    // the operator must see it, and it must never fail the build.
    expect(blocksUnderFlag(mod.VIOLATIONS["reviewWaived"] as string)).toBe(
      false
    );
  });

  it("is in the array whose other members DO block under the flag", () => {
    // The trap the exemption exists to avoid, asserted rather than described:
    // membership of NEVER_BLOCKING is not what keeps this kind report-only.
    expect(mod.NEVER_BLOCKING).toContain(mod.VIOLATIONS["reviewWaived"]);
    expect(mod.REPORT_ONLY).toContain(mod.VIOLATIONS["reviewWaived"]);
  });
});

describe("a carried finding stays report-only under the flag", () => {
  it("does not block", () => {
    // #3658: it is about ANOTHER pull request, whose own gate reached its own
    // verdict on its own diff. Failing this author for a diff they did not
    // write and cannot change would be wrong.
    expect(blocksUnderFlag(mod.VIOLATIONS["reviewCarried"] as string)).toBe(
      false
    );
  });

  it("is in the array whose other members DO block under the flag", () => {
    expect(mod.NEVER_BLOCKING).toContain(mod.VIOLATIONS["reviewCarried"]);
    expect(mod.REPORT_ONLY).toContain(mod.VIOLATIONS["reviewCarried"]);
  });
});

describe("a genuine vacuity finding still blocks under the flag", () => {
  it.each([["vacuous"], ["unproven"]])("blocks on %s", kind => {
    // THE other direction. A suite pinning only that the exempt kinds stay
    // exempt would pass on a guard that had stopped blocking anything at all,
    // which is the more expensive failure of the two.
    expect(blocksUnderFlag(mod.VIOLATIONS[kind] as string)).toBe(true);
  });

  it("blocks on nothing at all without the flag", () => {
    // The control that makes the case above mean something: the flag is what
    // turns a vacuity finding into a failure, so the same kind must answer
    // differently when it is absent.
    const quiet = mod.cliPolicy([], { enforcement: "warn" });

    expect(
      mod.violationBlocks({ kind: mod.VIOLATIONS["vacuous"] as string }, quiet)
    ).toBe(false);
  });
});

describe("the exemption is a value, not a position", () => {
  it("names exactly the two kinds whose policies say report-only", () => {
    // Pinned as a SET, not a list: an entry silently added here would exempt a
    // kind nobody ruled on, which is the same defect in the opposite
    // direction. Compared as sets so the assertion says nothing about order,
    // which no policy depends on.
    expect(new Set(mod.REPORT_ONLY)).toEqual(
      new Set([mod.VIOLATIONS["reviewWaived"], mod.VIOLATIONS["reviewCarried"]])
    );
    expect(mod.REPORT_ONLY).toHaveLength(2);
  });

  it("every report-only kind answers false whatever the flags say", () => {
    // The property in its general form, so a third exempt kind added later
    // inherits the assertion instead of needing its own.
    const everyFlag = mod.cliPolicy([FLAG, "--require-review-evidence"], {
      enforcement: "active",
    });

    for (const kind of mod.REPORT_ONLY) {
      expect(mod.violationBlocks({ kind }, everyFlag)).toBe(false);
    }
  });
});
