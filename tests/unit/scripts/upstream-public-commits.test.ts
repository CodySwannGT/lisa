/**
 * Reading the public-commit list out of the generated manifest, and what the
 * release is told when the list is stale (CodySwannGT/lisa#4960).
 *
 * The reader is exercised against the real checked-in manifest as well as
 * hand-written samples, so a change to the generator's output shape fails here
 * instead of quietly reporting an empty list.
 * @module tests/unit/scripts/upstream-public-commits
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeUnlistedReleaseCommit,
  droppedPublicCommits,
  listedPublicCommits,
  REFRESH_PUBLIC_COMMITS_COMMAND,
} from "../../../scripts/lib/upstream-public-commits.mjs";
import { UPSTREAM_PUBLIC_COMMITS } from "../../../src/core/upstream-evidence-manifest.js";

const currentManifest = readFileSync(
  path.resolve("src/core/upstream-evidence-manifest.json"),
  "utf8"
);
const LETTER_FIRST = "a".repeat(40);
const DIGIT_FIRST = `1${"b".repeat(39)}`;
const REFORMATTED = "c".repeat(40);
const TRACKED_HEX_NAMED_FILE = "d".repeat(40);

/**
 * A generated manifest holding the given public-commit lines.
 * @param commitLines - Lines of the public-commit record, already indented
 * @returns Manifest text in the generator's layout
 */
const manifestWith = (commitLines: readonly string[]): string =>
  [
    "{",
    '  "UPSTREAM_SURFACE_MANIFEST": {',
    `    "${TRACKED_HEX_NAMED_FILE}": true`,
    "  },",
    '  "UPSTREAM_PUBLIC_COMMITS": {',
    ...commitLines,
    "  }",
    "}",
    "",
  ].join("\n");

describe("listedPublicCommits", () => {
  it("reads exactly the commits the checked-in manifest records", () => {
    expect(listedPublicCommits(currentManifest)).toEqual(
      new Set(Object.keys(UPSTREAM_PUBLIC_COMMITS))
    );
  });

  it("reads a commit however its key is spelled", () => {
    const listed = listedPublicCommits(
      manifestWith([
        `    "${LETTER_FIRST}": true,`,
        `    ${DIGIT_FIRST}: true,`,
        `    '${REFORMATTED}': true`,
      ])
    );

    expect(listed).toEqual(new Set([LETTER_FIRST, DIGIT_FIRST, REFORMATTED]));
  });

  it("does not read a 40-character path in another block as a commit", () => {
    expect(
      listedPublicCommits(manifestWith([`    "${LETTER_FIRST}": true`])).has(
        TRACKED_HEX_NAMED_FILE
      )
    ).toBe(false);
  });

  it("reads nothing from a manifest with no public-commit record", () => {
    expect(listedPublicCommits('{ "OTHER": { "x": 1 } }\n').size).toBe(0);
  });
});

describe("droppedPublicCommits", () => {
  it("names every recorded commit a new list would leave out", () => {
    const recorded = manifestWith([
      `    "${LETTER_FIRST}": true,`,
      `    '${REFORMATTED}': true`,
    ]);

    expect(droppedPublicCommits(recorded, [LETTER_FIRST])).toEqual([
      REFORMATTED,
    ]);
  });

  it("is empty when the new list only grew", () => {
    const recorded = manifestWith([`    "${LETTER_FIRST}": true`]);

    expect(droppedPublicCommits(recorded, [DIGIT_FIRST, LETTER_FIRST])).toEqual(
      []
    );
  });
});

describe("describeUnlistedReleaseCommit", () => {
  it("names the commit, why it matters, and the refresh command", () => {
    const refusal = describeUnlistedReleaseCommit({
      commit: LETTER_FIRST,
      listedCount: 4512,
    });

    expect(refusal).toContain(LETTER_FIRST);
    expect(refusal).toContain("4512");
    expect(refusal).toContain("lisa file-upstream");
    expect(refusal).toContain(REFRESH_PUBLIC_COMMITS_COMMAND);
    expect(REFRESH_PUBLIC_COMMITS_COMMAND).toBe(
      "node scripts/generate-upstream-evidence-manifest.mjs --refresh-public-commits"
    );
  });
});
