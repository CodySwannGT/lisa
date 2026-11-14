/**
 * Affected-test selection at push (CodySwannGT/lisa#4600): every full-suite
 * trigger, a stale or missing map, an unmapped file, map selection with
 * reasons, the rewritten Vitest command, and the three coverage modes.
 */
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  FULL_SUITE_TRIGGERS,
  PARTIAL_COVERAGE_SKIP_REASON,
  SELECTION_REPORT_ENV,
  affectedTestsSettings,
  changedFileCoverage,
  coverageDeclaredAtPush,
  RECORDED_TRIGGER_REASON,
  coverageLeftToCi,
  excludedBy,
  expandBraces,
  explainSelection,
  firedTrigger,
  globToRegExp,
  measuresCoverage,
  narrowable,
  openSelectionReports,
  partialArgv,
  recordedTriggers,
  selectAffectedTests,
  staleMapReason,
} from "../../../all/copy-overwrite/scripts/lib/affected-tests.mjs";

const MERGE_BASE = "b".repeat(40);
const MAP_BASE = "a".repeat(40);
const NOW = new Date("2026-11-13T12:00:00Z");
const SPAWN = "all/copy-overwrite/scripts/lib/bounded-spawn.mjs";
const COVERAGE = "coverage-adequacy";
const COVERAGE_FLAG = "--coverage";
const SETUP_FILE = "tests/setup.ts";
const COMMAND_A = "bun run test:a";

const MAP = {
  "tests/unit/scripts/bounded-spawn.test.ts": [SPAWN],
  "tests/unit/scripts/lisa-run-gates.test.ts": [
    "all/copy-overwrite/scripts/lisa-run-gates.mjs",
    SPAWN,
  ],
  "tests/unit/docs/readme.test.ts": ["README.md"],
  "tests/integration/push.test.ts": [SPAWN],
};

const UNIT_COMMAND = [
  "bun",
  "run",
  "lisa-test-run",
  "--",
  "--adapter",
  "vitest",
  "--",
  "vitest",
  "run",
  COVERAGE_FLAG,
  "--exclude=**/integration/**",
  "--exclude=**/*.integration.*",
];

/**
 * Select against the fixture map with every file present on disk.
 * @param changed - Changed files
 * @returns The selection
 */
function select(
  changed: ReadonlyArray<{
    path: string;
    status?: "added" | "modified" | "deleted";
    existedAtMapBase?: boolean;
  }>
) {
  return selectAffectedTests({
    changed: changed.map(entry => ({
      status: "modified",
      existedAtMapBase: true,
      ...entry,
    })),
    map: MAP,
    excluded: excludedBy(UNIT_COMMAND),
    exists: () => true,
  });
}

describe("full-suite triggers", () => {
  it.each([
    "package.json",
    "bun.lock",
    "vitest.config.local.ts",
    "vitest.thresholds.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "eslint.config.ts",
    "tests/helpers/test-utils.ts",
    "tests/support/git-executable.ts",
    "tests/fixtures/x.json",
    "tests/integration/support/host.ts",
    "src/configs/vitest/base.ts",
    "all/copy-overwrite/scripts/lib/affected-tests.mjs",
    "scripts/fetch-test-access-map.mjs",
    "scripts/lib/push-gate-defaults.mjs",
    // A TypeScript host's own layout (#4611).
    "vite.config.ts",
    "test/helpers/db.ts",
    "tests/unit/setup/env.ts",
    "src/__tests__/fixtures/user.json",
    "spec/support/factory.ts",
    "src/orders/__fixtures__/order.json",
  ])("%s runs the full suite and names the trigger", file => {
    const selection = select([{ path: file }]);
    expect(selection.kind).toBe("full");
    expect(selection.reason).toContain(file);
    expect(explainSelection(selection, "")).toEqual([
      expect.stringContaining(`Running the full suite: `),
    ]);
  });

  it("leaves ordinary source and docs alone", () => {
    expect(firedTrigger(["src/core/x.ts", "README.md"])).toBeNull();
  });

  it("is one exported list, each entry with a plain reason", () => {
    for (const trigger of FULL_SUITE_TRIGGERS) {
      expect(trigger.pattern).toBeInstanceOf(RegExp);
      expect(trigger.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("selectAffectedTests", () => {
  it("runs only the unit tests the map links to a one-module change", () => {
    const selection = select([{ path: SPAWN }]);
    expect(selection).toEqual({
      kind: "partial",
      tests: [
        {
          file: "tests/unit/scripts/bounded-spawn.test.ts",
          reason: `map: ${SPAWN}`,
        },
        {
          file: "tests/unit/scripts/lisa-run-gates.test.ts",
          reason: `map: ${SPAWN}`,
        },
      ],
      related: [SPAWN],
      unread: [],
    });
  });

  it("runs a changed test itself", () => {
    const selection = select([{ path: "tests/unit/new-thing.test.ts" }]);
    expect(selection.tests).toEqual([
      { file: "tests/unit/new-thing.test.ts", reason: "changed test" },
    ]);
  });

  it("runs the full suite for a new file no map entry lists", () => {
    const selection = select([
      {
        path: "src/core/brand-new.ts",
        status: "added",
        existedAtMapBase: false,
      },
    ]);
    expect(selection.kind).toBe("full");
    expect(selection.reason).toMatch(
      /^unmapped file: src\/core\/brand-new\.ts/
    );
  });

  it("lists an existing file no unit test read, and selects nothing for it", () => {
    const selection = select([{ path: "wiki/notes.md" }]);
    expect(selection).toMatchObject({
      kind: "partial",
      tests: [],
      unread: ["wiki/notes.md"],
    });
  });

  it("selects the readers of a deleted file but hands it to nobody", () => {
    const selection = select([{ path: "README.md", status: "deleted" }]);
    expect(selection.tests.map(test => test.file)).toEqual([
      "tests/unit/docs/readme.test.ts",
    ]);
    expect(selection.related).toEqual([]);
  });

  it("drops test files the command excludes or that no longer exist", () => {
    const selection = selectAffectedTests({
      changed: [
        {
          path: SPAWN,
          status: "modified",
          existedAtMapBase: true,
        },
      ],
      map: MAP,
      excluded: excludedBy(UNIT_COMMAND),
      exists: file => file !== "tests/unit/scripts/lisa-run-gates.test.ts",
    });
    expect(selection.tests.map(test => test.file)).toEqual([
      "tests/unit/scripts/bounded-spawn.test.ts",
    ]);
  });
});

describe("staleMapReason", () => {
  const meta = { baseSha: MAP_BASE, createdAt: "2026-11-12T12:00:00Z" };
  const ancestry = (a: string, b: string) => a === MAP_BASE && b === MERGE_BASE;
  const check = (overrides: object, maxAgeDays = 7) =>
    staleMapReason({
      meta: { ...meta, ...overrides },
      mergeBase: MERGE_BASE,
      isAncestor: ancestry,
      now: NOW,
      maxAgeDays,
    });

  it("accepts a fresh map recorded for an ancestor of the merge-base", () => {
    expect(check({})).toBeNull();
    expect(check({ baseSha: MERGE_BASE })).toBeNull();
  });

  it("refuses a map older than the limit", () => {
    expect(check({}, 0)).toMatch(/^stale map: it is 1\.0 days old/);
  });

  it("refuses a map recorded for an unrelated base", () => {
    expect(check({ baseSha: "c".repeat(40) })).toMatch(
      /^stale map: .*not this branch's base/
    );
  });

  it("refuses a map with no base or no creation time", () => {
    expect(check({ baseSha: undefined })).toMatch(/^stale map/);
    expect(check({ createdAt: "soon" })).toMatch(/^stale map/);
  });
});

describe("partialArgv", () => {
  const selection = {
    kind: "partial" as const,
    tests: [{ file: "tests/unit/a.test.ts", reason: "changed test" }],
    related: ["src/a.ts"],
    unread: [],
  };

  it("keeps the launcher, swaps in `related --run`, and drops coverage when off", () => {
    expect(
      partialArgv({ argv: UNIT_COMMAND, selection, coverage: "off" })
    ).toEqual([
      ...UNIT_COMMAND.slice(0, 8),
      "related",
      "--run",
      "--exclude=**/integration/**",
      "--exclude=**/*.integration.*",
      "--coverage.enabled=false",
      "src/a.ts",
      "tests/unit/a.test.ts",
    ]);
  });

  it("measures coverage into a known folder with the global floors lifted when on", () => {
    const argv = partialArgv({
      argv: UNIT_COMMAND,
      selection,
      coverage: "on",
      coverageDir: "coverage-out",
    });
    expect(argv).toEqual(
      expect.arrayContaining([
        "--coverage.enabled=true",
        "--coverage.reporter=json-summary",
        "--coverage.reportsDirectory=coverage-out",
        "--coverage.thresholds.lines=0",
      ])
    );
    expect(argv).not.toContain(COVERAGE_FLAG);
  });

  it("refuses a command with no `vitest run`", () => {
    expect(() =>
      partialArgv({ argv: ["rspec"], selection, coverage: "off" })
    ).toThrow(/no `vitest run`/);
  });
});

describe("changedFileCoverage", () => {
  const summary = {
    "/repo/src/a.ts": {
      statements: { pct: 90 },
      branches: { pct: 40 },
      functions: { pct: 100 },
      lines: { pct: 90 },
    },
    "/real/repo/src/b.ts": {
      statements: { pct: "Unknown" },
      branches: { pct: "Unknown" },
      functions: { pct: "Unknown" },
      lines: { pct: "Unknown" },
    },
  };

  it("holds each changed file to the floors on its own", () => {
    expect(
      changedFileCoverage({
        summary,
        root: "/repo",
        files: ["src/a.ts", "src/b.ts", "README.md"],
        thresholds: { statements: 74, branches: 65, functions: 60, lines: 75 },
      })
    ).toEqual({
      shortfalls: ["src/a.ts: branches 40% is below 65%"],
      measured: ["src/a.ts", "src/b.ts"],
      unmeasured: ["README.md"],
    });
  });
});

describe("settings and gate declarations", () => {
  it("is off with the full coverage mode by default", () => {
    expect(affectedTestsSettings({})).toEqual({
      enabled: false,
      coverage: "full",
    });
    expect(affectedTestsSettings({ pushGate: { buildOnce: true } })).toEqual({
      enabled: false,
      coverage: "full",
    });
  });

  it("reads each coverage mode", () => {
    for (const mode of ["full", "changed-files", "skip"]) {
      expect(
        affectedTestsSettings({
          pushGate: { affectedTests: true, affectedCoverage: mode },
        })
      ).toEqual({ enabled: true, coverage: mode });
    }
  });

  it("refuses wrong types rather than defaulting them", () => {
    expect(() => affectedTestsSettings({ pushGate: [] })).toThrow(
      /pushGate is/
    );
    expect(() =>
      affectedTestsSettings({ pushGate: { affectedTests: "yes" } })
    ).toThrow(/affectedTests/);
    expect(() =>
      affectedTestsSettings({ pushGate: { affectedCoverage: "some" } })
    ).toThrow(/affectedCoverage/);
  });

  it("knows when coverage-adequacy is declared at push", () => {
    expect(
      coverageDeclaredAtPush({
        [COVERAGE]: { push: { level: "required", run: "x" } },
      })
    ).toBe(true);
    expect(coverageDeclaredAtPush({ [COVERAGE]: { push: "optional" } })).toBe(
      true
    );
    expect(coverageDeclaredAtPush({ [COVERAGE]: { push: "off" } })).toBe(false);
    expect(
      coverageDeclaredAtPush({ [COVERAGE]: { "pull-request": "required" } })
    ).toBe(false);
    expect(coverageDeclaredAtPush(undefined)).toBe(false);
  });

  it("recognises a coverage-measuring command", () => {
    expect(measuresCoverage(UNIT_COMMAND)).toBe(true);
    expect(measuresCoverage(["vitest", "run"])).toBe(false);
  });

  it("matches exclude globs the way the test command writes them", () => {
    expect(
      globToRegExp("**/integration/**").test("tests/integration/a.test.ts")
    ).toBe(true);
    expect(globToRegExp("**/x.test.ts").test("tests/unit/x.test.ts")).toBe(
      true
    );
    expect(globToRegExp("**/x.test.ts").test("tests/unit/y.test.ts")).toBe(
      false
    );
  });
});

describe("the runner's selection channel", () => {
  it("skips coverage-adequacy only for a partial run with coverage left to CI", () => {
    const gate = { id: COVERAGE };
    expect(
      coverageLeftToCi(gate, { selection: "partial", coverage: "skip" })
    ).toBe(true);
    expect(
      coverageLeftToCi(gate, { selection: "full", coverage: "measured" })
    ).toBe(false);
    expect(
      coverageLeftToCi(gate, {
        selection: "partial",
        coverage: "changed-files",
      })
    ).toBe(false);
    expect(
      coverageLeftToCi(
        { id: "test-correctness" },
        { selection: "partial", coverage: "skip" }
      )
    ).toBe(false);
    expect(coverageLeftToCi(gate, null)).toBe(false);
    expect(PARTIAL_COVERAGE_SKIP_REASON).toBe(
      "partial selection — enforced by CI"
    );
  });

  it("hands each command its own report file and reads it back", () => {
    const env: Record<string, string | undefined> = {};
    const channel = openSelectionReports(env);
    try {
      channel.before(COMMAND_A);
      const file = env[SELECTION_REPORT_ENV] as string;
      fs.writeFileSync(file, JSON.stringify({ selection: "partial" }));
      expect(channel.read(COMMAND_A)).toEqual({ selection: "partial" });
      expect(channel.read("bun run test:b")).toBeNull();
      channel.before(COMMAND_A);
      expect(channel.read(COMMAND_A)).toBeNull();
    } finally {
      channel.close();
    }
    expect(env[SELECTION_REPORT_ENV]).toBeUndefined();
  });
});

describe("the project's recorded triggers (#4611)", () => {
  it("turns the globs the recorder wrote into full-suite triggers", () => {
    const triggers = recordedTriggers({
      triggers: [SETUP_FILE, "**/{vitest,vite}.config.*/**", "seed/**"],
    });
    const selection = selectAffectedTests({
      changed: [
        { path: "seed/users.sql", status: "modified", existedAtMapBase: true },
      ],
      map: MAP,
      excluded: [],
      exists: () => true,
      triggers,
    });
    expect(selection.kind).toBe("full");
    expect(selection.reason).toContain(RECORDED_TRIGGER_REASON);
    expect(selection.reason).toContain("seed/users.sql");
    expect(firedTrigger([SETUP_FILE], triggers)?.reason).toContain(SETUP_FILE);
    expect(firedTrigger(["web/vite.config.mts"], triggers)).not.toBeNull();
  });

  it("adds nothing for a map without a trigger list", () => {
    expect(recordedTriggers({})).toEqual([]);
    expect(recordedTriggers(null)).toEqual([]);
    expect(recordedTriggers({ triggers: SETUP_FILE })).toEqual([]);
  });

  it("expands brace alternatives", () => {
    expect(expandBraces("**/{vitest,vite}.config.{ts,js}")).toEqual([
      "**/vitest.config.ts",
      "**/vitest.config.js",
      "**/vite.config.ts",
      "**/vite.config.js",
    ]);
    expect(expandBraces("plain")).toEqual(["plain"]);
  });
});

describe("narrowable", () => {
  it("accepts a vitest run and refuses anything else", () => {
    expect(narrowable(UNIT_COMMAND)).toBe(true);
    expect(narrowable(["jest", COVERAGE_FLAG])).toBe(false);
    expect(narrowable(["vitest"])).toBe(false);
  });
});
