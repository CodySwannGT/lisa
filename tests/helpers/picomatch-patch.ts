/**
 * Shared fixtures for the picomatch GHSA-fc5q-39xc-vjpf patch tests: the
 * installed and upstream copies, the shipped regression script, and a
 * differential that compares the patched matcher with upstream.
 */
import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { readAdvisoryPatches } from "../../src/core/audit-patches.js";
import { resolveGit } from "../support/git-executable.js";
import { boundedExecFileSync, boundedSpawnSync } from "./io-latency-budget.js";

/** The regression script's exports these tests use. */
export interface RegressionScript {
  readonly ATTACK_PATTERNS: readonly string[];
  checkPicomatch(
    dir: string,
    budget: number,
    patterns: readonly string[]
  ): { readonly passed: boolean };
}

/** The matcher surface these tests use. */
export interface Picomatch {
  makeRe(pattern: string, options?: Record<string, unknown>): RegExp;
}

export const ROOT = process.cwd();
export const SCRIPT =
  ".lisa/patches/picomatch-ghsa-fc5q-39xc-vjpf.regression.mjs";
export const TEMPLATE = "typescript/copy-overwrite";
export const PATCHES = readAdvisoryPatches(ROOT).filter(
  patch => patch.name === "picomatch"
);

/**
 * The installed (patched) copy of one picomatch version.
 * @param version - Exact version
 * @returns Package directory
 */
export const installed = (version: string) =>
  join(ROOT, `node_modules/.bun/picomatch@${version}/node_modules/picomatch`);

/**
 * Rebuild the upstream package by reversing the patch on a copy.
 * @param scratch - Directory to build it in
 * @param version - Exact version
 * @param file - The patch file
 * @returns Directory of the unpatched package
 */
export function upstream(
  scratch: string,
  version: string,
  file: string
): string {
  const dir = join(scratch, `picomatch@${version}`);
  cpSync(installed(version), dir, { recursive: true });
  boundedExecFileSync({
    label: "reverse the picomatch patch",
    command: resolveGit(),
    args: ["apply", "-R", join(ROOT, file)],
    cwd: dir,
  });
  return dir;
}

/**
 * Run the shipped regression script against picomatch copies.
 * @param dirs - Package directories
 * @returns The script's exit status
 */
export const regression = (...dirs: string[]) =>
  boundedSpawnSync({
    label: "run the picomatch regression script",
    command: process.execPath,
    args: [SCRIPT, "--budget=3000", ...dirs],
    cwd: ROOT,
    baseMs: 6000,
  }).status;

/**
 * Every string of length 0..5 over characters that exercise the rewrites.
 * @returns Input strings
 */
function inputs(): readonly string[] {
  const alphabet = ["a", "b", ".", "/", "x", "[", "]"];
  return Array.from({ length: 5 }).reduce<readonly string[]>(
    (all, _, index) => [
      ...all,
      ...all
        .filter(value => value.length === index)
        .flatMap(value => alphabet.map(char => value + char)),
    ],
    [""]
  );
}

/** Option sets the differential runs under. */
export const OPTIONS = [{}, { dot: true }, { capture: true }, { nocase: true }];

/**
 * Load a picomatch copy.
 * @param dir - Package directory
 * @returns The matcher
 */
export const load = (dir: string) =>
  createRequire(join(dir, "index.js"))(dir) as Picomatch;

/**
 * Every wrapped form of each body, repeated by `+` and `*`.
 * @param bodies - Extglob bodies
 * @returns Patterns
 */
export const formsOf = (bodies: readonly string[]) =>
  bodies.flatMap(body =>
    ["+", "*"].flatMap(type =>
      [
        ["", ""],
        ["x", ""],
        ["", "b"],
        ["a/", ""],
        ["", "/a"],
        [".", ""],
      ].map(([before, after]) => `${before}${type}(${body})${after}`)
    )
  );

/**
 * Compare the patched matcher with upstream on every form and option set.
 * @param before - Upstream picomatch
 * @param after - Patched picomatch
 * @param forms - Patterns to compare
 * @returns "unchanged", "literal", "same" or a mismatch, per form and option set
 */
export function compare(
  before: Picomatch,
  after: Picomatch,
  forms: readonly string[]
): readonly string[] {
  const strings = inputs();
  return OPTIONS.flatMap(options =>
    forms.map(form => {
      const old = before.makeRe(form, options);
      const now = after.makeRe(form, options);
      if (old.source === now.source) return "unchanged";
      if (/\\[+*]\\\(/u.test(now.source)) return "literal";
      return strings.every(value => old.test(value) === now.test(value))
        ? "same"
        : `mismatch: ${form} ${JSON.stringify(options)}`;
    })
  );
}

/**
 * Count each outcome kind.
 * @param results - Outcomes from compare
 * @returns Count per kind, with every mismatch listed
 */
export const tally = (results: readonly string[]) => ({
  same: results.filter(result => result === "same").length,
  literal: results.filter(result => result === "literal").length,
  unchanged: results.filter(result => result === "unchanged").length,
  mismatches: results.filter(result => result.startsWith("mismatch")),
});
