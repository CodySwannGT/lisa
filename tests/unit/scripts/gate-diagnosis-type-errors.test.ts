/**
 * A type checker that ran and found errors is a MEASUREMENT, not an unknown.
 *
 * CodySwannGT/lisa#3946: a `bun run typecheck` failure naming one file, one
 * error, on one line reported as `UNPROVABLE — no recognised failure
 * signature`. `UNPROVABLE` is the word this fleet reads as *"the box — re-run
 * it on a quieter machine"*, so a defect the transcript had already localised
 * was routed into the re-run path, and each push-gate cycle here costs 10-12
 * minutes.
 *
 * That is the inverse of the defect CodySwannGT/lisa#2961 fixed, and the more
 * expensive direction: #2961 was the box wearing the diff's word, this was the
 * diff wearing the box's.
 *
 * ## What these tests are actually guarding
 *
 * Two properties, and the SECOND is the one with teeth:
 *
 * 1. A type-checker transcript classifies as `type-errors`, attributes to
 *    `type-correctness`, and names the offending files.
 * 2. **Every non-measurement guard still outranks it.** A killed, refused,
 *    interfered-with or zero-test run carrying the identical transcript must
 *    still report `UNPROVABLE`. Trading a false unknown for a false failure is
 *    the direction that gets a correct diff blamed for a saturated machine —
 *    exactly what #2961 and CodySwannGT/lisa#3911 exist to prevent — so the
 *    precedence cases below are not decoration.
 *
 * Fixtures are the real emitted strings, read off `scripts/check-typecheck-tests.mjs`
 * and off the transcript quoted in #3946, rather than invented shapes. A
 * classifier tested against text nobody emits proves nothing about the text
 * everybody sees.
 * @module tests/unit/scripts/gate-diagnosis-type-errors
 */

import { describe, expect, it } from "vitest";

import {
  DIAGNOSIS,
  diagnoseFailure,
} from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";

/** One classified failure, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

/**
 * The transcript from #3946, verbatim.
 *
 * Including the trailing advice prose and BOTH task-runner exit lines on
 * purpose: those are what the three-line tail quoted instead of the file name,
 * so a fixture without them cannot reproduce the defect.
 */
const QUARANTINE_OFFENDERS = `type-correctness (tests): 371 file(s) with 1568 error(s); 370 quarantined.

❌ 1 file(s) outside the quarantine have type errors:
   tests/unit/config/coverage-scratch-isolation.test.ts (1)

Fix them. Do NOT add them to typecheck-quarantine.json — that list
only shrinks, and the threshold-ratchet flags additions to it.
error: script "typecheck:tests" exited with code 1
error: script "typecheck" exited with code 1`;

/** The wrapper's other exit-1 branch, which is the same defect one fix away. */
const QUARANTINE_STALE = `❌ 2 quarantined file(s) now type-check and must leave the list:
   tests/a.test.ts
   tests/b.test.ts

Remove them from typecheck-quarantine.json.
error: script "typecheck" exited with code 1`;

/** `tsc --noEmit`'s own diagnostic form, with the parenthesised position. */
const RAW_TSC = `src/core/thing.ts(12,34): error TS2307: Cannot find module './missing'
src/core/other.ts(5,1): error TS2345: Argument of type 'string' is not assignable`;

/** The real refusal wording, pids included — the shape the guard matches. */
const REFUSAL = "child setpgid(12345 to 12340): Operation not permitted";

const diagnose = (output: string, code?: number): Diagnosis =>
  diagnoseFailure(output, code, null) as Diagnosis;

describe("a type checker that ran and found errors", () => {
  it("classifies the transcript from #3946 as a measured type failure", () => {
    const verdict = diagnose(QUARANTINE_OFFENDERS, 1);

    expect(verdict.kind).toBe(DIAGNOSIS.TYPE_ERRORS);
    expect(verdict.kind).not.toBe(DIAGNOSIS.UNDIAGNOSED);
  });

  it("attributes it to type-correctness rather than to nobody", () => {
    // `proves: null` is what routes a verdict into the residual bucket. The
    // attribution is the half that says WHOSE property failed.
    expect(diagnose(QUARANTINE_OFFENDERS, 1).proves).toBe("type-correctness");
  });

  it("names the offending file instead of the task runner's exit lines", () => {
    const { evidence } = diagnose(QUARANTINE_OFFENDERS, 1);

    expect(evidence).toContain(
      "tests/unit/config/coverage-scratch-isolation.test.ts"
    );
    // The precise failure #3946 reports: the three-line tail captured two
    // runner-chain exits and a fragment of the advice sentence, while the
    // naming line sat six lines above.
    expect(evidence.join("\n")).not.toContain("exited with code");
    expect(evidence.join("\n")).not.toContain("only shrinks");
  });

  it("reads tsc's own diagnostic lines, naming each distinct file once", () => {
    const { evidence } = diagnose(RAW_TSC, 1);

    expect(evidence).toEqual(["src/core/thing.ts", "src/core/other.ts"]);
  });

  it("counts a file with many errors once, not once per error", () => {
    // tsc prints one diagnostic line PER ERROR, so a single file with three
    // errors appears three times. Without deduplication the summary reads
    // "errors in 3 file(s)" for one file and the evidence repeats the same
    // path — an operator sizing the work off that number sizes it wrong.
    const verdict = diagnose(
      [
        "src/a.ts(1,1): error TS2304: Cannot find name 'x'",
        "src/a.ts(2,1): error TS2304: Cannot find name 'y'",
        "src/a.ts(3,1): error TS2304: Cannot find name 'z'",
      ].join("\n"),
      1
    );

    expect(verdict.evidence).toEqual(["src/a.ts"]);
    expect(verdict.summary).toContain("1 file(s)");
  });

  it("recognises the stale-quarantine branch too", () => {
    // Not in #3946, and the identical defect one fix away: repair a
    // quarantined file and this branch exits 1 with a named file list.
    const verdict = diagnose(QUARANTINE_STALE, 1);

    expect(verdict.kind).toBe(DIAGNOSIS.TYPE_ERRORS);
    expect(verdict.evidence).toEqual(["tests/a.test.ts", "tests/b.test.ts"]);
  });

  it("does not treat a QUOTED header as the wrapper emitting one", () => {
    // The header pattern is anchored to end-of-line, so `... type errors:` has
    // to BE the line rather than open a sentence. Same principle as requiring
    // tsc's `(line,col)`: the wrapper emitting its header is a measurement,
    // a document quoting that header is talk. Reachable because this
    // repository's own fixtures contain the header verbatim, and a failing
    // suite prints its fixtures.
    const verdict = diagnose(
      [
        "❌ 1 file(s) outside the quarantine have type errors: (as printed by the wrapper)",
        "   tests/some-fixture.test.ts (1)",
      ].join("\n"),
      1
    );

    expect(verdict.kind).toBe(DIAGNOSIS.UNDIAGNOSED);
  });

  it("does not treat PROSE about a TS code as a measurement", () => {
    // A sentence mentioning `error TS18003` is a human discussing a type
    // error. Requiring the parenthesised `(line,col)` position is what keeps
    // talk from being read as a measurement — the failure mode this whole
    // module exists to prevent, in miniature.
    expect(
      diagnose(
        "The migration handles error TS18003: No inputs were found in config file",
        1
      ).kind
    ).toBe(DIAGNOSIS.UNDIAGNOSED);
  });
});

describe("every non-measurement guard still outranks a type transcript", () => {
  // The constraint #3946 sets: a repair must NOT make unrecognised or
  // un-measured output report FAILED. Each case below carries a transcript
  // that WOULD classify as a type failure on its own, above a signal saying
  // the run established nothing. The signal has to win every time.

  it("a terminated run stays killed, whatever its transcript said", () => {
    // 137 is SIGKILL. A command the machine took away measured nothing, so
    // the type errors it printed on the way out are not a verdict.
    const verdict = diagnose(QUARANTINE_OFFENDERS, 137);

    expect(verdict.kind).toBe(DIAGNOSIS.KILLED);
    expect(verdict.proves).toBeNull();
  });

  it("a SIGTERM stays killed", () => {
    expect(diagnose(QUARANTINE_OFFENDERS, 143).kind).toBe(DIAGNOSIS.KILLED);
  });

  it("an OS resource refusal outranks it", () => {
    const verdict = diagnose(`${REFUSAL}\n${QUARANTINE_OFFENDERS}`, 1);

    expect(verdict.kind).toBe(DIAGNOSIS.RESOURCE_REFUSED);
    expect(verdict.proves).toBeNull();
  });

  it("a fork refusal outranks it", () => {
    expect(
      diagnose(
        `fork: Resource temporarily unavailable\n${QUARANTINE_OFFENDERS}`,
        1
      ).kind
    ).toBe(DIAGNOSIS.RESOURCE_REFUSED);
  });

  it("a run that executed zero test files outranks it", () => {
    expect(
      diagnose(`No test files found\n${QUARANTINE_OFFENDERS}`, 1).kind
    ).toBe(DIAGNOSIS.NO_TESTS_RAN);
  });

  it("an empty or absent transcript is still uncaptured", () => {
    expect(diagnose("", 1).kind).toBe(DIAGNOSIS.UNCAPTURED);
    expect((diagnoseFailure(null, 1, null) as Diagnosis).kind).toBe(
      DIAGNOSIS.UNCAPTURED
    );
  });

  it("genuinely unrecognised output is still undiagnosed", () => {
    // The residual bucket must keep working. Narrowing it is the point of the
    // change; emptying it would be the same defect from the other side.
    expect(
      diagnose(
        "ld: symbol(s) not found for architecture arm64\nclang: linker command failed",
        1
      ).kind
    ).toBe(DIAGNOSIS.UNDIAGNOSED);
  });
});

describe("the residual tail spends its three lines on lines that carry something", () => {
  it("drops the task runner's own exit chain", () => {
    // #3946's second contributing defect. A failing chain prints one
    // `exited with code N` PER LINK, and they crowded out the only
    // informative line. Filtering beats widening: widening quotes more of
    // everything, including more noise.
    const { evidence } = diagnose(
      [
        "the widget exploded",
        "and took the build with it",
        'error: script "inner" exited with code 1',
        'error: script "outer" exited with code 1',
      ].join("\n"),
      1
    );

    expect(evidence).toEqual([
      "the widget exploded",
      "and took the build with it",
    ]);
  });

  it("still quotes the chain when it is all there is", () => {
    // Three useless lines beat none: a transcript of nothing but chain noise
    // must not produce an empty evidence list, which reads as "we captured
    // nothing" — a different and wronger story than "we captured only this".
    const { evidence } = diagnose('error: script "x" exited with code 1', 1);

    expect(evidence).toEqual(['error: script "x" exited with code 1']);
  });
});
