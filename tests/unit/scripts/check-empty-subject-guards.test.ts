/**
 * Unit tests for scripts/check-empty-subject-guards.mjs (#3888).
 *
 * The sweep runs every root-scoped guard against an empty git repository and
 * refuses any that prints a success line and exits 0 anyway — a guard whose
 * comparison had no subject, reporting OK.
 *
 * The discriminator is the pair (exit 0, success marker), and both halves earn
 * their place here: a guard that reports its subject was ABSENT is stating what
 * it examined, which is the criterion satisfied rather than violated, and a
 * guard that prints a tick for a sub-check on its way to a non-zero exit has
 * not claimed anything. Fixtures below cover all four combinations.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/check-empty-subject-guards
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimsSuccess,
  declaredRootForm,
  discoverGuards,
} from "../../../scripts/check-empty-subject-guards.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.resolve("scripts/check-empty-subject-guards.mjs");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A guard whose header declares `--root` and whose body is `body`. */
function guardSource(body: string): string {
  return ["/**", " * CLI:", " *   node guard.mjs [--root <dir>]", " */", body]
    .join("\n")
    .concat("\n");
}

/** Prints a tick and exits 0 however empty the tree is — the defect. */
const REPORTS_OK_ON_NOTHING = guardSource(
  'console.log("\\u2713 no findings in 0 files");'
);

/** Refuses an empty enumeration, in the manner the fixed guards do. */
const REFUSES_EMPTY = guardSource(
  [
    'console.log("a scan of nothing is not a pass");',
    "process.exitCode = 2;",
  ].join("\n")
);

/** Says its subject was absent instead of claiming a check passed. */
const STATES_SUBJECT_ABSENT = guardSource(
  'console.log("not-adopted: no contract here, so nothing was compared");'
);

/** Prints a tick for one sub-check and still fails overall. */
const TICKS_THEN_FAILS = guardSource(
  ['console.log("\\u2713 config parsed");', "process.exitCode = 1;"].join("\n")
);

/** A guard declaring no root override at all — outside the probed population. */
const NO_ROOT_OVERRIDE = [
  "/**",
  " * CLI:",
  " *   node guard.mjs",
  " */",
  'console.log("\\u2713 nothing to see");',
  "",
].join("\n");

/**
 * Build a fixture tree of guard scripts under `scripts/`.
 *
 * @param guards - File name to source text.
 * @returns The absolute root of the fixture tree.
 */
function fixtureTree(guards: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-3888-fixture-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const [name, source] of Object.entries(guards)) {
    writeFileSync(path.join(root, "scripts", name), source, "utf8");
  }
  return root;
}

/**
 * Run the sweep against a fixture tree.
 *
 * @param root - Discovery root to sweep.
 * @param args - Extra CLI arguments.
 * @returns The exit code and combined stdout.
 */
function run(
  root: string,
  args: readonly string[] = []
): { code: number; stdout: string } {
  try {
    const stdout = boundedExecFileSync({
      label: "check-empty-subject-guards.mjs",
      command: process.execPath,
      args: [SCRIPT, "--guards-root", root, ...args],
    });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { exitCode?: number; stdout?: string };
    return {
      code: typeof failure.exitCode === "number" ? failure.exitCode : -1,
      stdout: failure.stdout ?? "",
    };
  }
}

describe("claimsSuccess", () => {
  it("reads a tick as a claim that a check passed", () => {
    expect(
      claimsSuccess("✓ no leftover conflict markers in 0 tracked files")
    ).toBe(true);
  });

  it("reads a standalone OK as a claim", () => {
    expect(claimsSuccess("[verification-coverage] OK")).toBe(true);
  });

  it("does not read a subject-absent report as a claim", () => {
    // These are the two real shapes in this repository that exit 0 having
    // examined nothing and are NOT defects: each says so.
    expect(
      claimsSuccess(
        "not-adopted: no state contract at state/state-contract.json"
      )
    ).toBe(false);
    expect(
      claimsSuccess(
        "No .gitattributes merge driver is mapped here; nothing to register."
      )
    ).toBe(false);
  });

  it("does not read OK inside a longer word as a verdict", () => {
    expect(claimsSuccess("BOOKKEEPING: 4 entries")).toBe(false);
  });
});

describe("declaredRootForm", () => {
  it("finds a flag form and reports the flag to pass", () => {
    expect(declaredRootForm(REPORTS_OK_ON_NOTHING)).toEqual({
      flag: "--root",
      token: "--root",
    });
  });

  it("finds a positional form and reports no flag", () => {
    expect(
      declaredRootForm("/**\n * node guard.mjs [--json] [root]\n */")
    ).toEqual({ flag: null, token: "[root]" });
  });

  it("reports nothing for a guard declaring no root override", () => {
    expect(declaredRootForm(NO_ROOT_OVERRIDE)).toBeUndefined();
  });
});

describe("discoverGuards", () => {
  it("finds check-*.mjs in the repository lane, sorted", () => {
    const root = fixtureTree({
      "check-beta.mjs": REFUSES_EMPTY,
      "check-alpha.mjs": REFUSES_EMPTY,
      "helper.mjs": REFUSES_EMPTY,
    });

    expect(discoverGuards(root)).toEqual([
      path.join("scripts", "check-alpha.mjs"),
      path.join("scripts", "check-beta.mjs"),
    ]);
  });

  it("finds a delivered lane under a stack directory without being told its name", () => {
    // Derived rather than listed, so a new stack directory joins the
    // population on the day it appears instead of on the day someone
    // remembers to add it to a roster.
    const root = fixtureTree({ "check-alpha.mjs": REFUSES_EMPTY });
    const lane = path.join("newstack", "copy-overwrite", "scripts");
    mkdirSync(path.join(root, lane), { recursive: true });
    writeFileSync(path.join(root, lane, "check-delivered.mjs"), REFUSES_EMPTY);

    expect(discoverGuards(root)).toContain(
      path.join(lane, "check-delivered.mjs")
    );
  });
});

describe("the sweep", () => {
  it("reports a guard that prints a tick and exits 0 on an empty tree", () => {
    const root = fixtureTree({ "check-offender.mjs": REPORTS_OK_ON_NOTHING });

    const { code, stdout } = run(root);

    expect(code).toBe(1);
    expect(stdout).toContain("check-offender.mjs");
    expect(stdout).toContain("no findings in 0 files");
  });

  it("passes a guard that refuses an empty enumeration", () => {
    const root = fixtureTree({ "check-refuses.mjs": REFUSES_EMPTY });

    const { code, stdout } = run(root);

    expect(code).toBe(0);
    expect(stdout).toContain("probed 1 root-scoped guard(s)");
  });

  it("passes a guard that states its subject was absent", () => {
    // Exit 0 alone is not the finding. A guard with genuinely nothing to do is
    // meeting the criterion — it said what it examined — and treating it as a
    // defect would turn this sweep into a wall of findings nobody reads.
    const root = fixtureTree({ "check-absent.mjs": STATES_SUBJECT_ABSENT });

    expect(run(root).code).toBe(0);
  });

  it("passes a guard that prints a tick and still fails", () => {
    // A success marker alone is not the finding either: a guard may report the
    // sub-checks that passed on its way to refusing.
    const root = fixtureTree({ "check-partial.mjs": TICKS_THEN_FAILS });

    expect(run(root).code).toBe(0);
  });

  it("counts a guard declaring no root override instead of probing it", () => {
    // The declared blind spot, made visible. This guard WOULD be a finding if
    // it could be pointed at an empty tree, and the report says how many such
    // guards exist rather than letting them vanish.
    const root = fixtureTree({
      "check-refuses.mjs": REFUSES_EMPTY,
      "check-unprobeable.mjs": NO_ROOT_OVERRIDE,
    });

    const { code, stdout } = run(root);

    expect(code).toBe(0);
    expect(stdout).toContain("probed 1 root-scoped guard(s)");
    expect(stdout).toContain("1 guard(s) declare no root override");
  });

  it("exits 2 when it probed nothing at all", () => {
    // The sweep applied to itself: an empty inspection and a clean tree print
    // the same tick, so a run that probed zero guards is a failure rather than
    // an all-clear.
    const root = fixtureTree({});

    const { code, stdout } = run(root);

    expect(code).toBe(2);
    expect(stdout).toContain("ZERO guards probed");
  });

  it("exits 2 on an unknown flag rather than reporting a clean sweep", () => {
    const root = fixtureTree({ "check-refuses.mjs": REFUSES_EMPTY });

    expect(run(root, ["--nope"]).code).toBe(2);
  });

  it("emits machine-readable findings under --json", () => {
    const root = fixtureTree({ "check-offender.mjs": REPORTS_OK_ON_NOTHING });

    const { code, stdout } = run(root, ["--json"]);

    expect(code).toBe(1);
    const report = JSON.parse(stdout) as {
      probed: number;
      findings: { guard: string }[];
    };
    expect(report.probed).toBe(1);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.guard).toBe(
      path.join("scripts", "check-offender.mjs")
    );
  });
});

describe("this repository's own guards", () => {
  it("sweeps clean, having probed a non-zero population", () => {
    const { code, stdout } = run(path.resolve("."));

    expect(code).toBe(0);
    expect(stdout).not.toContain("probed 0 root-scoped");
    expect(stdout).toContain(
      "Every probed guard refused, or stated that its subject was absent."
    );
  });
});
