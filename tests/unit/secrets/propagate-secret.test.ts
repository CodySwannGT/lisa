/**
 * Contract tests for the propagation path — copying a secret from its provider
 * into a second store it cannot read from.
 *
 * These are deliberately bite controls rather than happy-path coverage. Every
 * property in this contract fails **open** when it is wrong: an empty write
 * succeeds and reports success, a mis-parsed listing warns about a write that
 * landed, an undeclared name copies outward without anyone deciding it should.
 * A test that only proves the good case passes would go green against all three.
 * @module tests/unit/secrets/propagate-secret
 */
import { describe, expect, it } from "vitest";

import {
  assertPropagating,
  assertValue,
  confirmPresent,
  extractSecretNames,
  parseTarget,
  pushArgs,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/sync-secret-to-ci.mjs";

/**
 * The value used wherever a test needs a credential-shaped string.
 *
 * Deliberately shaped like no vendor's key. A fixture carrying a real
 * provider's prefix costs a secret-scanning alert every time the file is
 * read, and the habit that teaches — waving those alerts through — is the
 * one a secrets contract least wants to build.
 */
const VALUE = "placeholder-value-for-tests";

/** The credential every case here stands in for, and where it is bound for. */
const NAME = "LINEAR_API_KEY";
const ORG = "AcmeOrgD";

/**
 * One page of the shape `GET /orgs/{org}/actions/secrets` actually returns.
 *
 * Written out in full rather than as `{ secrets: [...] }`, because the exact
 * envelope is the thing under test: a parser written against a bare array reads
 * nothing here and calls a landed write a failure.
 * @param names Secret names the page should list.
 * @returns One listing page.
 */
const envelope = (...names: string[]) => ({
  total_count: names.length,
  secrets: names.map(name => ({
    name,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    visibility: "private",
  })),
});

describe("refusing an empty value", () => {
  // The unsafe path SUCCEEDS: piping empty into `gh secret set` stores an empty
  // secret and exits 0, leaving a destination that reports a present, healthy,
  // useless credential. Everything downstream then behaves exactly as it does
  // when the secret was never set — for a warn-skipping gate, a green check that
  // verified nothing. So the refusal is the property, and these prove it bites.

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a lone newline", "\n"],
    ["undefined", undefined],
    ["null", null],
    ["a number", 0],
  ])("refuses %s", (_label, value) => {
    expect(() => assertValue(NAME, value)).toThrow(/refusing to propagate/);
  });

  it("passes a real value through unchanged", () => {
    // The control on the control: a refusal that also rejected every good value
    // would pass the tests above while making propagation impossible.
    expect(assertValue(NAME, VALUE)).toBe(VALUE);
  });

  it("keeps a value whose own newlines are part of it", () => {
    // Trimming is how absence is DETECTED, not how the value is prepared. A
    // multi-line credential — a PEM, a service-account JSON blob — must reach
    // the store byte-for-byte, interior and trailing newlines included.
    //
    // Deliberately not written in any real credential wrapper format. Only the
    // newlines are under test, and a realistic header can trip scanners on the
    // header alone, regardless of what follows it. Please don't make it
    // realistic.
    const multiline = "first line\nsecond line\n";
    expect(assertValue("SOME_MULTILINE_SECRET", multiline)).toBe(multiline);
  });
});

describe("verifying by metadata", () => {
  // This is the check that was written wrong first, and being wrong here is
  // worse than having no check: it reported a WARNING on a write that had
  // already succeeded, which teaches an operator to ignore the verification and
  // to write again. The listing is NOT an array — it is
  // `{ total_count, secrets: [...] }` — so a filter over a bare array finds
  // nothing and every successful write looks like a failure.

  it("confirms a name present in the documented envelope", () => {
    expect(confirmPresent(envelope(NAME, "NPM_TOKEN"), NAME)).toBe(true);
  });

  it("confirms a name present in a bare array of secrets", () => {
    expect(confirmPresent([{ name: NAME }], NAME)).toBe(true);
  });

  it("confirms a name in listDestination's normalized name array", () => {
    expect(confirmPresent(["NPM_TOKEN", NAME], NAME)).toBe(true);
  });

  it("confirms a name present on a later page of a paginated read", () => {
    // An organization with more than one page of secrets is ordinary, and a
    // verification that read only page one would fail every successful write
    // there — the same false failure in a different costume.
    const pages = [envelope("A", "B"), envelope(NAME)];
    expect(confirmPresent(pages, NAME)).toBe(true);
  });

  it("reports absence when the store does not list the name", () => {
    expect(confirmPresent(envelope("NPM_TOKEN"), NAME)).toBe(false);
    expect(confirmPresent(envelope(), NAME)).toBe(false);
  });

  it("does not confuse an empty listing for a match", () => {
    expect(confirmPresent({}, NAME)).toBe(false);
    expect(confirmPresent(null, NAME)).toBe(false);
    expect(confirmPresent("", NAME)).toBe(false);
  });

  it("surfaces names and nothing else", () => {
    // One-way: the destination is read for metadata only. GitHub cannot return
    // a secret value, and this reader could not carry one out if it did.
    const names = extractSecretNames({
      total_count: 1,
      secrets: [{ name: NAME, value: VALUE }],
    });
    expect(names).toEqual([NAME]);
    expect(JSON.stringify(names)).not.toContain(VALUE);
  });
});

describe("declared, never inferred", () => {
  it("refuses a name absent from secrets.propagating", () => {
    expect(() => assertPropagating(NAME, ORG, { propagating: [] })).toThrow(
      /not declared in secrets.propagating/
    );
  });

  it("refuses when the block is missing entirely", () => {
    expect(() => assertPropagating(NAME, ORG, {})).toThrow(/not declared/);
  });

  it("allows a bare declared name to any target", () => {
    const cfg = { propagating: [NAME] };
    expect(() => assertPropagating(NAME, ORG, cfg)).not.toThrow();
    expect(() => assertPropagating(NAME, "AcmeOrgA/api", cfg)).not.toThrow();
  });

  it("refuses a target the declaration did not pin", () => {
    const cfg = {
      propagating: [{ name: NAME, targets: [ORG] }],
    };
    expect(() => assertPropagating(NAME, ORG, cfg)).not.toThrow();
    expect(() => assertPropagating(NAME, "SomeoneElse", cfg)).toThrow(
      /not to "SomeoneElse"/
    );
  });

  it("does not let one declared name authorise its neighbours", () => {
    const cfg = { propagating: [NAME] };
    expect(() => assertPropagating("LINEAR_API_KEY_STAGING", ORG, cfg)).toThrow(
      /not declared/
    );
    expect(() => assertPropagating("LINEAR_API", ORG, cfg)).toThrow(
      /not declared/
    );
  });
});

describe("the value never becomes an argument", () => {
  // Process arguments are visible to anything that can list processes on the
  // host, so the value travels on stdin. The builder takes no value at all,
  // which is what makes this provable rather than merely intended.

  it("builds an org write whose argv carries only names and scope", () => {
    const args = pushArgs(parseTarget(ORG), NAME);
    expect(args).toEqual([
      "secret",
      "set",
      NAME,
      "--org",
      ORG,
      "--visibility",
      "private",
    ]);
    expect(args).not.toContain(VALUE);
  });

  it("builds a repo write with no visibility flag", () => {
    // Repository secrets have no visibility axis; sending one is an API error.
    expect(pushArgs(parseTarget("AcmeOrgD/wiki"), NAME)).toEqual([
      "secret",
      "set",
      NAME,
      "--repo",
      "AcmeOrgD/wiki",
    ]);
  });

  it("defaults an org secret to the narrow visibility", () => {
    // `all` reaches public repositories too. A default that widens exposure is
    // a default nobody reviews, so widening stays an explicit flag.
    expect(pushArgs(parseTarget(ORG), "K")).toContain("private");
    expect(pushArgs(parseTarget(ORG), "K", { visibility: "all" })).toContain(
      "all"
    );
  });
});
