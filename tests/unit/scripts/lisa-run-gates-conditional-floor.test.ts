/**
 * A built-in step the project actually wired cannot be deleted by silence.
 *
 * The unconditional floor already stops a half-written block handing over a
 * moment whose built-in path always proves something. It said nothing about the
 * steps that run only when a project wired them — slow lint, knip, the mutation
 * gate, the derived-artifact check. For a repository that HAS those scripts
 * they are proved on every commit or push, and a gates block silent about them
 * still exited 0, which the hook reads as "skip the built-in checks". The
 * property stopped being proved and nothing replaced it.
 *
 * The distinction is per project, not per step: a repository with no `lint:slow`
 * script loses nothing when the registry takes the moment, because the built-in
 * step prints "skipping". So the floor has to read what this project wired.
 * @module tests/unit/scripts/lisa-run-gates-conditional-floor
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT,
  undeclaredFloor,
  wiredConditionalFloor,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  FORMAT,
  LEAKAGE,
  PUSH,
  runCli,
  STRUCTURAL,
  STYLE,
} from "./lisa-run-gates-fixtures.js";

const ARTIFACTS = "artifact-freshness";
const SLOW_LINT = "code-style-slow";
const DEAD_CODE = "dead-code";
const MUTATION = "test-meaningfulness";
const ARTIFACT_SCRIPT = "scripts/check-derived-artifacts.mjs";
/** Contents for the derived-artifact checker; only its presence is read. */
const ARTIFACT_BODY = "// generator check\n";
const OFF_AT_COMMIT = { commit: "off" };

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A throwaway project root with the given files in it.
 * @param files - Contents keyed by path relative to the root
 * @returns The root directory
 */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-conditional-floor-"));
  roots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

/**
 * A `package.json` declaring the given scripts.
 * @param scripts - Script names mapped to commands
 * @returns The file contents
 */
const withScripts = (scripts: Record<string, string>): string =>
  JSON.stringify({ name: "host", scripts });

describe("wiredConditionalFloor reads what the project wired", () => {
  it("claims nothing for a project that wired none of it", () => {
    const cwd = project({ "package.json": withScripts({ test: "vitest" }) });
    expect(wiredConditionalFloor({ moment: PUSH, cwd })).toEqual([]);
    expect(wiredConditionalFloor({ moment: COMMIT, cwd })).toEqual([]);
  });

  it("claims each push step whose script the project declares", () => {
    const cwd = project({
      "package.json": withScripts({
        "lint:slow": "eslint",
        knip: "knip",
        "test:mutation": "stryker",
      }),
    });
    expect(wiredConditionalFloor({ moment: PUSH, cwd })).toEqual([
      SLOW_LINT,
      DEAD_CODE,
      MUTATION,
    ]);
  });

  it("claims the derived-artifact check from the file the hook tests for", () => {
    const cwd = project({ [ARTIFACT_SCRIPT]: ARTIFACT_BODY });
    expect(wiredConditionalFloor({ moment: COMMIT, cwd })).toEqual([ARTIFACTS]);
  });

  it("treats an unreadable package.json as everything wired", () => {
    // The answer under uncertainty has to keep the built-in steps running:
    // guessing "not wired" hands over a moment that may have been proving
    // something, which is the deletion this floor exists to prevent.
    const cwd = project({ "package.json": "{ not json" });
    expect(wiredConditionalFloor({ moment: PUSH, cwd })).toEqual([
      SLOW_LINT,
      DEAD_CODE,
      MUTATION,
    ]);
  });

  it("has nothing conditional at a moment the hooks never covered", () => {
    const cwd = project({ "package.json": withScripts({ "lint:slow": "x" }) });
    expect(wiredConditionalFloor({ moment: "pull-request", cwd })).toEqual([]);
  });
});

describe("undeclaredFloor counts the wired steps too", () => {
  it("reports a wired step the block never mentions", () => {
    expect(
      undeclaredFloor({
        gates: {
          [STYLE]: OFF_AT_COMMIT,
          [LEAKAGE]: OFF_AT_COMMIT,
          [FORMAT]: OFF_AT_COMMIT,
          [STRUCTURAL]: OFF_AT_COMMIT,
        },
        moment: COMMIT,
        wired: [ARTIFACTS],
      })
    ).toEqual([ARTIFACTS]);
  });

  it("still accepts an explicit decision about it", () => {
    expect(
      undeclaredFloor({
        gates: {
          [STYLE]: OFF_AT_COMMIT,
          [LEAKAGE]: OFF_AT_COMMIT,
          [FORMAT]: OFF_AT_COMMIT,
          [STRUCTURAL]: OFF_AT_COMMIT,
          [ARTIFACTS]: OFF_AT_COMMIT,
        },
        moment: COMMIT,
        wired: [ARTIFACTS],
      })
    ).toEqual([]);
  });
});

describe("the runner refuses the moment end to end", () => {
  const declared = JSON.stringify({
    gates: {
      [STYLE]: OFF_AT_COMMIT,
      [LEAKAGE]: OFF_AT_COMMIT,
      [FORMAT]: OFF_AT_COMMIT,
      [STRUCTURAL]: OFF_AT_COMMIT,
    },
  });

  it("falls back when a wired step is undeclared, naming it", () => {
    const child = runCli(declared, COMMIT, {
      [ARTIFACT_SCRIPT]: ARTIFACT_BODY,
    });
    expect(child.status).toBe(EXIT.NO_GATES);
    expect(child.stdout).toContain(ARTIFACTS);
    expect(child.stdout).toContain("built-in checks");
  });

  it("hands the moment over once every wired step is declared", () => {
    // The other half: a complete block still gets the moment. A floor that
    // could never be satisfied would make the registry unusable, and the way
    // out of that is deleting gates.
    const complete = JSON.stringify({
      gates: {
        [STYLE]: OFF_AT_COMMIT,
        [LEAKAGE]: OFF_AT_COMMIT,
        [FORMAT]: OFF_AT_COMMIT,
        [STRUCTURAL]: OFF_AT_COMMIT,
        [ARTIFACTS]: OFF_AT_COMMIT,
      },
    });
    const child = runCli(complete, COMMIT, {
      [ARTIFACT_SCRIPT]: ARTIFACT_BODY,
    });
    expect(child.status).toBe(EXIT.PROVED);
  });

  it("hands it over when the project never wired the step at all", () => {
    expect(runCli(declared, COMMIT).status).toBe(EXIT.PROVED);
  });
});
