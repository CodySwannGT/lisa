/**
 * The push gate never measures a scope against another scope's floor.
 *
 * The hook picks `test:cov:unit` over `test:cov` when the project has it, so
 * the coverage step and the integration step stop collecting the integration
 * tree twice (CodySwannGT/lisa#2827). What that selection did NOT check is
 * whether anything had established a floor for the narrower scope: both scripts
 * resolved to the same `global` block, written for the full suite, so the
 * push gate ran a command whose thresholds describe a different population than
 * the one it measured.
 *
 * `LISA_COVERAGE_SCOPE=unit` is what makes the difference real — the threshold
 * factory reads it and enforces the unit block. So it is also the thing the
 * hook can check for. A `test:cov:unit` carrying the marker has a floor of its
 * own; one without it does not, and for that project the honest command is
 * still `test:cov`, whose floor IS the one configured for what it runs.
 *
 * These assertions read the shipped hook text rather than executing it. The
 * property is which script the selection resolves to under each manifest, and
 * the selection is a `node -e` one-liner — running the whole push gate to
 * observe one variable would take minutes and prove the same thing.
 * @module tests/unit/hooks/pre-push-coverage-scope
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { trackedHookCopies } from "../../helpers/hook-roster.js";

/** Every pre-push copy this repository tracks; they must all agree. */
const HOOKS = [...trackedHookCopies("pre-push")];

/** The full-suite script every fixture manifest carries. */
const FULL_SUITE = "vitest run --coverage";

/** The pinned unit script, marker and all. */
const MARKED_UNIT =
  "LISA_COVERAGE_SCOPE=unit vitest run --coverage --exclude='**/integration/**'";

/** A hand-rolled unit script with no scope marker, so no unit-scope floor. */
const UNMARKED_UNIT = "vitest run --coverage --exclude='**/integration/**'";

/** Script names repeated across the selection matrix. */
const FULL_COVERAGE_SCRIPT = "test:cov";
const UNIT_COVERAGE_SCRIPT = `${FULL_COVERAGE_SCRIPT}:unit`;

/**
 * The hook's coverage-selection block, lifted out and run on its own.
 *
 * Extracted by markers rather than line numbers: a block located by line
 * number silently starts testing something else the first time the hook grows.
 * @param source - The whole hook
 * @returns The shell between the markers
 */
function selectionBlock(source: string): string {
  const start = source.indexOf(`COVERAGE_SCRIPT="${FULL_COVERAGE_SCRIPT}"`);
  const end = source.indexOf("if lisa_gate_covers test-correctness", start);
  expect(start, "coverage selection block not found").toBeGreaterThan(-1);
  expect(end, "coverage selection block end not found").toBeGreaterThan(start);
  return source.slice(start, end);
}

/**
 * Which script the hook selects for a project with these package scripts.
 * @param source - The whole hook
 * @param scripts - The project's `scripts` block
 * @returns The selected npm script name
 */
function selected(source: string, scripts: Record<string, string>): string {
  // A real directory with a real package.json: the block asks `node` about
  // `./package.json`, and a fixture that intercepted that question would be
  // asserting against its own answer rather than the hook's.
  const root = mkdtempSync(path.join(tmpdir(), "lisa-cov-scope-"));
  try {
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts }, null, 2)
    );
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the block under test is POSIX shell; running it needs the system shell
    const result = spawnSync(
      "/bin/sh",
      ["-c", `${selectionBlock(source)}\nprintf '%s' "$COVERAGE_SCRIPT"`],
      { cwd: root, encoding: "utf8", timeout: 30_000 }
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

describe.each(HOOKS)("%s: coverage scope selection", hookPath => {
  const source = readFileSync(path.join(process.cwd(), hookPath), "utf8");

  it("selects test:cov:unit when it carries the unit-scope marker", () => {
    expect(
      selected(source, {
        [FULL_COVERAGE_SCRIPT]: FULL_SUITE,
        [UNIT_COVERAGE_SCRIPT]: MARKED_UNIT,
      })
    ).toBe(UNIT_COVERAGE_SCRIPT);
  });

  it("falls back to test:cov when the unit script has no scope marker", () => {
    // Not a punishment for hand-rolling the script — `test:cov` is measured
    // against the floor that was written for what it runs, so the fallback is
    // the honest answer rather than the degraded one.
    expect(
      selected(source, {
        [FULL_COVERAGE_SCRIPT]: FULL_SUITE,
        [UNIT_COVERAGE_SCRIPT]: UNMARKED_UNIT,
      })
    ).toBe(FULL_COVERAGE_SCRIPT);
  });

  it("falls back to test:cov when the project has no unit script at all", () => {
    expect(selected(source, { [FULL_COVERAGE_SCRIPT]: FULL_SUITE })).toBe(
      FULL_COVERAGE_SCRIPT
    );
  });

  it("accepts the marker wherever the script sets it", () => {
    // `env LISA_COVERAGE_SCOPE=unit ...` and a bare assignment prefix both
    // export it to the runner, so neither spelling may be refused.
    expect(
      selected(source, {
        "test:cov": FULL_SUITE,
        "test:cov:unit":
          "env LISA_COVERAGE_SCOPE=unit vitest run --coverage --exclude='**/integration/**'",
      })
    ).toBe("test:cov:unit");
  });

  it.each([
    "LISA_COVERAGE_SCOPE=unitary vitest run --coverage",
    "echo LISA_COVERAGE_SCOPE=unit && vitest run --coverage",
    'printf "LISA_COVERAGE_SCOPE=unit" && vitest run --coverage',
  ])("rejects a non-assignment marker lookalike: %s", unitScript => {
    expect(
      selected(source, {
        "test:cov": FULL_SUITE,
        "test:cov:unit": unitScript,
      })
    ).toBe("test:cov");
  });

  it("accepts the complete marker after other environment assignments", () => {
    expect(
      selected(source, {
        "test:cov": FULL_SUITE,
        "test:cov:unit":
          "NODE_ENV=test LISA_COVERAGE_SCOPE=unit vitest run --coverage",
      })
    ).toBe("test:cov:unit");
  });
});
