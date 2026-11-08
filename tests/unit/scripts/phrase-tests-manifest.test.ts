/**
 * The required-phrases manifest (CodySwannGT/lisa#4609): how recorded entries
 * fold into it, and the failure message the data-driven test reports. A
 * failure must name the file and the phrase so a reader can act on it alone.
 * @module tests/unit/scripts/phrase-tests-manifest
 */
import { describe, expect, it } from "vitest";

import {
  buildManifest,
  entryKey,
  manifestEntries,
  phraseFailure,
} from "../../../scripts/lib/phrase-tests/manifest.mjs";

const A_TEST = "tests/a.test.ts";
const B_TEST = "tests/b.test.ts";
const A_DOC = "docs/a.md";
const SKILL = "skills/x/SKILL.md";

const records = [
  {
    file: B_TEST,
    raw: 3,
    reasons: [],
    entries: [
      {
        file: "docs/z.md",
        polarity: "required",
        kind: "string",
        value: "zulu",
        source: `${B_TEST} › b > one`,
      },
      {
        file: A_DOC,
        polarity: "forbidden",
        kind: "pattern",
        value: { source: "bad", flags: "i" },
        source: `${B_TEST} › b > one`,
      },
      {
        file: A_DOC,
        polarity: "required",
        kind: "string",
        value: "alpha",
        source: `${B_TEST} › b > one`,
      },
    ],
  },
  {
    file: A_TEST,
    raw: 1,
    reasons: [],
    entries: [
      {
        file: A_DOC,
        polarity: "required",
        kind: "string",
        value: "alpha",
        source: `${A_TEST} › a > one`,
      },
    ],
  },
] as const;

describe("buildManifest", () => {
  const manifest = buildManifest(records);

  it("keys entries by the file read, sorted, with a $comment", () => {
    expect(Object.keys(manifest.files)).toEqual([A_DOC, "docs/z.md"]);
    expect(manifest.$comment.join(" ")).toContain("hand-maintained");
  });

  it("dedupes phrases and lists every source test file once", () => {
    expect(manifest.files[A_DOC]).toEqual({
      required: ["alpha"],
      forbidden: [],
      requiredPatterns: [],
      forbiddenPatterns: [{ source: "bad", flags: "i" }],
      source: [`${A_TEST} › a > one`, `${B_TEST} › b > one`],
    });
  });

  it("flattens back to one entry per (file, phrase)", () => {
    expect(manifestEntries(manifest).map(entryKey)).toEqual([
      entryKey({
        file: A_DOC,
        polarity: "required",
        kind: "string",
        value: "alpha",
      }),
      entryKey({
        file: A_DOC,
        polarity: "forbidden",
        kind: "pattern",
        value: { source: "bad", flags: "i" },
      }),
      entryKey({
        file: "docs/z.md",
        polarity: "required",
        kind: "string",
        value: "zulu",
      }),
    ]);
  });
});

describe("phraseFailure", () => {
  const required = {
    file: SKILL,
    polarity: "required",
    kind: "string",
    value: "Never guess",
  } as const;
  const forbidden = {
    file: SKILL,
    polarity: "forbidden",
    kind: "pattern",
    value: { source: "TODO\\b", flags: "u" },
  } as const;

  it("passes when a required phrase is present and a forbidden one absent", () => {
    expect(phraseFailure("We Never guess.", required)).toBeUndefined();
    expect(phraseFailure("Done.", forbidden)).toBeUndefined();
  });

  it("names the file and the phrase when a required phrase is missing", () => {
    const failure = phraseFailure("We sometimes guess.", required);
    expect(failure).toContain(SKILL);
    expect(failure).toContain('"Never guess"');
    expect(failure).toContain("missing required");
  });

  it("names the file and the pattern when a forbidden pattern is present", () => {
    const failure = phraseFailure("TODO later", forbidden);
    expect(failure).toContain(SKILL);
    expect(failure).toContain("/TODO\\b/u");
    expect(failure).toContain("contains forbidden");
  });

  it("fails when the manifest file does not exist", () => {
    expect(phraseFailure(undefined, required)).toContain(
      "skills/x/SKILL.md does not exist"
    );
  });
});
