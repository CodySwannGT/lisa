/**
 * Properties of the shipped mutation gate that are read off its SOURCE.
 *
 * Three of the guarantees CodySwannGT/lisa#2995 adds are about shape rather
 * than behaviour — an ordering, a restriction, and the absence of a whole class
 * of call — and each is a thing a later refactor could undo while every
 * behavioural case kept passing.
 *
 * ## Why these live in their own file, with no import of the gate
 *
 * `stryker.conf.json` mutates `lisa-mutation.mjs`, and `vitest.config.mutation`
 * derives the gate's own suite list from static imports. A suite that imports
 * the gate therefore runs INSIDE the Stryker sandbox, against the
 * **instrumented** copy — where `spawnSync(cmd, args, { timeout: X })` has
 * become `spawnSync(cmd, args, stryMutAct_(id) ? {} : { timeout: X })`. An AST
 * scan reading that copy sees a ConditionalExpression where the options object
 * should be, and reports every bounded call in the file as unbounded. Measured:
 * all four of them, on a dry run, before a single mutant was active.
 *
 * These cases read the file as TEXT and import nothing from it, so they are not
 * in the mutation run's include set and always read the committed source. They
 * still run on every pull request in the ordinary unit suite.
 * @module tests/unit/config/mutation-gate-source-shape
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { unboundedSpawns } from "../../helpers/unbounded-spawn-scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Repository-relative path of the shipped diff-only mutation gate. */
const GATE = "typescript/copy-overwrite/scripts/lisa-mutation.mjs";

/** The committed gate source, read once. */
const source = readFileSync(path.join(REPO_ROOT, GATE), "utf8");

describe("the shipped gate's own children", () => {
  it("starts none of them without a deadline", () => {
    // The scan that bounded 326 unbounded child starts looked at the TEST tree
    // only, so this file was out of its scope — and it had four: the Stryker
    // child on both paths, the `command -v` probe that decides between them,
    // and every git probe. In CI an unbounded child is bounded by the job
    // timeout; in a git hook it is bounded by nothing at all.
    expect(unboundedSpawns(GATE, source)).toEqual([]);
  });
});

describe("how the gate reclaims a sandbox", () => {
  it("only ever considers a run-scoped sandbox", () => {
    // A sweep that removed the ROOT, or anything unrecognised under it, would
    // take a concurrent run's sandbox with it — and the bite tests' named
    // sandboxes, which this gate did not create and has no standing to remove.
    expect(source).toContain("parseSandboxOwner(entry.name)");
    expect(source).toContain("if (owner === null) continue;");
  });

  it("sweeps before the run rather than after it", () => {
    // An after-the-fact cleanup cannot run in exactly the case that creates
    // the mess: `cleanTempDir` is Stryker's own teardown, and a SIGTERM, an OOM
    // reap or a Ctrl-C all skip it. The ordering is the whole design, and a
    // refactor that moved the call into a `finally` would restore the defect
    // while every behavioural case kept passing.
    //
    // It sits inside `runStryker` rather than at either call site, so the
    // `--all` path cannot be given a different answer from the diff path by
    // omission — which is how one of two callers quietly stops being swept.
    const sweep = source.indexOf("sweepSandboxes(cwd);");
    const spawn = source.indexOf("if (!captureAvailable()) return runStryker");

    expect(sweep).toBeGreaterThan(0);
    expect(spawn).toBeGreaterThan(0);
    expect(sweep).toBeLessThan(spawn);
    // And it is inside `runStryker`, not before one of its callers.
    expect(source.indexOf("const runStryker = (cwd, selected)")).toBeLessThan(
      sweep
    );
  });
});
