/**
 * What a run leaves behind about a part the change did not touch
 * (CodySwannGT/lisa#4988).
 *
 * Three readers act on a run without seeing its transcript: the hook that
 * stands a built-in check down against the coverage file, whatever reads the
 * evidence envelope, and the pass cache. None of them may take "left out"
 * for "passed".
 * @module tests/unit/scripts/lisa-run-gates-parts-untouched-record
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  evidenceDocument,
  provenFloor,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { COMMIT, RUNNER, STYLE } from "./lisa-run-gates-fixtures.js";
import {
  API,
  API_ARGV,
  partGates,
  type PartsRepository,
  partsRepository,
  WEB,
  WEB_ARGV,
} from "../controls/support/lisa-run-gates-parts-fixtures.js";
import {
  lineFor,
  runWithChange,
  touching,
  type UntouchedRun,
} from "./lisa-run-gates-untouched-fixtures.js";

/** `code-style` is one of the checks the commit hook proves on its own. */
const STYLE_PARTS = partGates(
  [
    { scope: API, command: API_ARGV },
    { scope: WEB, command: WEB_ARGV },
  ],
  "required",
  STYLE
);
const OTHER = "x-other";
const API_MAIN = "api/main.py";
const OBSERVED_AT = "2026-11-17T00:00:00.000Z";

let repository: PartsRepository;
beforeEach(() => {
  repository = partsRepository();
});
afterEach(() => repository.cleanup());

/**
 * Run the `code-style` parts with a change touching the given paths.
 * @param paths - Repository-relative paths
 * @param gates - The gates block
 * @returns The run
 */
function styleRun(
  paths: readonly string[],
  gates: Record<string, unknown> = STYLE_PARTS
): UntouchedRun {
  return runWithChange({
    change: touching(paths),
    gates,
    root: repository.root,
  });
}

describe("which built-in checks a run with untouched parts stands down", () => {
  const floorAfter = (run: UntouchedRun): string[] =>
    provenFloor({ gates: STYLE_PARTS, moment: COMMIT, result: run.result });

  it("stands the check down when a part ran and the rest were untouched", () => {
    expect(floorAfter(styleRun([API_MAIN]))).toEqual([STYLE]);
  });

  it("keeps the check when the change touched none of the gate's parts", () => {
    // A change to a file outside every folder: no part looked at it, so the
    // caller's own check is the only thing left that can.
    expect(floorAfter(styleRun(["eslint.config.js"]))).toEqual([]);
  });

  it("keeps the check when one part failed and the other was untouched", () => {
    const run = runWithChange({
      change: touching([API_MAIN]),
      execArgv: () => ({ code: 1, output: null }),
      gates: STYLE_PARTS,
      root: repository.root,
    });

    expect(floorAfter(run)).toEqual([]);
  });
});

describe("the evidence row of a part the change did not touch", () => {
  /**
   * The evidence rows a run would record.
   * @param run - The run
   * @returns One row per part
   */
  function rowsOf(run: UntouchedRun): Array<Record<string, unknown>> {
    return evidenceDocument({
      gates: STYLE_PARTS,
      moment: COMMIT,
      observedAt: OBSERVED_AT,
      result: run.result,
      runner: RUNNER,
      verdict: "proved",
    }).gates as Array<Record<string, unknown>>;
  }

  it("is recorded as not applicable, and never as a pass", () => {
    const [api, web] = rowsOf(styleRun([API_MAIN]));

    expect(web).toEqual(
      expect.objectContaining({
        applicable: false,
        gate: STYLE,
        scope: WEB,
        status: "unknown",
      })
    );
    expect(api).toEqual(
      expect.objectContaining({ gate: STYLE, scope: API, status: "pass" })
    );
  });

  it("leaves the row of a part that ran as it was", () => {
    const [api] = rowsOf(styleRun([API_MAIN]));

    expect(Object.keys(api ?? {})).toEqual([
      "gate",
      "status",
      "level",
      "label",
      "scope",
    ]);
  });
});

describe("what an untouched part is never used for", () => {
  it("is never remembered by the pass cache", () => {
    const remember = vi.fn();
    const run = runWithChange({
      cache: { commit: () => {}, lookup: () => null, remember },
      change: touching([API_MAIN]),
      gates: STYLE_PARTS,
      root: repository.root,
    });

    expect(run.started).toEqual([API]);
    expect(remember).toHaveBeenCalledTimes(1);
    expect(remember.mock.calls[0]?.[0]).toMatchObject({ scope: API });
  });

  it("is never asked of the pass cache either", () => {
    const lookup = vi.fn((_gate: unknown) => null);
    runWithChange({
      cache: { commit: () => {}, lookup, remember: () => {} },
      change: touching([API_MAIN]),
      gates: STYLE_PARTS,
      root: repository.root,
    });

    expect(lookup.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ scope: API }),
    ]);
  });

  it("proves nothing for another gate that names the same command", () => {
    const gates = {
      ...STYLE_PARTS,
      ...partGates([{ scope: WEB, command: WEB_ARGV }], "required", OTHER),
    };

    const run = styleRun([API_MAIN], gates);

    expect(run.started).toEqual([API]);
    expect(lineFor(run, `${OTHER} in ${WEB}`)).toContain("NOT APPLICABLE");
    expect(run.transcript).not.toContain("proved by the");
    expect(run.result.results.map(entry => entry.provedBy)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("is named as not applicable when another part stops the run", () => {
    const run = runWithChange({
      change: touching([API_MAIN]),
      execArgv: () => ({ code: 1, output: null }),
      gates: STYLE_PARTS,
      root: repository.root,
    });

    expect(run.result.blocked).toBe(true);
    expect(run.transcript).toMatch(
      new RegExp(`NOT APPLICABLE here[^\\n]*${STYLE} in ${WEB}`)
    );
    expect(run.result.failed.map(entry => entry.scope)).toEqual([API]);
  });
});
