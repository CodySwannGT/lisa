/**
 * GHSA-fc5q-39xc-vjpf, syntax the guard does not model: a repeated extglob
 * branch holding a brace or range, a quote, a POSIX class, a regex escape, a
 * bare group or a bare `+` (a regex quantifier inside an extglob) can hang
 * picomatch just like a `*` branch, and so can a `+` that is not an extglob
 * right after a closed glob group, which quantifies the group. The guard
 * fails closed on whatever it cannot read. These tests prove, against the installed copies and the
 * upstream source the patch is reversed back to, that each such bypass hangs
 * upstream and not patched, that literalized patterns still match their own
 * text and the rest keep their meaning, and that every changed regex is
 * either a literal or upstream's answer.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import {
  PATCHES,
  ROOT,
  SCRIPT,
  compare,
  formsOf,
  installed,
  load,
  tally,
  upstream,
  type RegressionScript,
} from "../../helpers/picomatch-patch.js";

const scratch = mkdtempSync(join(tmpdir(), "lisa-picomatch-syntax-"));

/**
 * Branches whose syntax the guard does not model, which it must treat as
 * risky: braces and ranges, quotes, POSIX classes, regex escapes, bare groups
 * and a bare `+`, which inside an extglob is a regex quantifier.
 */
const SYNTAX_BYPASSES = [
  "+({a,a})",
  "+({a,b}|b)",
  "+(a|a{b,})",
  '+(a|"a")',
  "+(a|[[:alpha:]])",
  "+({a..b}|a)",
  "+([a-b]{,a})",
  "+(\\w|a)",
  "+(\\x61|a)",
  "+(a+)",
  "+(a+|b)",
  "+((a|a))",
  "+((a)|a)",
];

/**
 * A `+` that does not open an extglob, right after a closed glob group,
 * reaches the regex as a quantifier on that group; and 2.3.2 drops the text
 * after a bracket once an earlier extglob was made literal, which turns
 * `+([a]b|a)` into the ambiguous `+([a]|a)`.
 */
const DROPPED_TEXT = "+(a|aa)|+([a]b|a)";
const GROUP_BYPASSES = [
  "!(a)+(?(c))",
  "?(!(a)+(?(b)|c))",
  "!(a)+",
  "@(a|a)+",
  "{a,a}+",
  DROPPED_TEXT,
];
const BYPASSES = [...SYNTAX_BYPASSES, ...GROUP_BYPASSES];

/**
 * Bypasses one version's upstream compiles to a regex that does not
 * backtrack. 2.3.2 drops the `a` branch of `+(a|[[:alpha:]])` and expands the
 * range of `+({a..b}|a)`; 4.0.7 keeps the `b` of `+([a]b|a)`.
 */
const FAST_UPSTREAM: Readonly<Record<string, readonly string[]>> = {
  "2.3.2": ["+(a|[[:alpha:]])", "+({a..b}|a)"],
  "4.0.7": [DROPPED_TEXT],
};

/**
 * What a pattern the guard turns into a literal must still match: its own
 * text. Patterns it leaves alone keep their meaning.
 */
const LITERAL_MATCHES = SYNTAX_BYPASSES.filter(
  pattern => !pattern.includes("\\")
).map(pattern => [pattern, pattern] as const);
const KEPT_MATCHES = [
  ["+(a|b)", "abba"],
  ["{ab,c}+", "abcab"],
  ["@(js|ts)+", "jsts"],
  ["(a|b)+c", "abac"],
  ["!(a)+", "b+"],
  ["@(a|a)+", "a+"],
  ["{a,a}+", "a+"],
  [DROPPED_TEXT, "abab"],
  ["+([[:alpha:].])", "a.c"],
  ["a+([^[:alnum:]])b", "a.b"],
  ["*((foo))", "foo"],
  ["*(b/a)", "b/a"],
  ["+(a|b[)*", "abcx"],
  ["+(\\*|a)", "*a*"],
  ["+(é|e)", "éeé"],
] as const;

/** Syntax bodies, checked against upstream like BODIES. */
const SYNTAX = [
  "{a,b}",
  "{a,b}|c",
  "{a..c}",
  '"a"|b',
  '"a*"',
  "[[:alpha:]]|1",
  "[[:alpha:].]",
  "\\w|-",
  "\\*|a",
  "(a|b)",
  "(ab)|c",
  "a/b|c",
  "[ab]|c",
  "a+b",
  "[!a]|b",
];

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("picomatch GHSA-fc5q-39xc-vjpf patch on unmodelled syntax", () => {
  for (const patch of PATCHES) {
    describe(`picomatch@${patch.version}`, () => {
      const pristine = upstream(scratch, patch.version, patch.file);

      it(
        "fails each syntax and group bypass unpatched and passes it patched",
        async () => {
          const script = (await import(join(ROOT, SCRIPT))) as RegressionScript;
          expect(script.ATTACK_PATTERNS).toEqual(
            expect.arrayContaining(BYPASSES)
          );
          for (const pattern of BYPASSES) {
            const check = (dir: string) =>
              script.checkPicomatch(dir, 2000, [pattern]).passed;
            const hangs = !FAST_UPSTREAM[patch.version]?.includes(pattern);
            expect({ pattern, upstream: check(pristine) }).toEqual({
              pattern,
              upstream: !hangs,
            });
            expect({
              pattern,
              patched: check(installed(patch.version)),
            }).toEqual({ pattern, patched: true });
          }
        },
        ioLatencyBudgetMs(60_000)
      );

      it("still matches literal text and the patterns it leaves alone", () => {
        const after = load(installed(patch.version));
        for (const [pattern, text] of [...LITERAL_MATCHES, ...KEPT_MATCHES]) {
          expect({
            pattern,
            text,
            matches: after.makeRe(pattern).test(text),
          }).toEqual({ pattern, text, matches: true });
        }
      });

      it(
        "matches what upstream matches or becomes a literal",
        () => {
          const before = load(pristine);
          const after = load(installed(patch.version));
          // A branch with syntax the guard does not model (a brace, a quote,
          // a regex escape, a bare `+`) becomes a literal even when it would
          // not backtrack, and so does one it can only overstate (a POSIX
          // class or `[!a]` counts as any character). Bare groups, `/`,
          // escaped symbols and plain brackets keep upstream's regex.
          expect(tally(compare(before, after, formsOf(SYNTAX)))).toEqual({
            same: 0,
            literal: 432,
            unchanged: 288,
            mismatches: [],
          });
        },
        ioLatencyBudgetMs(60_000)
      );
    });
  }
});
