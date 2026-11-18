/**
 * GHSA-fc5q-39xc-vjpf: picomatch <= 4.0.7 backtracks exponentially on repeated
 * extglobs with a `*` branch (`+(*)`, `+(*a)`). Lisa patches every installed
 * copy through `.lisa/patches/`. These tests prove, against the real installed
 * copies and against the upstream source the patch is reversed back to:
 * 1. the regression script fails on upstream and passes on the patched copy,
 *    and each nested bypass (`+(@(*))`, `+(!(*))`, ...) does on its own;
 * 2. the patched matcher gives upstream's answer for every pattern it rewrites;
 * 3. each patch header's hash is the patched file, and hosts get the same bytes.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readAdvisoryPatches } from "../../../src/core/audit-patches.js";
import { resolveGit } from "../../support/git-executable.js";
import {
  boundedExecFileSync,
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";

/** The regression script's exports these tests use. */
interface RegressionScript {
  readonly ATTACK_PATTERNS: readonly string[];
  checkPicomatch(
    dir: string,
    budget: number,
    patterns: readonly string[]
  ): { readonly passed: boolean };
}

/** The matcher surface these tests use. */
interface Picomatch {
  makeRe(pattern: string, options?: Record<string, unknown>): RegExp;
}

const ROOT = process.cwd();
const SCRIPT = ".lisa/patches/picomatch-ghsa-fc5q-39xc-vjpf.regression.mjs";
const TEMPLATE = "typescript/copy-overwrite";
const PATCHES = readAdvisoryPatches(ROOT).filter(
  patch => patch.name === "picomatch"
);
const scratch = mkdtempSync(join(tmpdir(), "lisa-picomatch-redos-"));

/**
 * The installed (patched) copy of one picomatch version.
 * @param version - Exact version
 * @returns Package directory
 */
const installed = (version: string) =>
  join(ROOT, `node_modules/.bun/picomatch@${version}/node_modules/picomatch`);

/**
 * Rebuild the upstream package by reversing the patch on a copy.
 * @param version - Exact version
 * @param file - The patch file
 * @returns Directory of the unpatched package
 */
function upstream(version: string, file: string): string {
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
const regression = (...dirs: string[]) =>
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

const BODIES = [
  "*",
  "**",
  "*a",
  "a*",
  "*a*",
  "a*b",
  "*.a",
  "?*",
  "*?",
  "*[a]",
  "[a]*",
  "*[^a]",
  "*.[ab]",
  "*a|b",
  "a*|b",
  "*a|*b",
  "a*|b*",
  "*|a",
  "*a|b|ab",
  "*a*|b",
  "**|a",
  "*.a|*.b",
  // No flat equivalent: these two become literals.
  "a*|*b",
  "a*b|a",
];
const OPTIONS = [{}, { dot: true }, { capture: true }, { nocase: true }];

/**
 * Shapes the first patch missed: a `*` or negation hidden in a nested group,
 * a repeat hidden in `@(...)`, and branches that split the same text two ways.
 */
const BYPASSES = [
  "+(@(*))",
  "*(@(*))",
  "+(@(*a))",
  "+(@(*)|b)",
  "+(!(*))",
  "+(@(+([ab])))",
  "+([ab]|b)",
  "*(@([ab])|b)",
  "+(a|b|ab)",
  "+(*(ab)c|abc)",
  "+(a*([ab]))",
  "*(ab*(ab))",
];

/** Nested-group bodies, checked against upstream like BODIES. */
const NESTED = [
  "@(*)",
  "@(*a)",
  "@(*)|b",
  "@(a*)|b",
  "!(a)",
  "!(a)|b",
  "!(*)",
  "!(*a)",
  "?(*a)",
  "@(@(*))",
  "*(a)a",
  "*(a)b",
  "@(*(a))",
  "a*(b)",
  "@(*(a)a)",
  "!(f)",
  "+(*)|a",
  "@(a|*)",
];

/** Star-free alternations: ambiguous ones become literals, the rest stay. */
const ALTERNATIONS = [
  "a|b",
  "a|ab",
  "js|ts|jsx",
  "foo|far",
  "[ab]|b",
  "a|b|ab",
  "@(a|b)|c",
  "@([ab])|b",
  "b|B",
  "?|a",
  "[a-c]|d",
  "[!a]|b",
  "a|a",
  "ab|ba",
  "*(ab)c|abc",
  "*(a)b|c",
  "*(ab?)[ab]|b",
];

/**
 * Every wrapped form of each body, repeated by `+` and `*`.
 * @param bodies - Extglob bodies
 * @returns Patterns
 */
const formsOf = (bodies: readonly string[]) =>
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
function compare(
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
const tally = (results: readonly string[]) => ({
  same: results.filter(result => result === "same").length,
  literal: results.filter(result => result === "literal").length,
  unchanged: results.filter(result => result === "unchanged").length,
  mismatches: results.filter(result => result.startsWith("mismatch")),
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("picomatch GHSA-fc5q-39xc-vjpf patch", () => {
  it("patches every picomatch version Lisa installs", () => {
    expect(
      PATCHES.map(patch => patch.version).sort((a, b) => a.localeCompare(b))
    ).toEqual(["2.3.2", "4.0.7"]);
    expect(PATCHES.every(patch => patch.regressionTest === SCRIPT)).toBe(true);
  });

  for (const patch of PATCHES) {
    describe(`picomatch@${patch.version}`, () => {
      const pristine = upstream(patch.version, patch.file);

      it(
        "fails the regression script unpatched and passes it patched",
        () => {
          expect(regression(pristine)).toBe(1);
          expect(regression(installed(patch.version))).toBe(0);
        },
        ioLatencyBudgetMs(30_000)
      );

      it(
        "fails each nested bypass unpatched and passes it patched",
        async () => {
          const script = (await import(join(ROOT, SCRIPT))) as RegressionScript;
          expect(script.ATTACK_PATTERNS).toEqual(
            expect.arrayContaining(BYPASSES)
          );
          for (const pattern of BYPASSES) {
            const check = (dir: string) =>
              script.checkPicomatch(dir, 2000, [pattern]).passed;
            expect({ pattern, upstream: check(pristine) }).toEqual({
              pattern,
              upstream: false,
            });
            expect({
              pattern,
              patched: check(installed(patch.version)),
            }).toEqual({ pattern, patched: true });
          }
        },
        ioLatencyBudgetMs(60_000)
      );

      it(
        "matches what upstream matches for every rewritten pattern",
        () => {
          const load = (dir: string) =>
            createRequire(join(dir, "index.js"))(dir) as Picomatch;
          const before = load(pristine);
          const after = load(installed(patch.version));
          const flat = tally(compare(before, after, formsOf(BODIES)));
          const per = OPTIONS.length * 2 * 6;
          // Every form is rewritten except the two new literals, `*|a` and
          // `**|a` (literal upstream already) and `?*` (upstream does not parse
          // `+(?` as an extglob). Only the mixed-star shapes, which have no
          // equivalent flat form, become literals, as other risky repeated
          // extglobs already do.
          expect(flat).toEqual({
            same: per * (BODIES.length - 5),
            literal: per * 2,
            unchanged: per * 3,
            mismatches: [],
          });
          // A star or negation in a nested group is rewritten the same way;
          // a whole-branch `@(...)` counts as its own branches; a nested `*(c)`
          // run whose copies can overlap becomes a literal.
          expect(tally(compare(before, after, formsOf(NESTED)))).toEqual({
            same: 496,
            literal: 144,
            unchanged: 224,
            mismatches: [],
          });
          // An alternation that splits the same text two ways (`[ab]|b`,
          // `a|b|ab`, `b|B` under nocase) becomes a literal, as `a|aa`
          // already does upstream; an unambiguous one is left alone.
          expect(tally(compare(before, after, formsOf(ALTERNATIONS)))).toEqual({
            same: 0,
            literal: 300,
            unchanged: 516,
            mismatches: [],
          });
        },
        ioLatencyBudgetMs(90_000)
      );

      it("declares the hash of the file the patch produces", () => {
        const [file] = patch.files;
        const bytes = readFileSync(
          join(installed(patch.version), file?.path ?? "")
        );
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          file?.sha256
        );
      });
    });
  }

  it("ships hosts the same patch bytes Lisa itself installs", () => {
    for (const file of [SCRIPT, ...PATCHES.map(patch => patch.file)]) {
      expect(readFileSync(join(ROOT, TEMPLATE, file), "utf8")).toBe(
        readFileSync(join(ROOT, file), "utf8")
      );
    }
    const template = JSON.parse(
      readFileSync(
        join(ROOT, "typescript/package-lisa/package.lisa.json"),
        "utf8"
      )
    ) as { force: { patchedDependencies: Record<string, string> } };
    const own = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8")
    ) as {
      patchedDependencies: Record<string, string>;
    };
    expect(template.force.patchedDependencies).toEqual(own.patchedDependencies);
  });
});
