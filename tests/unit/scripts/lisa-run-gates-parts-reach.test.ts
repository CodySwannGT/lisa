/**
 * Which built-in checks a run with parts may stand down, path by path.
 *
 * A stack hook stands its own secret scan or lint down against every gate the
 * runner names for it, and it stands down for the whole commit. So a gate
 * with parts is named only when the parts that ran reached every path the
 * change touches. One changed path outside them is a path nothing checked.
 * @module tests/unit/scripts/lisa-run-gates-parts-reach
 */
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  provenFloor,
  unreachedFloor,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { COMMIT, STYLE } from "./lisa-run-gates-fixtures.js";
import {
  API,
  API_ARGV,
  type DeclaredPart,
  partGates,
  type PartsRepository,
  partsRepository,
  WEB,
  WEB_ARGV,
} from "./lisa-run-gates-parts-fixtures.js";
import {
  NOT_KNOWN,
  runWithChange,
  type StatedChange,
  touching,
  type UntouchedRun,
} from "./lisa-run-gates-untouched-fixtures.js";

const WHOLE = ".";
const API_FILE = "api/a.go";
const OUTSIDE_FILE = "tools/b.js";
const NESTED_REPOSITORY = "vendor/engine";
const INSIDE_NESTED = "vendor/engine/src";
const REAL_API = "services/api";
const STILL_RUNS = "so the built-in check for it still runs.";

const FOLDER_PARTS: readonly DeclaredPart[] = [
  { scope: API, command: API_ARGV },
  { scope: WEB, command: WEB_ARGV },
];

/** One floor gate and why its built-in check is kept. */
interface Unreached {
  readonly id: string;
  readonly reason: string;
}

let repository: PartsRepository;
beforeEach(() => {
  repository = partsRepository([API, WEB, INSIDE_NESTED, REAL_API]);
});
afterEach(() => repository.cleanup());

/**
 * Run `code-style` declared with the given parts, for a stated change.
 * @param parts - The gate's parts
 * @param change - What the change touches
 * @returns The gates block and the run
 */
function styleRun(
  parts: readonly DeclaredPart[],
  change: StatedChange
): { gates: Record<string, unknown>; run: UntouchedRun } {
  const gates = partGates(parts, "required", STYLE);
  return {
    gates,
    run: runWithChange({ change, gates, root: repository.root }),
  };
}

/**
 * The gates a stack hook may stand its own check down against.
 * @param parts - The gate's parts
 * @param change - What the change touches
 * @returns Gate ids
 */
function standsDown(
  parts: readonly DeclaredPart[],
  change: StatedChange
): string[] {
  const { gates, run } = styleRun(parts, change);
  return provenFloor({ gates, moment: COMMIT, result: run.result });
}

/**
 * The gates whose built-in check is kept, and why.
 * @param parts - The gate's parts
 * @param change - What the change touches
 * @returns One entry per gate kept
 */
function kept(
  parts: readonly DeclaredPart[],
  change: StatedChange
): Unreached[] {
  const { gates, run } = styleRun(parts, change);
  return unreachedFloor({ gates, moment: COMMIT, result: run.result });
}

describe("a change that reaches outside the parts that ran", () => {
  it("keeps the built-in check when one changed path is in no part", () => {
    const { gates, run } = styleRun(
      FOLDER_PARTS,
      touching([API_FILE, OUTSIDE_FILE])
    );

    // The part for `api` ran and passed, and that is not the whole change.
    expect(run.started).toEqual([API]);
    expect(run.result.blocked).toBe(false);
    expect(provenFloor({ gates, moment: COMMIT, result: run.result })).toEqual(
      []
    );
  });

  it("names the paths no part covered", () => {
    expect(kept(FOLDER_PARTS, touching([API_FILE, OUTSIDE_FILE]))).toEqual([
      {
        id: STYLE,
        reason: `${STYLE} has no part for 1 path(s) this change touches ("${OUTSIDE_FILE}"), ${STILL_RUNS}`,
      },
    ]);
  });

  it("names the first few paths and counts the rest", () => {
    const outside = ["a.md", "b.md", "c.md", "d.md", "e.md"];

    const [entry] = kept(FOLDER_PARTS, touching([API_FILE, ...outside]));

    expect(entry?.reason).toBe(
      `${STYLE} has no part for 5 path(s) this change touches ("a.md", "b.md", "c.md" and 2 more), ${STILL_RUNS}`
    );
  });

  it("stands the check down when every changed path is inside a part that ran", () => {
    expect(
      standsDown(FOLDER_PARTS, touching([API_FILE, "web/index.ts"]))
    ).toEqual([STYLE]);
    expect(kept(FOLDER_PARTS, touching([API_FILE]))).toEqual([]);
  });

  it("stands the check down when a part for the whole repository ran", () => {
    const parts = [...FOLDER_PARTS, { scope: WHOLE, command: WEB_ARGV }];

    expect(standsDown(parts, touching([API_FILE, OUTSIDE_FILE]))).toEqual([
      STYLE,
    ]);
  });

  it("keeps the check, as before, when no part ran at all", () => {
    expect(kept(FOLDER_PARTS, touching([OUTSIDE_FILE]))).toEqual([
      {
        id: STYLE,
        reason: `No part of ${STYLE} applies to this change, ${STILL_RUNS}`,
      },
    ]);
  });

  it("does not take a nested repository for covered by a part for a folder inside it", () => {
    const parts = [{ scope: INSIDE_NESTED, command: API_ARGV }];

    const { gates, run } = styleRun(parts, touching([NESTED_REPOSITORY]));

    // Git names the nested repository as one path. The part inside it runs,
    // and what else moved in that repository is outside the part.
    expect(run.started).toEqual([INSIDE_NESTED]);
    expect(provenFloor({ gates, moment: COMMIT, result: run.result })).toEqual(
      []
    );
  });

  it("does not take a path in `API` for covered by a part for `api`", () => {
    const otherCase = "API/a.go";

    const { gates, run } = styleRun(FOLDER_PARTS, touching([otherCase]));

    // Read generously, the change may touch `api`, so that part runs. Read
    // strictly, `API` may be another folder, which no part looked at.
    expect(run.started).toEqual([API]);
    expect(provenFloor({ gates, moment: COMMIT, result: run.result })).toEqual(
      []
    );
    expect(
      unreachedFloor({ gates, moment: COMMIT, result: run.result })
    ).toEqual([
      {
        id: STYLE,
        reason: `${STYLE} has no part for 1 path(s) this change touches ("${otherCase}"), ${STILL_RUNS}`,
      },
    ]);
  });

  it("counts a changed path where a linked folder really is", () => {
    mkdirSync(path.join(repository.root, "links"));
    symlinkSync(
      path.join(repository.root, REAL_API),
      path.join(repository.root, "links", "api")
    );
    const parts = [{ scope: "links/api", command: API_ARGV }];

    expect(standsDown(parts, touching([`${REAL_API}/main.py`]))).toEqual([
      STYLE,
    ]);
  });
});

describe("a change that is not known", () => {
  it("keeps the built-in check when no part covers the whole repository", () => {
    const { gates, run } = styleRun(FOLDER_PARTS, NOT_KNOWN);

    // Every part ran and passed. What else the change touches is not known,
    // so nothing says those two folders are all of it.
    expect(run.started).toEqual([API, WEB]);
    expect(provenFloor({ gates, moment: COMMIT, result: run.result })).toEqual(
      []
    );
    expect(
      unreachedFloor({ gates, moment: COMMIT, result: run.result })
    ).toEqual([
      {
        id: STYLE,
        reason: `What this change touches is not known and ${STYLE} has no part for the whole repository, ${STILL_RUNS}`,
      },
    ]);
  });

  it("stands the check down when a part for the whole repository ran", () => {
    expect(
      standsDown([{ scope: WHOLE, command: API_ARGV }], NOT_KNOWN)
    ).toEqual([STYLE]);
  });

  it("stands the check down for a link that leads to the whole repository", () => {
    symlinkSync(repository.root, path.join(repository.root, "everything"));

    expect(
      standsDown([{ scope: "everything", command: API_ARGV }], NOT_KNOWN)
    ).toEqual([STYLE]);
  });
});

describe("a result that says nothing about the change", () => {
  /**
   * A run's result as a caller that kept only the rows would hand it over.
   * @param run - A run
   * @returns The same result, without what the run knew about the change
   */
  function withoutChange(run: UntouchedRun): UntouchedRun["result"] {
    return Object.fromEntries(
      Object.entries(run.result).filter(([key]) => key !== "change")
    ) as UntouchedRun["result"];
  }

  it("keeps the built-in check for a gate with parts", () => {
    const { gates, run } = styleRun(FOLDER_PARTS, touching([API_FILE]));

    // With the change on the result, the part that ran reached all of it.
    expect(provenFloor({ gates, moment: COMMIT, result: run.result })).toEqual([
      STYLE,
    ]);
    expect(
      provenFloor({ gates, moment: COMMIT, result: withoutChange(run) })
    ).toEqual([]);
  });

  it("leaves a gate with no parts as it was", () => {
    const gates = { [STYLE]: { [COMMIT]: "required" } };
    const run = runWithChange({ gates, root: repository.root });
    const result = withoutChange(run);

    expect(run.result.passed.map(entry => entry.id)).toEqual([STYLE]);
    expect(provenFloor({ gates, moment: COMMIT, result })).toEqual([STYLE]);
    expect(unreachedFloor({ gates, moment: COMMIT, result })).toEqual([]);
  });
});
