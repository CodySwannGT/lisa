/**
 * Tests for the contract between the gate runner and the git hooks.
 *
 * Two things are asserted here, and both are about the hooks NOT being told
 * that something was proved when it was not:
 *
 * - The exit codes stay distinct, so "the runner could not run" can never be
 *   read by a shell as "every gate passed".
 * - A half-written gates block sends the hook back to its built-in checks. The
 *   first gates block ever authored declared `code-style` at commit and said
 *   nothing about `credential-leakage`; handing that moment to the registry
 *   would have removed gitleaks from every commit in the repository while
 *   reporting a clean run.
 * @module tests/unit/scripts/lisa-run-gates-floor
 */

import { describe, expect, it } from "vitest";

import {
  EXIT,
  undeclaredFloor,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  FORMAT,
  LEAKAGE,
  REQUIRED_AT_COMMIT,
  runCli,
  STRUCTURAL,
  STYLE,
} from "./lisa-run-gates-fixtures.js";

describe("a half-written gates block cannot delete a guarantee", () => {
  it("names the floor properties the block is silent about", () => {
    expect(
      undeclaredFloor({
        gates: { [STYLE]: REQUIRED_AT_COMMIT },
        moment: COMMIT,
      })
    ).toEqual([LEAKAGE, FORMAT, STRUCTURAL]);
  });

  it("counts an explicit off as a decision, not as silence", () => {
    expect(
      undeclaredFloor({
        gates: {
          [STYLE]: REQUIRED_AT_COMMIT,
          [LEAKAGE]: { commit: "off" },
          [FORMAT]: REQUIRED_AT_COMMIT,
          // lint-staged runs `ast-grep scan` on every staged file, so the
          // structural-rules property is one of the things it proves.
          [STRUCTURAL]: REQUIRED_AT_COMMIT,
        },
        moment: COMMIT,
      })
    ).toEqual([]);
  });

  it("ignores a declaration made at some other moment", () => {
    expect(
      undeclaredFloor({
        gates: { [LEAKAGE]: { "pull-request": "required" } },
        moment: COMMIT,
      })
    ).toContain(LEAKAGE);
  });

  it("has no floor at a moment the built-in hooks never covered", () => {
    expect(undeclaredFloor({ gates: {}, moment: "pull-request" })).toEqual([]);
  });

  it("falls back rather than run a commit block missing gitleaks", () => {
    const child = runCli(
      JSON.stringify({ gates: { [STYLE]: REQUIRED_AT_COMMIT } }),
      COMMIT
    );

    expect(child.status).toBe(EXIT.NO_GATES);
    expect(child.stdout).toContain(LEAKAGE);
    expect(child.stdout).toContain("built-in checks");
  });
});

describe("the exit-code contract the hooks branch on", () => {
  it("keeps every outcome distinct so no failure can read as a pass", () => {
    expect(EXIT).toEqual({
      BLOCKED: 1,
      NO_GATES: 78,
      PROVED: 0,
      RUNNER_FAILED: 70,
    });
  });

  it("exits NO_GATES when there is no gates block, so hooks fall back", () => {
    expect(runCli(null, COMMIT).status).toBe(EXIT.NO_GATES);
  });

  it("exits RUNNER_FAILED — not zero — when the config cannot be read", () => {
    const child = runCli("{ not json", COMMIT);

    expect(child.status).toBe(EXIT.RUNNER_FAILED);
    expect(child.stderr).toContain("could not read configuration");
  });

  it("exits RUNNER_FAILED when no moment is given", () => {
    const child = runCli(null, "");

    expect(child.status).toBe(EXIT.RUNNER_FAILED);
    expect(child.stderr).toContain("usage:");
  });
});
