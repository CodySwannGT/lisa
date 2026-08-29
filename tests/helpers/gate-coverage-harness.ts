/**
 * Shared harness for the gate-coverage handover tests.
 *
 * Two test files assert the two halves of one contract — that the runner writes
 * the right ids, and that the hooks read them exactly — and both need the same
 * apparatus: a throwaway project to run the real runner in, and the hooks' own
 * `lisa_gate_covers` sliced out of the shipped shell and made callable.
 *
 * It lives in one module rather than being copied into each file for the reason
 * the runner's own comments give about the pre-push hook: two copies of one
 * check cannot be kept aligned by intention, and drift between them is exactly
 * how a handover test came to report a contract intact that a third tracked
 * hook copy did not implement at all (CodySwannGT/lisa#2847).
 * @module tests/helpers/gate-coverage-harness
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "vitest";

import { boundedSpawnSync } from "./io-latency-budget.js";
import { trackedHookCopies } from "./hook-roster.js";

export const ROOT = process.cwd();
export const RUNNER = path.join(
  ROOT,
  "all/copy-overwrite/scripts/lisa-run-gates.mjs"
);

/**
 * Every hook that hands its steps over, and the moment each runs at.
 *
 * The roster is derived from what git tracks, not typed. Four entries were
 * written here while a third tracked copy of the pre-push hook contained no
 * handover at all, and this file reported the handover contract intact
 * (CodySwannGT/lisa#2847). The moment comes from the hook's own name, so a copy
 * added anywhere in the tree arrives with its moment already known.
 */
export const HOOKS = [
  ...trackedHookCopies("pre-commit").map(file => ({
    file,
    moment: "commit" as const,
  })),
  ...trackedHookCopies("pre-push").map(file => ({
    file,
    moment: "push" as const,
  })),
];

/**
 * One root holding every throwaway directory this module stages.
 *
 * A single tree rather than a registry of paths to remember: `mkdtempSync`
 * already guarantees each child a unique name, so nothing has to be recorded to
 * be cleaned up, and the teardown is one recursive remove that cannot fall out
 * of step with what was actually created.
 */
const STAGING_ROOT = mkdtempSync(path.join(tmpdir(), "lisa-gate-coverage-"));

/**
 * A fresh throwaway directory inside the staging root.
 * @param prefix - Name prefix, so a leftover tree says what made it
 * @returns Absolute path to the new directory
 */
function stageDir(prefix: string): string {
  mkdirSync(STAGING_ROOT, { recursive: true });
  return mkdtempSync(path.join(STAGING_ROOT, prefix));
}

/** Remove every throwaway directory staged during a file's run. */
export function cleanupStagedDirs(): void {
  rmSync(STAGING_ROOT, { recursive: true, force: true });
}

/**
 * Run the real runner in a throwaway project.
 * @param gates - The `gates` block, or null to write no config at all
 * @param moment - The moment to ask for
 * @param withCoverage - Whether to pass `--coverage`
 * @param scripts - Package scripts to stage, for a gate that must really run
 * @returns The exit status and the coverage file's lines
 */
export function runRunner(
  gates: object | null,
  moment: string,
  withCoverage = true,
  scripts?: Record<string, string>
): { status: number; covered: string[]; stdout: string } {
  const { root, file } = stageProject(gates, scripts);
  const args = [
    RUNNER,
    `--moment=${moment}`,
    ...(withCoverage ? [`--coverage=${file}`] : []),
  ];
  const child = boundedSpawnSync({
    label: "lisa-run-gates.mjs",
    command: process.execPath,
    args,
    cwd: root,
  });
  return {
    status: child.status ?? -1,
    covered: readCovered(file),
    stdout: child.stdout ?? "",
  };
}

/**
 * A throwaway project holding just a `gates` block.
 * @param gates - The block, or null to write no config at all
 * @param scripts - Package scripts to stage, for a gate that must really run
 * @returns The project root and the path to hand `--coverage`
 */
export function stageProject(
  gates: object | null,
  scripts?: Record<string, string>
): { root: string; file: string } {
  const root = stageDir("project-");
  const file = path.join(root, "coverage.txt");
  if (gates) {
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({ gates })
    );
  }
  if (scripts) {
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "coverage-fixture", version: "0.0.0", scripts })
    );
  }
  return { root, file };
}

/**
 * The ids a coverage file names.
 * @param file - Path the runner was given
 * @returns One id per line, or none when the file was never written
 */
export function readCovered(file: string): string[] {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The hook's own `lisa_gate_covers`, sliced out and made callable.
 * @param file - Repo-relative path to the hook
 * @param coverage - Lines to put in the coverage file, or null for no file
 * @param names - Gate ids to ask about
 * @returns Whether the hook would stand the step down
 */
export function covers(
  file: string,
  coverage: string[] | null,
  ...names: string[]
): boolean {
  const script = [
    stageCoverage(coverage),
    coverageReader(file),
    `lisa_gate_covers ${names.join(" ")}`,
  ].join("\n");
  return (
    boundedSpawnSync({
      label: "lisa_gate_covers",
      command: "/bin/sh",
      args: ["-c", script],
    }).status === 0
  );
}

/**
 * The hook's `lisa_gate_covers` definition, verbatim.
 * @param file - Repo-relative path to the hook
 * @returns The shell function's source
 */
function coverageReader(file: string): string {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  const start = source.indexOf("lisa_gate_covers() {");
  const end = source.indexOf("\n}\n", start);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, end + 3);
}

/**
 * A coverage file, and the assignment that points the reader at it.
 * @param coverage - Lines to write, or null to leave the variable empty
 * @returns The shell assignment
 */
function stageCoverage(coverage: string[] | null): string {
  if (!coverage) return 'LISA_GATE_COVERAGE=""';
  const target = path.join(stageDir("covers-"), "coverage.txt");
  writeFileSync(target, coverage.length ? `${coverage.join("\n")}\n` : "");
  return `LISA_GATE_COVERAGE="${target}"`;
}
