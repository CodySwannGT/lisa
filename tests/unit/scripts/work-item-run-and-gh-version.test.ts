/**
 * Tests for two narrow robustness gaps in the work-item tracker.
 *
 * Both are cases where the code reached for something that is not always
 * there: a `stdout` that `spawnSync` sets to null when the child never ran, and
 * a `gh` old enough to reject a JSON field the module depends on. Neither is
 * exotic, and both surface as an error naming the wrong thing — a TypeError
 * about `null`, or an unknown-field message that reads like a Lisa bug.
 * @module tests/unit/scripts/work-item-run-and-gh-version
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  assertGhVersion,
  resetGhVersionCheck,
  run,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

const ABSENT = "lisa-no-such-binary-9f2a";

/**
 * A runner that answers `gh --version` with fixed text.
 * @param stdout - What the fake `gh` prints, or null for a failed spawn
 * @returns A runner plus the commands it was asked to run
 */
function ghPrinting(stdout: string | null) {
  const calls: string[] = [];
  const exec = (command: string) => {
    calls[calls.length] = command;
    return { stdout, stderr: "", status: 0 };
  };
  return { calls, exec };
}

describe("assertGhVersion", () => {
  beforeEach(() => resetGhVersionCheck());

  it("refuses a gh older than the field it depends on", () => {
    const { exec } = ghPrinting("gh version 2.72.0 (2025-01-01)");
    expect(() => assertGhVersion(exec)).toThrow(/2\.72\.0 is too old/u);
  });

  it("names the field and the version to upgrade to", () => {
    // The whole point is replacing an unknown-JSON-field error with a sentence
    // that says which tool is out of date and why.
    const { exec } = ghPrinting("gh version 2.10.0 (2024-05-05)");
    expect(() => assertGhVersion(exec)).toThrow(
      /closedByPullRequestsReferences/u
    );
  });

  it("accepts exactly the minimum", () => {
    const { exec } = ghPrinting("gh version 2.73.0 (2025-04-01)");
    expect(() => assertGhVersion(exec)).not.toThrow();
  });

  it("compares parts, not decimals", () => {
    // `2.9.0` is NEWER than `2.73.0` read as a float, and sorts after it as
    // text. Both shortcuts would wrongly accept 2.9.0 and wrongly reject 2.100.
    const older = ghPrinting("gh version 2.9.0 (2024-01-01)");
    expect(() => assertGhVersion(older.exec)).toThrow(/too old/u);

    resetGhVersionCheck();
    const newer = ghPrinting("gh version 2.100.1 (2027-01-01)");
    expect(() => assertGhVersion(newer.exec)).not.toThrow();

    resetGhVersionCheck();
    const major = ghPrinting("gh version 3.0.0 (2027-06-01)");
    expect(() => assertGhVersion(major.exec)).not.toThrow();
  });

  it("says nothing when the version cannot be read", () => {
    // A diagnostic, not a gate. Refusing on unfamiliar output would invent a
    // failure for a tool that may be perfectly capable, and the real call still
    // surfaces any genuine incompatibility itself.
    expect(() => assertGhVersion(ghPrinting(null).exec)).not.toThrow();
    resetGhVersionCheck();
    expect(() => assertGhVersion(ghPrinting("").exec)).not.toThrow();
    resetGhVersionCheck();
    expect(() =>
      assertGhVersion(ghPrinting("something else entirely").exec)
    ).not.toThrow();
  });

  it("asks the tool once per process, not once per tracker read", () => {
    const { exec, calls } = ghPrinting("gh version 2.96.0 (2026-07-02)");
    assertGhVersion(exec);
    assertGhVersion(exec);
    assertGhVersion(exec);
    expect(calls).toEqual(["gh"]);
  });
});

describe("run: a child that never started", () => {
  it("reports stdout as text, not null, when the spawn fails", () => {
    // `spawnSync` sets stdout to null when no child ran — an absent binary, a
    // permissions failure, a timeout. Every `allowFailure` caller then reaches
    // for `.stdout.trim()` and throws `Cannot read properties of null`, which
    // names a TypeError instead of the real cause, on the exact path written
    // to tolerate failure.
    const result = run(ABSENT, ["--version"], { allowFailure: true });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(() => result.stdout.trim()).not.toThrow();
  });

  it("keeps the underlying failure visible", () => {
    // Normalizing the streams must not hide WHY nothing ran; the error and a
    // non-zero-or-null status are what a caller inspects to find out.
    const result = run(ABSENT, ["--version"], { allowFailure: true });
    expect(result.error).toBeDefined();
    expect(result.status).not.toBe(0);
  });

  it("still throws for a caller that did not opt into failure", () => {
    // The control: normalizing output must not turn a hard failure soft.
    expect(() => run(ABSENT, ["--version"])).toThrow();
  });

  it("leaves a successful command's output untouched", () => {
    const result = run("node", ["-e", "process.stdout.write('hello')"]);
    expect(result.stdout).toBe("hello");
    expect(result.status).toBe(0);
  });
});
