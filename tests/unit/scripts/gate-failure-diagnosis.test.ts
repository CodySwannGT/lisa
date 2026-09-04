/**
 * Tests for the classifier that turns a failed gate's output into a verdict.
 *
 * The assertions that carry weight are the PRECEDENCE ones. A vitest run whose
 * tests timed out still prints coverage errors, and they are always low,
 * because the code the dead tests would have exercised went unexercised.
 * Reading the threshold line off such a run is how "the machine was busy"
 * became "coverage regressed" six times in a row.
 * @module tests/unit/scripts/gate-failure-diagnosis
 */

import { describe, expect, it } from "vitest";

import {
  DIAGNOSIS,
  diagnoseFailure,
  tempRootPopulation,
} from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";

/** One classified failure, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

const TIMEOUT_LINE = "Error: Test timed out in 60000ms.";
const HOOK_TIMEOUT_LINE = "Error: Hook timed out in 60000ms.";
const THRESHOLD_LINE =
  "ERROR: Coverage for statements (85.12%) does not meet global threshold (86%)";

describe("diagnoseFailure: a killed command is not a failed one", () => {
  // CodySwannGT/lisa#2897. `exit 143` is `128 + 15` — SIGTERM. On a saturated
  // box a contention kill arrives with a TRUNCATED transcript that reads
  // exactly like a real gate failure, so one `exit 1` on this gate had at least
  // three distinct causes and re-running was a rational response to all three.
  // That is why the real one never got looked at.
  //
  // The kill is legible only in the exit code, so these cases pass one. The
  // output handed alongside it is deliberately a convincing failure transcript:
  // if the classifier read it, it would say the wrong thing confidently.

  const TRUNCATED = [
    " FAIL  tests/unit/a.test.ts > does a thing",
    "Tests  3 failed | 900 passed (903)",
  ].join("\n");

  it.each([
    [143, "SIGTERM"],
    [137, "SIGKILL"],
    [130, "SIGINT"],
    [152, "SIGXCPU"],
  ])("reads exit %i as a kill by %s", (code, signal) => {
    const verdict: Diagnosis = diagnoseFailure(TRUNCATED, code);

    expect(verdict.kind).toBe(DIAGNOSIS.KILLED);
    expect(verdict.summary).toContain(signal);
  });

  it("shows the arithmetic, so 143 stops looking like an ordinary code", () => {
    expect(diagnoseFailure(TRUNCATED, 143).summary).toContain("128 + 15");
  });

  it("says terminated, NOT failed, and does not count the tests", () => {
    const verdict: Diagnosis = diagnoseFailure(TRUNCATED, 143);

    expect(verdict.summary).toContain("NOT failed");
    expect(verdict.summary).not.toContain("ran and failed");
  });

  it("outranks the failure signatures the truncated transcript carries", () => {
    // Without the exit code this same output is an assertion failure, and the
    // next case proves that it still is. The kill is what changes the verdict.
    expect(diagnoseFailure(TRUNCATED, 143).kind).toBe(DIAGNOSIS.KILLED);
    expect(diagnoseFailure(TRUNCATED).kind).toBe(DIAGNOSIS.ASSERTION);
  });

  it("blames nobody, because a terminated command measured nothing", () => {
    // The load-bearing half. `proves: "test-correctness"` on a kill would print
    // a verdict about a property no run ever reached.
    expect(diagnoseFailure(TRUNCATED, 143).proves).toBeNull();
  });

  it("treats a missing exit code as a termination", () => {
    // What the runner produces for a child killed by a signal: `spawnSync`
    // reports `status: null`, and the runner already calls that terminated.
    const verdict: Diagnosis = diagnoseFailure(TRUNCATED, null);

    expect(verdict.kind).toBe(DIAGNOSIS.KILLED);
    expect(verdict.summary).toContain("no exit code");
  });

  it("does not read an ordinary failure as a kill", () => {
    expect(diagnoseFailure(TRUNCATED, 1).kind).toBe(DIAGNOSIS.ASSERTION);
    expect(diagnoseFailure(TRUNCATED, 127).kind).toBe(DIAGNOSIS.ASSERTION);
  });

  it("leaves the no-code caller alone, because absent is not terminated", () => {
    // `undefined` means the caller supplied nothing. Conflating it with `null`
    // would turn every code-less caller's verdict into a kill — this module's
    // own defect, committed again one level down.
    expect(diagnoseFailure(TRUNCATED, undefined).kind).toBe(
      DIAGNOSIS.ASSERTION
    );
  });
});

describe("diagnoseFailure: precedence", () => {
  it("calls a run with timeouts AND threshold errors a timeout", () => {
    const verdict: Diagnosis = diagnoseFailure(
      [TIMEOUT_LINE, THRESHOLD_LINE, "Tests  1 failed | 10 passed"].join("\n")
    );

    expect(verdict.kind).toBe(DIAGNOSIS.TIMEOUT);
  });

  it("says a timed-out run is not a coverage shortfall, in words", () => {
    expect(diagnoseFailure(TIMEOUT_LINE).summary).toContain(
      "NOT a coverage shortfall"
    );
  });

  it("counts hook timeouts as timeouts too", () => {
    expect(diagnoseFailure(HOOK_TIMEOUT_LINE).kind).toBe(DIAGNOSIS.TIMEOUT);
  });

  it("names the budget that was blown", () => {
    expect(diagnoseFailure(TIMEOUT_LINE).summary).toContain("60000ms");
  });

  it("calls a completed run with failures an assertion failure", () => {
    const verdict: Diagnosis = diagnoseFailure(
      [
        " FAIL  tests/unit/thing.test.ts > does a thing",
        "Tests  3 failed | 7 passed (10)",
        THRESHOLD_LINE,
      ].join("\n")
    );

    expect(verdict.kind).toBe(DIAGNOSIS.ASSERTION);
    expect(verdict.summary).toContain("3 test(s)");
  });

  it("calls a clean run below its floor a threshold miss", () => {
    const verdict: Diagnosis = diagnoseFailure(
      ["Tests  10 passed (10)", THRESHOLD_LINE].join("\n")
    );

    expect(verdict.kind).toBe(DIAGNOSIS.THRESHOLD);
    expect(verdict.evidence).toContain("statements 85.12% < 86% (global)");
  });

  it("reads a per-glob threshold as well as the global one", () => {
    const verdict: Diagnosis = diagnoseFailure(
      'ERROR: Coverage for lines (33.33%) does not meet "src/math.ts" threshold (85%)'
    );

    expect(verdict.kind).toBe(DIAGNOSIS.THRESHOLD);
    expect(verdict.evidence[0]).toContain("33.33% < 85%");
  });
});

describe("diagnoseFailure: when it cannot tell", () => {
  it("refuses to guess when no output was captured", () => {
    expect(diagnoseFailure(null).kind).toBe(DIAGNOSIS.UNCAPTURED);
  });

  it("treats empty output as uncaptured rather than as a clean run", () => {
    expect(diagnoseFailure("").kind).toBe(DIAGNOSIS.UNCAPTURED);
  });

  it("names every capture capability instead of prescribing one env flag", () => {
    const summary = diagnoseFailure(null).summary;
    expect(summary).toContain("LISA_GATES_CAPTURE=0");
    expect(summary).toContain("no `tee`");
    expect(summary).toContain("temporary directory");
    expect(summary).not.toContain("LISA_GATES_CAPTURE=1");
  });

  it("does not tell an operator to restore capture that already worked", () => {
    // The defect. An empty string is a transcript that ARRIVED — capture ran
    // and there was nothing to read — and it used to be described with the
    // same sentence as a transcript that never arrived at all. That sends
    // someone to repair `tee`, LISA_GATES_CAPTURE or the temp directory, none
    // of which is broken, and says nothing about the signal that is actually
    // present: a command that exited nonzero without printing a word.
    const summary = diagnoseFailure("").summary;

    expect(summary).toContain("captured and is empty");
    expect(summary).not.toContain("no output was captured");
    expect(summary).not.toContain("Restore capture capability");
  });

  it("keeps the two no-transcript states telling different stories", () => {
    // Same kind, because both leave this module with nothing to read and
    // `uncaptured` is deliberately outside `MEASURED_NOTHING`. Different
    // sentence, because the repairs are opposite ones.
    expect(diagnoseFailure("").kind).toBe(diagnoseFailure(null).kind);
    expect(diagnoseFailure("").summary).not.toBe(diagnoseFailure(null).summary);
  });

  it("quotes the last meaningful lines when nothing is recognised", () => {
    const verdict: Diagnosis = diagnoseFailure(
      "tsc: error TS2307: Cannot find module './missing'\n\n"
    );

    expect(verdict.kind).toBe(DIAGNOSIS.UNDIAGNOSED);
    expect(verdict.evidence).toContain(
      "tsc: error TS2307: Cannot find module './missing'"
    );
  });

  it("reaches past a task runner's own exit line to the real one", () => {
    // Measured on this runner: the last line of a failing `bun run` chain says
    // only what the exit code already said. Quoting one line would have quoted
    // that one and nothing else.
    const verdict: Diagnosis = diagnoseFailure(
      [
        "Run `bun run build:lisa-owned-hash-ledger` and commit the result.",
        'error: script "check:lisa-owned-hash-ledger" exited with code 1',
        'error: script "check:artifacts" exited with code 1',
      ].join("\n")
    );

    expect(verdict.evidence).toContain(
      "Run `bun run build:lisa-owned-hash-ledger` and commit the result."
    );
  });

  it("never claims a coverage shortfall it did not read", () => {
    expect(diagnoseFailure("oxlint found 4 errors").summary).not.toContain(
      "coverage"
    );
  });
});

describe("diagnoseFailure: evidence stays readable", () => {
  it("caps the named examples and says how many were dropped", () => {
    const many = Array.from(
      { length: 9 },
      (_unused, index) => ` FAIL  tests/unit/suite-${index}.test.ts > case`
    ).join("\n");
    // Temp-root reading suppressed: this case is about the CAP, and a timeout
    // verdict now also carries the shared temp root's population. Left to its
    // default that reading comes off the real machine, which would make the
    // assertion depend on whether this box's temp root happened to be
    // readable — a coin flip, and the same hazard the load reading is injected
    // to avoid.
    const verdict: Diagnosis = diagnoseFailure(
      `${many}\n${TIMEOUT_LINE}`,
      undefined,
      undefined,
      undefined,
      null
    );

    expect(verdict.evidence).toHaveLength(6);
    expect(verdict.evidence.at(-1)).toBe("…and 4 more");
  });

  it("does not repeat a suite that failed more than once", () => {
    // Temp-root reading suppressed for the same reason as the cap case above:
    // this asserts dedup of NAMED SUITES, and an exact-equality assertion
    // would otherwise be hostage to whether the real temp root read.
    const verdict: Diagnosis = diagnoseFailure(
      [
        " FAIL  tests/unit/same.test.ts > one",
        " FAIL  tests/unit/same.test.ts > two",
        TIMEOUT_LINE,
      ].join("\n"),
      undefined,
      undefined,
      undefined,
      null
    );

    expect(verdict.evidence).toEqual(["tests/unit/same.test.ts"]);
  });
});

describe("diagnoseFailure: whose property the failure was", () => {
  // Hardcoded gate ids rather than read back off ATTRIBUTION: a test that
  // asserts a mapping by consulting the same mapping proves only that it
  // equals itself.
  it("blames the test suite for a timeout, not the coverage number", () => {
    const verdict: Diagnosis = diagnoseFailure(
      [TIMEOUT_LINE, THRESHOLD_LINE].join("\n")
    );

    expect(verdict.proves).toBe("test-correctness");
  });

  it("blames the test suite for a failed assertion", () => {
    const verdict: Diagnosis = diagnoseFailure(
      "Tests  2 failed | 14274 passed (14276)"
    );

    expect(verdict.proves).toBe("test-correctness");
  });

  it("blames coverage only when the suite finished and the floor was missed", () => {
    const verdict: Diagnosis = diagnoseFailure(
      ["Tests  14276 passed (14276)", THRESHOLD_LINE].join("\n")
    );

    expect(verdict.proves).toBe("coverage-adequacy");
  });

  it("blames nobody when it recognised nothing", () => {
    // An attribution invented from an unrecognised transcript would be the
    // original defect with better prose: a verdict asserted about a property
    // nothing measured.
    expect(diagnoseFailure("boom: the widget exploded").proves).toBeNull();
    expect(diagnoseFailure(null).proves).toBeNull();
  });
});

/**
 * A concurrent coverage run deleting this run's scratch files, both shapes.
 *
 * Transcribed from measurement rather than invented (2026-08-23, vitest 4.1.9,
 * this repository). One coverage run over `tests/unit/core/`; at the
 * eight-second mark a second process did to `coverage/.tmp` exactly what a
 * second coverage run's own `clean()` does. Twice, differing only in whether
 * the directory was put back:
 *
 * - removed **and re-created** — a bare `ENOENT`, no explanation at all;
 * - removed and **left absent** — the coverage provider's own sentence naming
 *   concurrent runs as the cause.
 *
 * The first is the one that happens, because a real second run re-creates the
 * directory in the statement after it removes it. So the provider's message is
 * unreachable in precisely the case it was written for, and the operator gets
 * the bare form — which is how CodySwannGT/lisa#2961 arrived filed as a
 * coverage-gate failure.
 */
describe("diagnoseFailure: a run whose scratch files were deleted under it", () => {
  /** The bare shape: the directory was removed and immediately re-created. */
  const RECREATED = [
    "⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯",
    "Error: ENOENT: no such file or directory, open '/repo/coverage/.tmp/coverage-0.json'",
    " ❯ open node:internal/fs/promises:636:25",
    "Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', path: '/repo/coverage/.tmp/coverage-0.json' }",
  ].join("\n");

  /** The hinted shape: the directory was removed and left absent. */
  const ABSENT = [
    "⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯",
    'Error: Something removed the coverage directory "/repo/coverage/.tmp" Vitest created earlier. Make sure you are not running multiple Vitests with the same "coverage.reportsDirectory" at the same time.',
    "Caused by: Error: ENOENT: no such file or directory, open '/repo/coverage/.tmp/coverage-9.json'",
  ].join("\n");

  it("recognises the bare ENOENT the provider cannot explain", () => {
    const verdict: Diagnosis = diagnoseFailure(RECREATED, 1);

    expect(verdict.kind).toBe(DIAGNOSIS.INTERFERENCE);
    expect(verdict.evidence).toContain("/repo/coverage/.tmp/coverage-0.json");
  });

  it("recognises the shape the provider does explain", () => {
    expect(diagnoseFailure(ABSENT, 1).kind).toBe(DIAGNOSIS.INTERFERENCE);
  });

  it("says it is not a coverage shortfall, in those words", () => {
    // The whole point of the classification. An operator reading this must not
    // go looking for a coverage regression, because none was measured.
    expect(diagnoseFailure(RECREATED, 1).summary).toContain(
      "NOT a coverage shortfall"
    );
  });

  it("attributes it to nobody, because nothing was measured", () => {
    expect(diagnoseFailure(RECREATED, 1).proves).toBeNull();
  });

  it("outranks a timeout in the same transcript", () => {
    // A test that timed out before the scratch files vanished is a real fact,
    // and it is still not what stopped the run. Reporting the timeout would
    // send the reader to tune a budget when the answer is "two runs shared one
    // directory".
    const both = `Error: Test timed out in 60000ms.\n${RECREATED}`;

    expect(diagnoseFailure(both, 1).kind).toBe(DIAGNOSIS.INTERFERENCE);
  });

  it("does not fire on a kill, which outranks it", () => {
    // A terminated command's transcript is whatever happened to be printed
    // before the signal, so nothing in it may be read as a cause.
    expect(diagnoseFailure(RECREATED, 143).kind).toBe(DIAGNOSIS.KILLED);
  });

  it("does not fire on an ordinary missing file", () => {
    // `coverage-<n>.json` is the coverage provider's own naming and nothing
    // else in a gate transcript is called that. An ENOENT on anything else is
    // still undiagnosed.
    expect(
      diagnoseFailure(
        "Error: ENOENT: no such file or directory, open '/repo/dist/index.js'",
        1
      ).kind
    ).toBe(DIAGNOSIS.UNDIAGNOSED);
  });
});

describe("diagnoseFailure: the shared temp root beside a timeout", () => {
  const CROWDED = { entries: 46_000, inodeBytes: 26_000_000 };
  const QUIET = { entries: 12, inodeBytes: 352 };

  /**
   * A timeout verdict carrying a stated temp-root reading.
   * @param reading - The population to report, or null to suppress the line.
   * @returns The verdict.
   */
  const timeoutWith = (
    reading: { entries: number; inodeBytes: number } | null
  ): Diagnosis =>
    diagnoseFailure(
      TIMEOUT_LINE,
      undefined,
      undefined,
      undefined,
      reading
    ) as Diagnosis;

  it("names the entry count and the inode size", () => {
    // Both numbers, because only one of them a prune can fix.
    const evidence = timeoutWith(CROWDED).evidence.join("\n");
    expect(evidence).toContain("46000 entries");
    expect(evidence).toContain("25391 KB");
  });

  it("reports a QUIET root too, so the line can rule crowding OUT", () => {
    // The same principle the load line states about itself: reporting only the
    // alarming case makes it a rubber stamp for "not my change". A small root
    // is the evidence that this timeout is somebody's actual bug.
    expect(timeoutWith(QUIET).evidence.join("\n")).toContain("12 entries");
  });

  it("asserts no threshold, in either direction", () => {
    // The calibration gap is real and unmeasured: ~16.5k showed NO mkdtemp
    // penalty on the platform where ~46k was reported harmful. A verdict word
    // here would be a guess wearing a number's clothes, and a detector that
    // fires on an ordinary busy workstation trains its readers to skip it.
    for (const reading of [CROWDED, QUIET]) {
      const evidence = timeoutWith(reading).evidence.join("\n");
      expect(evidence).not.toMatch(/\bexceeds\b|\btoo many\b|\bover the\b/i);
      expect(evidence).toContain("not a verdict");
    }
  });

  it("says the inode is the part a prune does not fix", () => {
    // A directory inode does not shrink when entries are removed, so "I
    // cleaned it up" is not the same claim as "it is cheap to walk again".
    expect(timeoutWith(CROWDED).evidence.join("\n")).toContain(
      "the part a prune does not fix"
    );
  });

  it("adds nothing when the reading is unavailable", () => {
    expect(timeoutWith(null).evidence).toEqual([]);
  });

  it("keeps the named suites ahead of the reading", () => {
    // The suites are what the reader acts on; the temp-root line is context.
    const verdict = diagnoseFailure(
      [" FAIL  tests/unit/slow.test.ts > case", TIMEOUT_LINE].join("\n"),
      undefined,
      undefined,
      undefined,
      CROWDED
    ) as Diagnosis;
    expect(verdict.evidence[0]).toBe("tests/unit/slow.test.ts");
    expect(verdict.evidence).toHaveLength(2);
  });

  it("attaches to a timeout only, not to an assertion failure", () => {
    // On a failing assertion the temp root is noise: the run reached a verdict
    // about the code, and crowding did not produce it.
    const verdict = diagnoseFailure(
      " FAIL  tests/unit/broken.test.ts > case",
      undefined,
      undefined,
      undefined,
      CROWDED
    ) as Diagnosis;
    expect(verdict.kind).toBe(DIAGNOSIS.ASSERTION);
    expect(verdict.evidence.join("\n")).not.toContain("entries");
  });
});

describe("tempRootPopulation", () => {
  it("reads the entry count and the directory inode size", () => {
    expect(
      tempRootPopulation(
        () => ["a", "b", "c"],
        () => 4096
      )
    ).toEqual({ entries: 3, inodeBytes: 4096 });
  });

  it("returns null rather than guessing when a read throws", () => {
    // A temp root that cannot be listed is unknown, not empty — and "0
    // entries" would be a confident wrong answer printed beside a failure.
    expect(
      tempRootPopulation(
        () => {
          throw new Error("EACCES");
        },
        () => 4096
      )
    ).toBeNull();
  });

  it("returns null when the inode size is not a number", () => {
    expect(
      tempRootPopulation(
        () => [],
        () => Number.NaN
      )
    ).toBeNull();
  });
});
