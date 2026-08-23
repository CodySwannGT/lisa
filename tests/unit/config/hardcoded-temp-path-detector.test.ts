/**
 * The hardcoded-temp-path guard can fail, proved against inputs.
 *
 * CodySwannGT/lisa#2950. Both arms of the guard in `test-scratch-guard.test.ts`
 * scan the real `tests/` tree and assert the offender list is `[]`. That proves
 * the scan RAN over a clean tree; it says nothing about whether the detector
 * detects. The second arm is the sharp case, because its matcher is assembled
 * at runtime from six creator names and three escaped roots — a typo anywhere
 * in that construction yields a regex matching nothing, an offender list that
 * is `[]` for the wrong reason, and a permanently green guard.
 *
 * Every fixture below is ASSEMBLED from fragments rather than written out. A
 * literal `/tmp/...` creation call in this file would be found by the very scan
 * it exists to exercise, and the guard would report itself — which is how the
 * suite learned to write these, after prettier reflowed a comment in
 * `test-budget-conformance` onto a line the scan then flagged.
 * @module tests/unit/config/hardcoded-temp-path-detector
 */
import { describe, expect, it } from "vitest";

import {
  creationOffences,
  describeOffence,
  sharedRootOffences,
  sharedTempRoot,
} from "../../helpers/hardcoded-temp-path-scan.js";

/** Stand-in path the control cases are reported against. */
const SAMPLE = "tests/sample.ts";

/** The macOS shared per-user temp root, from the detector's own definition. */
const SHARED = sharedTempRoot();

/**
 * Build a creation call without writing one.
 * @param creator - Name of the creating function
 * @param root - Absolute temp root the call names
 * @returns A line of source containing exactly one offence
 */
function creation(creator: string, root: string): string {
  return `const dir = ${creator}(${JSON.stringify(`${root}/fixture-`)});`;
}

describe("the hardcoded-temp-path detector detects", () => {
  it("flags every creator name the matcher claims to know", () => {
    // Six alternatives assembled into one regex at runtime. Exercising one of
    // them would leave five untested inside a construction where a single typo
    // silences the whole thing.
    const creators = [
      "mkdtemp",
      "mkdtempSync",
      "mkdir",
      "mkdirSync",
      "ensureDir",
      "ensureDirSync",
    ];

    for (const creator of creators) {
      expect(
        creationOffences(SAMPLE, creation(creator, "/tmp")),
        `the matcher does not know ${creator}, so a fixture using it escapes ` +
          "the scratch root unnoticed"
      ).toHaveLength(1);
    }
  });

  it("flags every absolute root the matcher claims to know", () => {
    for (const root of ["/tmp", "/private/tmp", SHARED.slice(0, -1)]) {
      expect(
        creationOffences(SAMPLE, creation("mkdtempSync", root)),
        `the matcher does not know ${root}`
      ).toHaveLength(1);
    }
  });

  it("names the offending path, not only the file", () => {
    // #2886's criterion says "naming the file and the path". The file was
    // named; the path was described only as a class, in the message, leaving
    // the reader to search the file for whichever of eighteen combinations
    // tripped it.
    const offences = creationOffences(SAMPLE, creation("mkdtempSync", "/tmp"));

    expect(offences.map(describeOffence)).toEqual([
      `${SAMPLE}: ${"/tmp"}/fixture-`,
    ]);
  });

  it("flags a source that names the shared per-user root at all", () => {
    const source = `const shared = ${JSON.stringify(`${SHARED}abc123/T`)};`;

    expect(sharedRootOffences(SAMPLE, source).map(describeOffence)).toEqual([
      `${SAMPLE}: ${SHARED}abc123/T`,
    ]);
  });

  it("leaves a temp path that is only mentioned, never created at, alone", () => {
    // The narrowness is deliberate and load-bearing. A guard that flagged a
    // path inside an expectation or a diagnostic string would be turned off,
    // and a guard that is turned off protects nothing.
    const source = [
      `expect(message).toContain(${JSON.stringify("/tmp")});`,
      `const label = ${JSON.stringify("/private/tmp is the shared root")};`,
      'const dir = mkdtempSync(path.join(os.tmpdir(), "fixture-"));',
    ].join("\n");

    expect(creationOffences(SAMPLE, source)).toEqual([]);
  });

  it("finds nothing in a source that has nothing", () => {
    // The negative control for the positive controls: the cases above would
    // all still pass if the detector simply flagged everything.
    expect(creationOffences(SAMPLE, "const x = 1;\n")).toEqual([]);
    expect(sharedRootOffences(SAMPLE, "const x = 1;\n")).toEqual([]);
  });
});
