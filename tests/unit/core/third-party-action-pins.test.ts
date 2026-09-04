/**
 * The text layer: what counts as a mutable third-party reference, and what a
 * rewritten line looks like.
 *
 * The exemptions are the load-bearing part. A check that reddened Lisa's own
 * `@main` references would be the wrong check and would be turned off — that is
 * a stability question about an upstream we own (#3488), not a supply-chain one
 * — and `actions/*` is published by the same party that runs the job, so
 * pinning it moves no trust boundary. Both are OWNER allowlists rather than
 * substring matches, which is why `actions-rs/toolchain` is asserted here: a
 * substring match would silently exempt a genuine third party.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/core/third-party-action-pins
 */
import { describe, expect, it } from "vitest";

import {
  applyPins,
  distinctRefs,
  findUnpinnedRefs,
} from "../../../src/core/third-party-action-pins.js";

/** A 40-character commit SHA, the only ref shape that is not a finding. */
const SHA = "ae66602ce7d214dbd2e298c1db67a81388755a0a";

/** The action whose entire function is to export repository secrets. */
const SECRETS_ACTION = "noliran/branch-based-secrets";

/** One `uses:` line referencing that action at its floating major. */
const SECRETS_LINE = `      - uses: ${SECRETS_ACTION}@v1`;

/** A third-party action referenced at a floating major. */
const BUN_ACTION = "oven-sh/setup-bun";

/** One `uses:` line referencing that action at its floating major. */
const BUN_LINE = `      - uses: ${BUN_ACTION}@v2`;

/** The resolution used wherever a rewrite of {@link BUN_LINE} is asserted. */
const BUN_PIN = { action: BUN_ACTION, ref: "v2", sha: SHA };

describe("findUnpinnedRefs", () => {
  it("finds a mutable ref written as a list item", () => {
    expect(findUnpinnedRefs(SECRETS_LINE)).toEqual([
      {
        line: 0,
        owner: "noliran",
        repo: "branch-based-secrets",
        action: SECRETS_ACTION,
        ref: "v1",
      },
    ]);
  });

  it("finds a mutable ref written as a step key", () => {
    expect(findUnpinnedRefs("        uses: oven-sh/setup-bun@v2")).toHaveLength(
      1
    );
  });

  it("finds an action nested below the repository root", () => {
    // `snyk/actions/node@master` is repo `snyk/actions`, path `node`. Reading
    // the owner/repo pair wrong would query a repository that does not exist.
    expect(findUnpinnedRefs("      - uses: snyk/actions/node@master")).toEqual([
      {
        line: 0,
        owner: "snyk",
        repo: "actions",
        action: "snyk/actions/node",
        ref: "master",
      },
    ]);
  });

  it("ignores a reference already pinned to a commit SHA", () => {
    expect(
      findUnpinnedRefs(
        `      - uses: canastro/copy-file-action@${SHA} # master`
      )
    ).toEqual([]);
  });

  it("ignores GitHub's own namespaces", () => {
    expect(
      findUnpinnedRefs(
        [
          "  - uses: actions/checkout@v6",
          "  - uses: github/codeql-action@v3",
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("ignores first-party reusable workflow references", () => {
    expect(
      findUnpinnedRefs(
        "  uses: CodySwannGT/lisa/.github/workflows/gates.yml@main"
      )
    ).toEqual([]);
  });

  it("treats an owner that merely starts with an exempt name as third-party", () => {
    expect(findUnpinnedRefs("  - uses: actions-rs/toolchain@v1")).toHaveLength(
      1
    );
  });

  it("ignores lines that are not `uses:` at all", () => {
    expect(
      findUnpinnedRefs("        image: noliran/branch-based-secrets@v1")
    ).toEqual([]);
  });
});

describe("applyPins", () => {
  it("rewrites the ref and records what the SHA carries", () => {
    expect(
      applyPins("      - uses: canastro/copy-file-action@master", [
        { action: "canastro/copy-file-action", ref: "master", sha: SHA },
      ])
    ).toBe(`      - uses: canastro/copy-file-action@${SHA} # master`);
  });

  it("replaces a stale trailing comment rather than keeping it", () => {
    // The old comment described the ref being pinned away, so keeping it would
    // leave the line saying two different things.
    expect(applyPins(`${BUN_LINE} # floating major`, [BUN_PIN])).toBe(
      `      - uses: ${BUN_ACTION}@${SHA} # v2`
    );
  });

  it("leaves every other line untouched", () => {
    const source = ["jobs:", "  deploy:", "    # a host's own note", BUN_LINE];

    expect(applyPins(source.join("\n"), [BUN_PIN])).toBe(
      [
        "jobs:",
        "  deploy:",
        "    # a host's own note",
        `      - uses: ${BUN_ACTION}@${SHA} # v2`,
      ].join("\n")
    );
  });

  it("returns the source unchanged when there is nothing to pin", () => {
    expect(applyPins(BUN_LINE, [])).toBe(BUN_LINE);
  });

  it("does not rewrite a reference whose ref differs from the resolution", () => {
    expect(applyPins(`      - uses: ${BUN_ACTION}@v3`, [BUN_PIN])).toBe(
      `      - uses: ${BUN_ACTION}@v3`
    );
  });
});

describe("distinctRefs", () => {
  it("collapses repeated references to one lookup", () => {
    // The seeded NestJS deploy workflow references the same secrets action five
    // times; resolving it five times would be five API calls for one answer.
    const source = [SECRETS_LINE, SECRETS_LINE, BUN_LINE].join("\n");

    expect(distinctRefs(findUnpinnedRefs(source))).toHaveLength(2);
  });

  it("keeps two different refs of the same action apart", () => {
    const source = [BUN_LINE, `      - uses: ${BUN_ACTION}@main`].join("\n");

    expect(distinctRefs(findUnpinnedRefs(source))).toHaveLength(2);
  });
});
