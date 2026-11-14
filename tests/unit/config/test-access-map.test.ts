/**
 * Unit tests for scripts/lib/test-access-map.mjs (CodySwannGT/lisa#4593):
 * when the map is recorded, how recorded paths are normalized and attributed,
 * and what the reporter writes.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  accessMapMetadata,
  armTestAccessMap,
  mergeAccessRecords,
  repositoryFile,
  TEST_ACCESS_MAP_SETUP_FILE,
  testAccessMapReporter,
  testAccessMapScope,
  testAccessMapSetupFiles,
  withTestAccessMapReporter,
} from "../../../scripts/lib/test-access-map.mjs";

const ROOT = path.join(path.sep, "repo");
const TEST_A = "tests/a.test.ts";
const TEST_B = "tests/b.test.ts";
const MAP_DIR = "test-access-map";
const SETUP_FILE = "tests/setup.ts";
const at = (...parts: string[]): string => path.join(ROOT, ...parts);

const created: string[] = [];
afterEach(() => {
  created
    .splice(0)
    .forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

/**
 * A fresh temporary root.
 * @returns Absolute path
 */
function tempRoot(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-access-map-unit-"))
  );
  created.push(dir);
  return dir;
}

describe("testAccessMapScope", () => {
  it("follows the declared test scope when LISA_ACCESS_MAP=1", () => {
    expect(
      testAccessMapScope({ LISA_ACCESS_MAP: "1", LISA_COVERAGE_SCOPE: "unit" })
    ).toBe("unit");
    expect(
      testAccessMapScope({
        LISA_ACCESS_MAP: "1",
        LISA_TEST_TIMINGS_SCOPE: "integration",
      })
    ).toBe("integration");
  });

  it.each([
    ["the map off", { LISA_COVERAGE_SCOPE: "unit" }],
    [
      "LISA_ACCESS_MAP=0",
      { LISA_ACCESS_MAP: "0", LISA_COVERAGE_SCOPE: "unit" },
    ],
    ["no scope", { LISA_ACCESS_MAP: "1" }],
    [
      "a nested run spawned by a test",
      {
        LISA_ACCESS_MAP: "1",
        LISA_COVERAGE_SCOPE: "unit",
        VITEST_WORKER_ID: "2",
      },
    ],
  ])("records nothing with %s", (_label, env) => {
    expect(testAccessMapScope(env)).toBeUndefined();
  });
});

describe("testAccessMapSetupFiles", () => {
  it("adds the setup file only when the map is on", () => {
    expect(testAccessMapSetupFiles({ LISA_ACCESS_MAP: "1" })).toEqual([
      TEST_ACCESS_MAP_SETUP_FILE,
    ]);
    expect(testAccessMapSetupFiles({})).toEqual([]);
  });
});

describe("repositoryFile", () => {
  it("returns a repository-relative POSIX path", () => {
    expect(repositoryFile(ROOT, at("plugins", "src", "hook.sh"))).toBe(
      "plugins/src/hook.sh"
    );
  });

  it("accepts file: URLs", () => {
    expect(
      repositoryFile(ROOT, `file://${at("src", "a b.ts")}`.replace(" ", "%20"))
    ).toBe("src/a b.ts");
  });

  it.each([
    ["outside the repository", path.join(path.sep, "elsewhere", "x.md")],
    ["the root itself", ROOT],
    ["a relative path", "src/x.ts"],
    ["node_modules", at("node_modules", "vitest", "index.js")],
    ["nested node_modules", at("eslint-plugin-x", "node_modules", "y.js")],
    ["dist", at("dist", "index.js")],
    ["coverage", at("coverage", "lcov.info")],
    ["tmp", at("tmp", "test-timings", "unit.json")],
    [".git", at(".git", "HEAD")],
  ])("drops %s", (_label, file) => {
    expect(repositoryFile(ROOT, file)).toBeUndefined();
  });
});

describe("mergeAccessRecords", () => {
  it("attributes each record to its test file, sorted and deduplicated", () => {
    const test = at("tests", "unit", "a.test.ts");
    const map = mergeAccessRecords({
      root: ROOT,
      testFiles: [test],
      lines: [
        JSON.stringify({
          test,
          files: [at("docs", "b.md"), at("src", "a.ts")],
        }),
        JSON.stringify({
          test,
          files: [at("src", "a.ts"), at("node_modules", "x.js"), "/elsewhere"],
        }),
        "",
        "not json",
        JSON.stringify({ unrelated: true }),
      ],
    });
    expect(map).toEqual({
      "tests/unit/a.test.ts": ["docs/b.md", "src/a.ts", "tests/unit/a.test.ts"],
    });
  });

  it("gives every executed test file an entry, even with no records", () => {
    const map = mergeAccessRecords({
      root: ROOT,
      testFiles: [at(TEST_B), at("tests", "a.test.ts")],
      lines: [],
    });
    expect(Object.keys(map)).toEqual([TEST_A, TEST_B]);
    expect(map[TEST_B]).toEqual([TEST_B]);
  });

  it("merges records from several processes for the same test file", () => {
    const test = at("tests", "a.test.ts");
    const map = mergeAccessRecords({
      root: ROOT,
      testFiles: [],
      lines: [
        JSON.stringify({ test, files: [at("scripts", "hook.sh")] }),
        JSON.stringify({ test, files: [at("docs", "read-by-child.md")] }),
      ],
    });
    expect(map[TEST_A]).toEqual([
      "docs/read-by-child.md",
      "scripts/hook.sh",
      TEST_A,
    ]);
  });
});

describe("accessMapMetadata", () => {
  it("reads the base, head and run from the CI environment", () => {
    expect(
      accessMapMetadata(
        {
          LISA_ACCESS_MAP_BASE_SHA: "a".repeat(40),
          LISA_ACCESS_MAP_HEAD_SHA: "b".repeat(40),
          GITHUB_RUN_ID: "42",
        },
        "unit",
        new Date("2026-11-13T00:00:00Z")
      )
    ).toEqual({
      scope: "unit",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      runId: "42",
      createdAt: "2026-11-13T00:00:00.000Z",
      tracerVersion: 1,
      piece: null,
      pieces: null,
      triggers: [],
    });
  });

  it("records which piece of how many this shard leg's map is (#4593)", () => {
    const meta = accessMapMetadata(
      { LISA_ACCESS_MAP_PIECE: "2", LISA_ACCESS_MAP_PIECES: "4" },
      "unit",
      new Date(0)
    );
    expect(meta).toMatchObject({ piece: 2, pieces: 4 });
  });

  it.each([
    ["", ""],
    ["x", "2"],
    ["-1", "2"],
    ["0", "0"],
    ["1.5", "2"],
  ])(
    "records no piece count for PIECE=%j PIECES=%j, so the fetcher refuses it",
    (piece, pieces) => {
      const meta = accessMapMetadata(
        { LISA_ACCESS_MAP_PIECE: piece, LISA_ACCESS_MAP_PIECES: pieces },
        "unit",
        new Date(0)
      );
      expect(meta["pieces"] === null || meta["piece"] === null).toBe(true);
    }
  );

  it("carries the project's full-rerun triggers (#4611)", () => {
    expect(
      accessMapMetadata({}, "unit", new Date(0), [SETUP_FILE]).triggers
    ).toEqual([SETUP_FILE]);
  });
});

describe("armTestAccessMap", () => {
  it("adds the tracer to NODE_OPTIONS once and names the raw directory", () => {
    const root = tempRoot();
    const env: Record<string, string | undefined> = {
      LISA_ACCESS_MAP: "1",
      LISA_COVERAGE_SCOPE: "unit",
      NODE_OPTIONS: "--max-old-space-size=6144",
    };
    const directory = armTestAccessMap(env, root);
    expect(directory).toBe(env["LISA_ACCESS_MAP_DIR"]);
    expect(directory?.startsWith(path.join(root, "tmp", MAP_DIR))).toBe(true);
    expect(env["LISA_ACCESS_MAP_ROOT"]).toBe(root);
    expect(env["NODE_OPTIONS"]).toMatch(
      /^--max-old-space-size=6144 --import=file:\/\/.*test-access-map-tracer\.mjs$/
    );
    const options = env["NODE_OPTIONS"];
    expect(armTestAccessMap(env, root)).toBe(directory);
    expect(env["NODE_OPTIONS"]).toBe(options);
  });

  it("leaves the environment alone when the map is off", () => {
    const env: Record<string, string | undefined> = {
      LISA_COVERAGE_SCOPE: "unit",
    };
    expect(armTestAccessMap(env, tempRoot())).toBeUndefined();
    expect(env).toEqual({ LISA_COVERAGE_SCOPE: "unit" });
  });
});

describe("testAccessMapReporter", () => {
  const env = {
    LISA_ACCESS_MAP: "1",
    LISA_TEST_TIMINGS_SCOPE: "integration",
    LISA_ACCESS_MAP_BASE_SHA: "c".repeat(40),
  };

  it("writes tmp/test-access-map/<scope>.json and removes the raw records", () => {
    const root = tempRoot();
    const directory = path.join(root, "tmp", MAP_DIR, "raw");
    const test = path.join(root, "tests", "a.test.ts");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "1.ndjson"),
      `${JSON.stringify({ test, files: [path.join(root, "docs", "x.md")] })}\n`
    );
    testAccessMapReporter({ root, directory, env }).onTestRunEnd([
      { moduleId: test, state: () => "passed" },
      {
        moduleId: path.join(root, "tests", "skipped.test.ts"),
        state: () => "skipped",
      },
    ]);
    const written = JSON.parse(
      fs.readFileSync(
        path.join(root, "tmp", MAP_DIR, "integration.json"),
        "utf8"
      )
    );
    expect(written.map).toEqual({
      "tests/a.test.ts": ["docs/x.md", "tests/a.test.ts"],
    });
    expect(written.meta).toMatchObject({
      scope: "integration",
      baseSha: "c".repeat(40),
      tracerVersion: 1,
    });
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("writes nothing when the run recorded nothing", () => {
    const root = tempRoot();
    testAccessMapReporter({
      root,
      directory: path.join(root, "tmp", MAP_DIR, "raw"),
      env,
    }).onTestRunEnd([
      { moduleId: path.join(root, "a.test.ts"), state: () => "passed" },
    ]);
    expect(fs.existsSync(path.join(root, "tmp", MAP_DIR))).toBe(false);
  });
});

describe("withTestAccessMapReporter", () => {
  it("appends the reporter once across project hooks", () => {
    const reporter = testAccessMapReporter({
      root: ROOT,
      directory: ROOT,
      env: {},
    });
    const once = withTestAccessMapReporter(["default"], reporter);
    const twice = withTestAccessMapReporter(
      once,
      testAccessMapReporter({ root: ROOT, directory: ROOT, env: {} })
    );
    expect(once).toEqual(["default", reporter]);
    expect(twice).toBe(once);
  });
});
