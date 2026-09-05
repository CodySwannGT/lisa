/**
 * The failing sub-check's own words must be the last thing a reader sees.
 *
 * `check:artifacts` runs six sub-checks and keeps going after one fails, which
 * is right — an operator wants every problem in one attempt. The cost was
 * positional: the failing check's diagnostic was buried under the output of
 * every check that passed after it, and the last thing before the summary
 * belonged to a check with nothing wrong with it.
 *
 * Measured on `origin/main` at 4.45.10 (CodySwannGT/lisa#3876). A commit whose
 * staged bytes `lint-staged` had reformatted was refused, and the bottom of the
 * transcript read:
 *
 * ```
 * generated-artifact merge coverage: 4 artifact(s) declared, 2 merge-driver …
 * check:artifacts FAILED, and these are the checks that failed: upstream-evidence-manifest
 * ```
 *
 * Forty lines above, unread, the failing check had already named the file whose
 * bytes moved, the cause, and both regeneration commands. The ticket records
 * the consequence: reading the exit code before reading anything else had
 * become "the reliable habit", and two agents had already diagnosed the wrong
 * sub-check from that tail.
 *
 * These tests pin the ORDER, not the wording of any sub-check. A sub-check is
 * free to change what it says; where it says it is what this file governs.
 * @module tests/unit/scripts/run-artifact-checks
 */

import { describe, expect, it } from "vitest";

import {
  FAILURE_HEADER,
  NO_OUTPUT_NOTE,
  renderReport,
  runArtifactChecks,
  TIMEOUT_NOTE,
} from "../../../scripts/run-artifact-checks.mjs";

/** One sub-check's record, as the runner produces it. */
type Result = {
  readonly name: string;
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly output: string;
};

/** A sub-check that passed and said something unremarkable. */
const passing = (name: string, output: string): Result => ({
  name,
  ok: true,
  timedOut: false,
  output,
});

/** A sub-check that failed and said something worth reading. */
const failing = (name: string, output: string): Result => ({
  name,
  ok: false,
  timedOut: false,
  output,
});

/** What the real merge-coverage check prints when nothing is wrong with it. */
const MERGE_COVERAGE_NOISE =
  "generated-artifact merge coverage: 4 artifact(s) declared, 2 merge-driver covered.";

/** The line an operator actually needs, from the real manifest refusal. */
const REAL_DIAGNOSIS =
  "Error: src/core/upstream-evidence-manifest.ts is stale.\n" +
  "  Fix: bun run build:upstream-evidence-manifest";

describe("renderReport", () => {
  it("ends with the FAILING check's output, not a later passing one's", () => {
    // The defect, stated as an assertion, in the order the real aggregate runs
    // them: the failing manifest check is FIRST and four passing checks follow
    // it. Before this change the last thing printed before the summary was
    // whichever check happened to run last.
    const { lines } = renderReport([
      failing("check:upstream-evidence-manifest", REAL_DIAGNOSIS),
      passing("check:lisa-owned-hash-ledger", "ledger records 75 entries."),
      passing("check:merge-coverage", MERGE_COVERAGE_NOISE),
    ]);

    const summaryIndex = lines.findIndex(line =>
      line.startsWith("check:artifacts FAILED")
    );
    const diagnosisIndex = lines.findIndex(line =>
      line.includes("Fix: bun run build:upstream-evidence-manifest")
    );
    const noiseIndex = lines.indexOf(MERGE_COVERAGE_NOISE);

    expect(summaryIndex, "the summary must be present").toBeGreaterThan(-1);
    expect(diagnosisIndex, "the diagnosis must be present").toBeGreaterThan(-1);
    // The whole point: the answer sits between the passing noise and the
    // verdict, so scrolling to the bottom lands on it.
    expect(noiseIndex).toBeLessThan(diagnosisIndex);
    expect(diagnosisIndex).toBeLessThan(summaryIndex);
  });

  it("keeps every passing check's output rather than hiding it", () => {
    // Reordering must not become suppression. The counts these checks print
    // are the evidence that they examined something.
    const { lines } = renderReport([
      passing("check:merge-coverage", MERGE_COVERAGE_NOISE),
      failing("check:deletion-basis", "deletion basis: refused"),
    ]);

    expect(lines).toContain(MERGE_COVERAGE_NOISE);
    expect(lines).toContain(FAILURE_HEADER);
  });

  it("names every failing check in the summary", () => {
    const { lines, exitCode } = renderReport([
      failing("check:upstream-evidence-manifest", "stale"),
      failing("check:lisa-owned-hash-ledger", "stale too"),
    ]);

    expect(exitCode).toBe(1);
    expect(lines.at(-1)).toBe(
      "check:artifacts FAILED, and these are the checks that failed: " +
        "upstream-evidence-manifest lisa-owned-hash-ledger"
    );
  });

  it("reports the count it actually ran when everything passes", () => {
    const { lines, exitCode } = renderReport([
      passing("check:a", "a ok"),
      passing("check:b", "b ok"),
    ]);

    expect(exitCode).toBe(0);
    expect(lines.at(-1)).toBe(
      "check:artifacts OK - all 2 generated-artifact checks passed."
    );
  });

  it("says an empty failure produced NO output instead of printing a gap", () => {
    // A killed `spawnSync` child returns empty streams, so a blank block is
    // indistinguishable from a check that failed quietly. Refusing to render
    // the gap is what keeps a kill from reading as a content failure — the
    // same confusion the gate vocabulary keeps `UNPROVABLE` for.
    const { lines } = renderReport([failing("check:silent", "")]);

    expect(lines).toContain(NO_OUTPUT_NOTE);
    expect(lines.join("\n")).toContain("possible kill");
  });

  it("says a timed-out check reached no verdict at all", () => {
    const { lines } = renderReport([
      { name: "check:slow", ok: false, timedOut: true, output: "" },
    ]);

    expect(lines).toContain(TIMEOUT_NOTE);
    // And NOT the empty-output note: a budget overrun is a known cause, and
    // reporting it as an unexplained silence would throw that away.
    expect(lines).not.toContain(NO_OUTPUT_NOTE);
  });

  it("would claim success over an empty run, which is why the CLI refuses one", () => {
    // Pins the reason for the CLI's zero-argument refusal rather than leaving
    // it looking like defensive noise. `renderReport` is a pure formatter and
    // has no business inventing a verdict, so the refusal belongs at the entry
    // point — and this is the sentence that would otherwise be printed.
    expect(renderReport([]).lines.at(-1)).toBe(
      "check:artifacts OK - all 0 generated-artifact checks passed."
    );
    expect(renderReport([]).exitCode).toBe(0);
  });
});

describe("runArtifactChecks", () => {
  it("runs the names it is given, in order, and reports on all of them", () => {
    const seen: string[] = [];
    const { lines, exitCode } = runArtifactChecks(
      ["check:one", "check:two"],
      (name: string) => {
        seen.push(name);
        return passing(name, `${name} said something`);
      }
    );

    expect(seen).toEqual(["check:one", "check:two"]);
    expect(exitCode).toBe(0);
    expect(lines).toContain("check:one said something");
    expect(lines).toContain("check:two said something");
  });
});
