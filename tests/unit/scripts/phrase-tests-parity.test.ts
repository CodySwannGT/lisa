/**
 * The manifest parity verdict (CodySwannGT/lisa#4609). It must never pass
 * vacuously: a base that deletes nothing, a deleted file that was not
 * phrase-only, or a deleted set that differs from the files the manifest says
 * it came from are all failures, as is a missing assertion.
 * @module tests/unit/scripts/phrase-tests-parity
 */
import { describe, expect, it } from "vitest";

import {
  buildManifest,
  entryKey,
} from "../../../scripts/lib/phrase-tests/manifest.mjs";
import { parityFailures } from "../../../scripts/lib/phrase-tests/parity.mjs";

const A_TEST = "tests/a.test.ts";
const B_TEST = "tests/b.test.ts";

const entry = {
  file: "docs/a.md",
  polarity: "required",
  kind: "string",
  value: "alpha",
  source: `${A_TEST} › a > pins`,
} as const;

const recording = {
  file: A_TEST,
  raw: 1,
  reasons: [] as string[],
  entries: [entry],
};

/**
 * A fold over the given recordings, as foldPhraseTests returns it.
 * @param recordings - Recordings of the deleted phrase-only files
 * @returns The fold
 */
function fold(recordings: readonly (typeof recording)[]) {
  const translated = recordings.filter(item => item.reasons.length === 0);
  return {
    testFiles: recordings.length,
    recordings: [...recordings],
    translated,
    untranslatable: recordings.filter(item => item.reasons.length > 0),
    raw: translated.reduce((sum, item) => sum + item.raw, 0),
    keys: new Set(translated.flatMap(item => item.entries.map(entryKey))),
  };
}

const manifest = buildManifest([recording]);

describe("parityFailures", () => {
  it("passes when the deleted files are exactly the manifest's sources and every assertion is in it", () => {
    expect(
      parityFailures({
        deleted: [A_TEST],
        fold: fold([recording]),
        manifest,
        exact: true,
      })
    ).toEqual([]);
  });

  it("fails when the base deletes nothing, instead of passing vacuously", () => {
    const failures = parityFailures({
      deleted: [],
      fold: fold([]),
      manifest,
      exact: true,
    });
    expect(failures.join("\n")).toContain("no test file");
    expect(failures.join("\n")).toContain(A_TEST);
  });

  it("fails when a deleted test file was not phrase-only", () => {
    const failures = parityFailures({
      deleted: [A_TEST, B_TEST],
      fold: fold([recording]),
      manifest,
      exact: true,
    });
    expect(failures.join("\n")).toContain(`not phrase-only: ${B_TEST}`);
  });

  it("fails when an assertion of a deleted file is missing from the manifest", () => {
    const extra = {
      ...recording,
      entries: [entry, { ...entry, value: "beta" }],
    };
    const failures = parityFailures({
      deleted: [A_TEST],
      fold: fold([extra]),
      manifest,
      exact: false,
    });
    expect(failures.join("\n")).toContain("missing from the manifest");
    expect(failures.join("\n")).toContain("beta");
  });

  it("fails with --exact when the manifest holds an entry no deleted file asserted", () => {
    const failures = parityFailures({
      deleted: [A_TEST],
      fold: fold([{ ...recording, entries: [] }]),
      manifest,
      exact: true,
    });
    expect(failures.join("\n")).toContain("asserted by no deleted file");
  });

  it("fails when a deleted phrase-only file was untranslatable", () => {
    const failures = parityFailures({
      deleted: [A_TEST],
      fold: fold([{ ...recording, reasons: ["a: section"] }]),
      manifest,
      exact: false,
    });
    expect(failures.join("\n")).toContain("not translatable");
  });
});
