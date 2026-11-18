#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Regression proof for GHSA-fc5q-39xc-vjpf (picomatch ReDoS through repeated
 * extglobs with a `*` branch, such as `+(*)` and `+(*a)`).
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
export const ATTACK_PATTERNS = [
  "+(*)",
  "*(*)",
  "+(*a)",
  "*(*a)",
  "@(+(*))",
  "+(*a*)",
  "+(*a|b)",
  "*(a*|b)",
];

/** Short inputs that never match, which forces a full backtracking search. */
export const ATTACK_INPUTS = ["/", "!", "b"].map(end => "a".repeat(40) + end);

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
 * @returns {{ passed: boolean, elapsedMs: number }} Whether it finished in time
 */
export function checkPicomatch(dir, budget = BUDGET_MS) {
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      CHILD,
      resolve(dir),
      JSON.stringify(ATTACK_PATTERNS),
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
