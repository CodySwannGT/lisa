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
  coverageEscalationLines,
  fullSuiteEscalation,
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

const SPAWN_TEST = "tests/unit/scripts/bounded-spawn.test.ts";
const WIKI_NOTE = "wiki/notes.md";
const A_TEST = "tests/unit/a.test.ts";
const COVERAGE_OFF = "--coverage.enabled=false";
const COVERAGE_ENABLED = "--coverage.enabled";
const MAP = {
  [SPAWN_TEST]: [SPAWN],
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
    testFiles: Object.keys(MAP),
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
          file: SPAWN_TEST,
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
    const selection = select([{ path: WIKI_NOTE }]);
    expect(selection).toMatchObject({
      kind: "partial",
      tests: [],
      unread: [WIKI_NOTE],
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
      testFiles: Object.keys(MAP),
    });
    expect(selection.tests.map(test => test.file)).toEqual([SPAWN_TEST]);
  });
});

describe("selectAffectedTests fails closed (review of #4887)", () => {
  const HELPER = "scripts/lib/helper.sh";
  const ONLY_OLD = "src/only-old.ts";
  const OLD_TEST = "tests/unit/old.test.ts";
  const WITH_OLD = { ...MAP, [OLD_TEST]: [SPAWN, ONLY_OLD, SETUP_FILE] };
  const pick = (
    changed: ReadonlyArray<{
      path: string;
      status?: "added" | "modified" | "deleted";
    }>,
    options: {
      map?: Record<string, string[]>;
      testFiles?: string[];
      exists?: (file: string) => boolean;
    } = {}
  ) => {
    const map = options.map ?? MAP;
    return selectAffectedTests({
      changed: changed.map(entry => ({
        status: "modified" as const,
        existedAtMapBase: true,
        ...entry,
      })),
      map,
      excluded: excludedBy(UNIT_COMMAND),
      exists: options.exists ?? (() => true),
      testFiles: options.testFiles ?? Object.keys(map),
      triggers: [{ pattern: /^tests\/setup\.ts$/, reason: "setup file" }],
    });
  };

  it("runs the full suite for an existing non-document file no test was recorded reading", () => {
    // A shell helper hook scripts `source`: the tracer never sees bash read it.
    const selection = pick([{ path: HELPER }, { path: SPAWN }]);
    expect(selection.kind).toBe("full");
    expect(selection.reason).toMatch(/^unread file: scripts\/lib\/helper\.sh /);
  });

  it("runs the full suite for a deleted non-document file no test was recorded reading", () => {
    const selection = pick([{ path: HELPER, status: "deleted" }]);
    expect(selection.kind).toBe("full");
  });

  it.each(["README.md", "docs/guide.md", WIKI_NOTE, "CHANGELOG.md"])(
    "still lists an unread document (%s) without running everything",
    file => {
      const selection = pick([{ path: file }], { map: {} });
      expect(selection).toMatchObject({ kind: "partial", unread: [file] });
    }
  );

  it("adds every runnable test the map has never seen", () => {
    const added = "tests/unit/added-on-main.test.ts";
    const selection = pick([{ path: SPAWN }], {
      testFiles: [
        ...Object.keys(MAP),
        added,
        "tests/integration/added.test.ts",
        "src/not-a-test.ts",
      ],
    });
    expect(selection.kind).toBe("partial");
    expect(selection.tests).toContainEqual({
      file: added,
      reason: "not in the map: added after the recording, or never recorded",
    });
    expect(selection.tests.map(test => test.file)).not.toContain(
      "tests/integration/added.test.ts"
    );
  });

  it("holds the files a deleted test read to the floor, as if they changed", () => {
    const selection = pick([{ path: OLD_TEST, status: "deleted" }], {
      map: { ...WITH_OLD, "tests/unit/also-old.test.ts": [ONLY_OLD] },
      exists: file => file !== OLD_TEST,
    });
    expect(selection.kind).toBe("partial");
    expect(selection.related).toEqual([SPAWN, ONLY_OLD]);
    expect(selection.tests.map(test => test.file)).toEqual(
      expect.arrayContaining([SPAWN_TEST, "tests/unit/also-old.test.ts"])
    );
    expect(selection.tests.map(test => test.file)).not.toContain(OLD_TEST);
  });

  it("runs the full suite when a deleted test was the only reader of a file", () => {
    const selection = pick([{ path: OLD_TEST, status: "deleted" }], {
      map: WITH_OLD,
      exists: file => file !== OLD_TEST,
    });
    expect(selection.kind).toBe("full");
    expect(selection.reason).toContain(ONLY_OLD);
  });

  it("runs the full suite when a deleted test is not in the map", () => {
    const selection = pick(
      [{ path: "tests/unit/gone.test.ts", status: "deleted" }],
      {
        exists: () => false,
      }
    );
    expect(selection.kind).toBe("full");
    expect(selection.reason).toContain("tests/unit/gone.test.ts");
  });

  it("ignores a deleted test the command excludes", () => {
    const selection = pick([
      { path: "tests/integration/gone.test.ts", status: "deleted" },
    ]);
    expect(selection).toMatchObject({ kind: "partial", related: [] });
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
    tests: [{ file: A_TEST, reason: "changed test" }],
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
      COVERAGE_OFF,
      "src/a.ts",
      A_TEST,
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

  it("drops every coverage spelling, and the value a bare one takes", () => {
    const argv = [
      "vitest",
      "run",
      COVERAGE_ENABLED,
      "true",
      "--coverage=true",
      "--no-coverage",
      "--reporter=dot",
    ];
    expect(partialArgv({ argv, selection, coverage: "off" })).toEqual([
      "vitest",
      "related",
      "--run",
      "--reporter=dot",
      COVERAGE_OFF,
      "src/a.ts",
      A_TEST,
    ]);
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
        realRoot: "/real/repo",
        files: ["src/a.ts", "src/b.ts", "README.md"],
        thresholds: { statements: 74, branches: 65, functions: 60, lines: 75 },
      })
    ).toEqual({
      shortfalls: ["src/a.ts: branches 40% is below 65%"],
      measured: ["src/a.ts", "src/b.ts"],
      unmeasured: ["README.md"],
    });
  });

  it("never reads a file's coverage off another file that shares its suffix", () => {
    const verdict = changedFileCoverage({
      summary: {
        "/repo/packages/a/src/index.ts": {
          statements: { pct: 100 },
          branches: { pct: 100 },
          functions: { pct: 100 },
          lines: { pct: 100 },
        },
      },
      root: "/repo",
      realRoot: "/repo",
      files: ["src/index.ts"],
      thresholds: { lines: 75 },
    });
    expect(verdict.measured).toEqual([]);
    expect(verdict.shortfalls).toEqual([
      expect.stringMatching(/^src\/index\.ts: /),
    ]);
  });
});

/** The TypeScript selector's voice in its own lines. */
const SUBJECT = "affected tests";

describe("coverage escalation (push is never stricter than whole-repo coverage)", () => {
  it("names each changed file below its floor once, with every metric it misses", () => {
    expect(
      coverageEscalationLines({
        subject: SUBJECT,
        files: ["src/a.ts", "src/b.ts", "src/c.ts"],
        shortfalls: [
          "src/a.ts: lines 50% is below 80%",
          "src/a.ts: branches 40% is below 70%",
          "src/c.ts: lines 10% is below 80%",
        ],
      })
    ).toEqual([
      "↪️  affected tests: src/a.ts is below its coverage floor on its own (lines 50% is below 80%; branches 40% is below 70%), so the full suite is running now with whole-repo coverage, and that run decides this push.",
      "↪️  affected tests: src/c.ts is below its coverage floor on its own (lines 10% is below 80%), so the full suite is running now with whole-repo coverage, and that run decides this push.",
    ]);
  });

  it("does not take one file's shortfall for another that shares its prefix", () => {
    expect(
      coverageEscalationLines({
        subject: SUBJECT,
        files: ["src/a.ts", "src/a.tsx"],
        shortfalls: ["src/a.tsx: lines 1% is below 80%"],
      })
    ).toEqual([
      "↪️  affected tests: src/a.tsx is below its coverage floor on its own (lines 1% is below 80%), so the full suite is running now with whole-repo coverage, and that run decides this push.",
    ]);
  });

  it("asks for nothing when every changed file meets its floor", () => {
    expect(
      coverageEscalationLines({
        subject: SUBJECT,
        files: ["src/a.ts"],
        shortfalls: [],
      })
    ).toEqual([]);
  });

  it("says why for a partial run that proved nothing", () => {
    expect(
      fullSuiteEscalation(
        "affected specs",
        "the partial run left no SimpleCov resultset"
      )
    ).toBe(
      "↪️  affected specs: the partial run left no SimpleCov resultset, so the full suite is running now with whole-repo coverage, and that run decides this push."
    );
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

  it.each([
    [[COVERAGE_ENABLED], true],
    [["--coverage=true"], true],
    [["--coverage.enabled=true"], true],
    [[COVERAGE_ENABLED, "true"], true],
    [["--coverage=false"], false],
    [[COVERAGE_OFF], false],
    [["--no-coverage"], false],
    [["--coverage", COVERAGE_OFF], false],
  ])("reads coverage flags %j as %s", (flags, on) => {
    expect(measuresCoverage(["vitest", "run", ...flags])).toBe(on);
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
    // A partial run that measured nothing proves nothing about coverage.
    expect(
      coverageLeftToCi(gate, { selection: "partial", coverage: "none" })
    ).toBe(true);
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
      testFiles: Object.keys(MAP),
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
