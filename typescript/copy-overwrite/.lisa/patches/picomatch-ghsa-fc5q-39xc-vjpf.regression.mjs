#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Regression proof for GHSA-fc5q-39xc-vjpf (picomatch ReDoS through repeated
 * extglobs with a `*` branch, such as `+(*)` and `+(*a)`, including a `*`
 * hidden inside a nested group, such as `+(@(*))` and `+(!(*))`), plus the
 * other nested-quantifier shapes the same guard covers: a repeat hidden in
 * `@(...)`, as in `+(@(+([ab])))`, and branches that split the same text into
 * copies in two ways, as in `+([ab]|b)`, `+(a|b|ab)` and `+(a*([ab]))`,
 * including branches whose syntax the guard does not model and so treats as
 * risky: braces and ranges (`+({a,a})`, `+({a..b}|a)`), quotes (`+(a|"a")`),
 * POSIX classes (`+(a|[[:alpha:]])`), regex escapes (`+(\w|a)`), bare groups
 * (`+((a|a))`) and a bare `+`, which is a regex quantifier inside an extglob
 * (`+(a+)`).
 *
 * Usage: node picomatch-ghsa-fc5q-39xc-vjpf.regression.mjs [--budget=<ms>] <picomatch-dir>...
 *
 * Exits 0 when every attack pattern finishes inside the time budget against
 * every given picomatch copy, and 1 otherwise. A catastrophic regex cannot be
 * interrupted in-process, so each copy is exercised in a child process that is
 * killed when the budget runs out.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The advisory's attack patterns plus the shapes the same fix covers. */
const NAMED_PATTERNS = [
  "+(*)",
  "*(*)",
  "+(*a)",
  "*(*a)",
  "@(+(*))",
  "+(*a*)",
  "+(*a|b)",
  "*(a*|b)",
  "+(@(*))",
  "*(@(*))",
  "+(@(*a))",
  "+(@(*)|b)",
  "+(!(*))",
  "*(!(a))",
  "+(*(a)a)",
  "+(@(+([ab])))",
  "+([ab]|b)",
  "*(@([ab])|b)",
  "+(a|b|ab)",
  "+(*(ab)c|abc)",
  "+(@(*(ab?)[ab])|b)",
  "+(a*([ab]))",
  "*(ab*(ab))",
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

/** Branch bodies with an unbounded quantifier that a repeat must not nest. */
const ATOMS = [
  "*",
  "*a",
  "a*",
  "**",
  "*(a)",
  "*(a)a",
  "+(a)",
  "+(a)a",
  "a|*",
  "?(a)*",
];

/** Every extglob operator, which may hide an atom up to two groups deep. */
const WRAPS = ["@", "!", "?", "+", "*"];

/**
 * The generated class: each atom bare, inside one group and inside two,
 * repeated by `+(...)` and `*(...)`, alone and beside a plain branch.
 * @returns {string[]} Every generated pattern
 */
function nestedFamily() {
  const bodies = ATOMS.flatMap(atom => [
    atom,
    ...WRAPS.flatMap(outer => [
      `${outer}(${atom})`,
      ...WRAPS.map(inner => `${inner}(${outer}(${atom}))`),
    ]),
  ]);
  return [...new Set(bodies)].flatMap(body =>
    ["+", "*"].flatMap(op => [`${op}(${body})`, `${op}(${body}|b)`])
  );
}

/**
 * Syntax that matches `a` (or an `a` prefix) other than a plain character:
 * braces, ranges, quotes, POSIX classes, regex escapes, bare groups and a bare
 * `+`, which inside an extglob reaches the regex as a quantifier.
 */
const SYNTAX = [
  "{a,a}",
  "{a,b}",
  "a{b,}",
  "{,a}",
  "{a..b}",
  '"a"',
  "[[:alpha:]]",
  "[[:alnum:]b]",
  "\\w",
  "\\x61",
  "(a|a)",
  "(a)",
  "a+",
  "[ab]",
];

/**
 * The syntax family: each syntax atom beside `a` or `b`, and inside each
 * extglob operator, repeated by `+(...)` and `*(...)`.
 * @returns {string[]} Every generated pattern
 */
function syntaxFamily() {
  const bodies = SYNTAX.flatMap(atom => [
    atom,
    `${atom}|a`,
    `a|${atom}`,
    `${atom}|b`,
    `@(${atom})|a`,
    ...WRAPS.flatMap(wrap => [`${wrap}(${atom})`, `${wrap}(${atom}|a)`]),
  ]);
  return [...new Set(bodies)].flatMap(body =>
    ["+", "*"].map(op => `${op}(${body})`)
  );
}

export const ATTACK_PATTERNS = [
  ...new Set([...NAMED_PATTERNS, ...nestedFamily(), ...syntaxFamily()]),
];

/** Short inputs that never match, which forces a full backtracking search. */
export const ATTACK_INPUTS = ["a", "b", "ab", "aba", "abc", "[ab]"].flatMap(
  run =>
    ["/", "!", "c"].map(end => run.repeat(Math.ceil(90 / run.length)) + end)
);

/** Unpatched picomatch needs minutes on these inputs; patched needs milliseconds. */
export const BUDGET_MS = 5000;

const CHILD = `
const picomatch = require(process.argv[1]);
const patterns = JSON.parse(process.argv[2]);
const inputs = JSON.parse(process.argv[3]);
for (const pattern of patterns) {
  const regex = picomatch.makeRe(pattern);
  for (const input of inputs) regex.test(input);
}
`;

/**
 * Run every attack against one picomatch copy inside the budget.
 * @param {string} dir - Directory of an installed picomatch package
 * @param {number} [budget] - Milliseconds before the copy counts as vulnerable
 * @param {readonly string[]} [patterns] - Attack patterns to run
 * @returns {{ passed: boolean, elapsedMs: number }} Whether it finished in time
 */
export function checkPicomatch(
  dir,
  budget = BUDGET_MS,
  patterns = ATTACK_PATTERNS
) {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      CHILD,
      resolve(dir),
      JSON.stringify(patterns),
      JSON.stringify(ATTACK_INPUTS),
    ],
    { timeout: budget, encoding: "utf8" }
  );
  const elapsedMs = Date.now() - started;
  if (result.status !== 0 && result.signal === null)
    throw new Error(`picomatch at ${dir} failed to load: ${result.stderr}`);
  return { passed: result.status === 0, elapsedMs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const budgetArg = args.find(arg => arg.startsWith("--budget="));
  const budget = budgetArg ? Number(budgetArg.slice(9)) : BUDGET_MS;
  const dirs = args.filter(arg => arg !== budgetArg);
  if (!dirs.length || !Number.isFinite(budget) || budget <= 0) {
    console.error("Usage: node <this file> [--budget=<ms>] <picomatch-dir>...");
    process.exit(2);
  }
  const failures = dirs.filter(dir => {
    const { passed, elapsedMs } = checkPicomatch(dir, budget);
    const outcome = passed
      ? `✅ ${dir}: ${elapsedMs}ms`
      : `❌ ${dir}: still running after ${budget}ms`;
    console.log(outcome);
    return !passed;
  });
  process.exitCode = failures.length ? 1 : 0;
}
