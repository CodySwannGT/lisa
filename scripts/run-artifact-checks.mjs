#!/usr/bin/env node
/**
 * Run the generated-artifact sub-checks and end with the FAILING one's words.
 *
 * `check:artifacts` runs six sub-checks in sequence and keeps going after one
 * fails, which is correct — an operator wants every problem in one attempt, not
 * one per attempt. The cost was that the failing sub-check's own diagnostic was
 * then buried under the output of every sub-check that passed AFTER it, and the
 * last thing printed before the summary belonged to an unrelated check that had
 * nothing wrong with it.
 *
 * Measured on `origin/main` at 4.45.10 (CodySwannGT/lisa#3876). A commit whose
 * staged bytes `lint-staged` reformatted was refused, and this is what the
 * operator saw at the bottom of the transcript:
 *
 * ```
 * $ node scripts/check-generated-artifact-merge-coverage.mjs
 * generated-artifact merge coverage: 4 artifact(s) declared, 2 merge-driver …
 * check:artifacts FAILED, and these are the checks that failed: upstream-evidence-manifest
 * ```
 *
 * Forty lines above it, unread, the failing check had already said the whole
 * answer — the file whose bytes moved, the cause, and both commands:
 *
 * ```
 * Error: src/core/upstream-evidence-manifest.ts is stale.
 *   Its inputs moved after it was generated. …
 *   At commit time lint-staged reformats every staged file BEFORE this
 *   check runs, so a manifest generated first is stale by the time it is
 *   checked. Regenerate now, after the reformat.
 * ```
 *
 * The diagnosis was never the problem. Its POSITION was. The ticket's own note
 * records the consequence: identifying the failing sub-check by exit code
 * before reading anything had become "the reliable habit", which is a habit an
 * operator should not need.
 *
 * So the ordering is inverted here: every passing sub-check's output first, the
 * failing ones last, then the summary. Nothing is dropped and nothing is
 * printed twice — the same bytes, in the order that puts the answer where a
 * reader looks.
 *
 * ## Why the check names stay in `package.json`
 *
 * They are passed in as arguments rather than listed in this file, and that is
 * load-bearing rather than stylistic. `undeclaredChecks` in
 * `check-generated-artifact-merge-coverage.mjs` reads the `check:artifacts`
 * SCRIPT BODY with `/\bcheck:[a-z0-9-]+/gu` and fails when a name appears there
 * that no artifact declares. Moving the list in here would leave that regex
 * matching nothing at all: the guard would pass, having examined an empty set,
 * and a seventh sub-check could join `check:artifacts` unannounced. A guard
 * that reports success by looking at nothing is the exact defect this
 * repository keeps finding, so the list stays where its guard can see it.
 * @module scripts/run-artifact-checks
 */

import process from "node:process";

import { boundedSpawnSync, isChildTimeout } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * How long one sub-check may run before the result is a timeout, not a verdict.
 *
 * Far above the work rather than near it. The whole aggregate completes in
 * seconds on an idle box; this budget exists so that a sub-check killed on a
 * saturated host is reported as KILLED rather than as a check that failed — a
 * killed `spawnSync` child returns EMPTY streams, so without this the failure
 * arrives looking exactly like a content problem and never mentions time.
 */
export const CHECK_BUDGET_MS = 900_000;

/** Printed immediately before the failing sub-checks' own output. */
export const FAILURE_HEADER =
  "── below: what the check that FAILED actually said ──";

/** Said instead of an empty block when a failing sub-check printed nothing. */
export const NO_OUTPUT_NOTE =
  "  (this check produced no output at all — it did not merely fail its " +
  "content check. A killed child returns empty streams, so treat an empty " +
  "block as a possible kill rather than as a silent refusal.)";

/** Said when a sub-check exceeded its budget rather than reaching a verdict. */
export const TIMEOUT_NOTE =
  "  (this check exceeded its time budget and was killed. It reached no " +
  "verdict, so nothing above is evidence about the artifacts.)";

/**
 * Run one sub-check and capture everything it said.
 * @param {string} name - Package script name, e.g. `check:lisa-owned-hash-ledger`
 * @returns {{name: string, ok: boolean, timedOut: boolean, output: string}} What it did and said.
 */
export function runCheck(name) {
  try {
    // `--silent` because bun otherwise echoes `$ <command>` to STDERR while
    // the check writes its findings to STDOUT. Capturing both and printing
    // them in stream order puts every banner after the output it introduces,
    // which reads as though each check were labelled with its neighbour's
    // name. The label this file prints is accurate by construction instead.
    const result = boundedSpawnSync("bun", ["run", "--silent", name], {
      encoding: "utf8",
      timeout: CHECK_BUDGET_MS,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    return { name, ok: result.status === 0, timedOut: false, output };
  } catch (error) {
    if (isChildTimeout(error)) {
      return { name, ok: false, timedOut: true, output: "" };
    }
    throw error;
  }
}

/**
 * The transcript, in the order that puts the answer where a reader looks.
 *
 * Passing sub-checks first, failing ones last, summary at the very end. A
 * reader who scrolls to the bottom — which is every reader of a refused commit
 * — lands on the check that has something to say rather than on one that does
 * not.
 * @param {Array<{name: string, ok: boolean, timedOut: boolean, output: string}>} results - One record per sub-check, in the order they ran
 * @returns {{lines: string[], exitCode: number}} What to print, and what to exit with.
 */
export function renderReport(results) {
  const failures = results.filter(result => !result.ok);
  const passed = results.filter(result => result.ok);
  const passedLines = passed.flatMap(result => [
    `▸ ${result.name}`,
    ...trimmedLines(result.output),
  ]);

  if (failures.length === 0) {
    return {
      lines: [
        ...passedLines,
        `check:artifacts OK - all ${String(results.length)} generated-artifact checks passed.`,
      ],
      exitCode: 0,
    };
  }

  const failureLines = failures.flatMap(result => [
    "",
    `▸ ${result.name}`,
    ...describeFailure(result),
  ]);

  return {
    lines: [
      ...passedLines,
      "",
      FAILURE_HEADER,
      ...failureLines,
      "",
      `check:artifacts FAILED, and these are the checks that failed: ${failures
        .map(result => result.name.replace(/^check:/u, ""))
        .join(" ")}`,
    ],
    exitCode: 1,
  };
}

/**
 * What one failing sub-check contributes to the report.
 *
 * An empty capture is NEVER rendered as an empty block. Two different events
 * produce one — a check that printed nothing, and a child killed before it
 * could print — and a blank gap reads as neither.
 * @param {{timedOut: boolean, output: string}} result - One failing sub-check's record
 * @returns {string[]} Its output, or the note that explains the absence of any.
 */
function describeFailure(result) {
  if (result.timedOut) return [TIMEOUT_NOTE];
  const lines = trimmedLines(result.output);
  return lines.length === 0 ? [NO_OUTPUT_NOTE] : lines;
}

/**
 * One captured stream as lines, without the trailing blank a final newline adds.
 * @param {string} output - Captured combined output
 * @returns {string[]} Its lines, empty when it said nothing.
 */
function trimmedLines(output) {
  const trimmed = output.replace(/\n+$/u, "");
  return trimmed === "" ? [] : trimmed.split("\n");
}

/**
 * Run every named sub-check and report.
 * @param {string[]} names - Package script names to run, in order
 * @param {(name: string) => {name: string, ok: boolean, timedOut: boolean, output: string}} [run] - Injected runner, for tests
 * @returns {{lines: string[], exitCode: number}} What to print, and what to exit with.
 */
export function runArtifactChecks(names, run = runCheck) {
  return renderReport(names.map(name => run(name)));
}

if (invokedAsScript(import.meta.url)) {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    // Refused rather than reported OK. An aggregate handed nothing to run
    // would otherwise print "all 0 generated-artifact checks passed", which is
    // the shape of every control in this repository that reported success
    // having examined nothing.
    console.error(
      "run-artifact-checks.mjs: no checks were named, so nothing was run.\n" +
        "  This cannot pass by inspecting nothing. Pass the package script\n" +
        "  names to run, as `check:artifacts` in package.json does."
    );
    process.exit(1);
  }
  const { lines, exitCode } = runArtifactChecks(names);
  console.log(lines.join("\n"));
  process.exit(exitCode);
}
