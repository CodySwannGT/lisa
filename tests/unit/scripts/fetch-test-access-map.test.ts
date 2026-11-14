/**
 * Unit tests for scripts/fetch-test-access-map.mjs (CodySwannGT/lisa#4593):
 * which published run is chosen for a base commit, how the job maps merge,
 * and that a missing map is reported rather than invented.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatAge,
  main,
  mergedTriggers,
  mergeMaps,
  parseArgs,
  parseArtifacts,
  repositoryFromRemote,
  selectRun,
} from "../../../all/copy-overwrite/scripts/fetch-test-access-map.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const X = "0".repeat(40);
const NOV_13 = "2026-11-13T00:00:00Z";
const CLOCK = "2026-11-13T03:00:00Z";
const UNIT_11 = `test-access-map-${A}-11-unit`;
const INTEGRATION_11 = `test-access-map-${A}-11-integration`;
const OWNER_REPO = "owner/repo";

const created: string[] = [];
afterEach(() => {
  created
    .splice(0)
    .forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

/** Ancestry used by the fake git: A is the parent of B; C is unrelated. */
const ANCESTORS: Readonly<Record<string, number>> = { [`${A}..${B}`]: 1 };

/**
 * Listing line as `gh api --jq` prints it.
 * @param name - Artifact name
 * @param createdAt - Creation time
 * @returns NDJSON line
 */
function line(name: string, createdAt: string): string {
  const runId = /-(\d+)-[^-]+(?:-shard-\d+)?$/.exec(name)?.[1] ?? "0";
  return JSON.stringify({ name, runId: Number(runId), createdAt });
}

/**
 * A fake command runner: git ancestry from ANCESTORS, gh listing from
 * `listing`, and `gh run download` writing `downloads[runId]`.
 * @param listing - Listing output
 * @param downloads - Map files per run id, by artifact name
 * @param calls - Recorded calls
 * @returns Runner
 */
function fakeRun(
  listing: string,
  downloads: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  calls: string[][]
) {
  return (command: string, args: readonly string[]): string => {
    calls.push([command, ...args]);
    if (command === "git" && args[0] === "rev-parse")
      return `${String(args[2]).replace("^{commit}", "")}\n`;
    if (command === "git" && args[0] === "merge-base") {
      const key = `${args[2]}..${args[3]}`;
      if (ANCESTORS[key] === undefined) throw new Error("not an ancestor");
      return "";
    }
    if (command === "git" && args[0] === "rev-list")
      return `${ANCESTORS[String(args[2])]}\n`;
    if (command === "gh" && args[0] === "api") return listing;
    if (command === "gh" && args[0] === "run" && args[1] === "download") {
      const into = args[args.indexOf("--dir") + 1] as string;
      Object.entries(downloads[String(args[2])] ?? {}).forEach(
        ([name, body]) => {
          fs.mkdirSync(path.join(into, name), { recursive: true });
          fs.writeFileSync(
            path.join(into, name, "unit.json"),
            JSON.stringify(body)
          );
        }
      );
      return "";
    }
    throw new Error(`unexpected ${command} ${args.join(" ")}`);
  };
}

/**
 * Run main against fakes, in a temporary output directory.
 * @param argv - Extra arguments
 * @param listing - Listing output
 * @param downloads - Downloads by run id
 * @returns Exit code, output, error and output directory
 */
function runMain(
  argv: readonly string[],
  listing: string,
  downloads: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {}
) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-access-map-fetch-"));
  created.push(out);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[][] = [];
  const code = main([...argv, "--out", out], {
    run: fakeRun(listing, downloads, calls),
    now: () => new Date(CLOCK),
    out: text => stdout.push(text),
    err: text => stderr.push(text),
  });
  return { code, stdout, stderr, out, calls };
}

describe("repositoryFromRemote (#4611)", () => {
  it.each([
    ["https://github.com/owner/repo.git", OWNER_REPO],
    ["https://github.com/owner/repo", OWNER_REPO],
    ["git@github.com:owner/repo.git", OWNER_REPO],
    ["ssh://git@github.com/owner/repo.git\n", OWNER_REPO],
    ["https://github.com/owner/repo/", OWNER_REPO],
    ["https://github.com/owner/repo.git/", OWNER_REPO],
    ["git@github.com::owner/repo", OWNER_REPO],
  ])("reads %s as %s", (url, repo) => {
    expect(repositoryFromRemote(url)).toBe(repo);
  });

  it.each([
    "https://github.com/owner",
    "https://github.com/owner/repo/extra",
    "https://github.com/own er/repo",
    "https://github.com",
    "https://github.comowner/repo",
  ])("answers undefined for %s, which names no single repository", url => {
    expect(repositoryFromRemote(url)).toBe(undefined);
  });

  it("answers a long remote the way the old pattern did, without backtracking", () => {
    // sonarjs/slow-regex: the old lazy-name pattern backtracked on input like
    // this. The answer is unchanged: one trailing `.git` is dropped.
    const name = "a.git".repeat(20_000);
    expect(repositoryFromRemote(`https://github.com/owner/${name}`)).toBe(
      `owner/${name.slice(0, -".git".length)}`
    );
  });

  it("answers undefined for a remote that is not on GitHub", () => {
    expect(repositoryFromRemote("https://gitlab.com/owner/repo.git")).toBe(
      undefined
    );
  });
});

describe("mergedTriggers (#4611)", () => {
  it("unions every recorded trigger list, sorted, ignoring junk", () => {
    expect(
      mergedTriggers([
        { triggers: ["tests/setup.ts", "b/**"] },
        { triggers: ["b/**", 3] },
        { triggers: "nope" },
        {},
      ])
    ).toEqual(["b/**", "tests/setup.ts"]);
  });
});

describe("parseArgs", () => {
  it("reads --base, --repo and --out, with defaults", () => {
    expect(parseArgs(["--base", A])).toEqual({
      base: A,
      // GITHUB_REPOSITORY, else this checkout's origin.
      repo: process.env.GITHUB_REPOSITORY ?? "CodySwannGT/lisa",
      out: ".lisa/test-access-map",
      maxPages: 10,
      maxAgeDays: 7,
    });
    expect(
      parseArgs([
        `--base=${A}`,
        "--repo",
        "o/r",
        "--out=x",
        "--max-pages",
        "3",
        "--max-age-days=2",
      ])
    ).toEqual({
      base: A,
      repo: "o/r",
      out: "x",
      maxPages: 3,
      maxAgeDays: 2,
    });
  });
});

describe("parseArtifacts", () => {
  it("keeps only names that carry a base sha and a run id", () => {
    const listing = [
      line(UNIT_11, NOV_13),
      line(`test-access-map-${A}-11-unit-shard-2`, NOV_13),
      JSON.stringify({ name: "test-access-map--12-unit", runId: 12 }),
      JSON.stringify({ name: "test-timings-12-1-unit", runId: 12 }),
    ].join("\n");
    expect(parseArtifacts(listing).map(artifact => artifact.name)).toEqual([
      UNIT_11,
      `test-access-map-${A}-11-unit-shard-2`,
    ]);
  });
});

describe("selectRun", () => {
  const artifacts = parseArtifacts(
    [
      line(`test-access-map-${A}-10-unit`, "2026-11-12T00:00:00Z"),
      line(UNIT_11, NOV_13),
      line(INTEGRATION_11, NOV_13),
      line(`test-access-map-${C}-12-unit`, "2026-11-13T01:00:00Z"),
    ].join("\n")
  );

  it("prefers the newest run at exactly the requested base", () => {
    const choice = selectRun(artifacts, A, fakeRun("", {}, []));
    expect(choice?.runId).toBe("11");
    expect(choice?.distance).toBe(0);
    expect(choice?.artifacts.map(artifact => artifact.name)).toEqual([
      UNIT_11,
      INTEGRATION_11,
    ]);
  });

  it("falls back to the nearest ancestor", () => {
    const choice = selectRun(artifacts, B, fakeRun("", {}, []));
    expect(choice).toMatchObject({ baseSha: A, distance: 1, runId: "11" });
  });

  it("finds nothing for a commit with no mapped ancestor", () => {
    expect(selectRun(artifacts, X, fakeRun("", {}, []))).toBeUndefined();
  });
});

describe("mergeMaps", () => {
  it("unions every job's entry for the same test file", () => {
    const { map, metas } = mergeMaps([
      {
        meta: { scope: "unit" },
        map: { "t.test.ts": ["a.md"], "u.test.ts": [] },
      },
      {
        meta: { scope: "integration" },
        map: { "t.test.ts": ["b.sh", "a.md"] },
      },
    ]);
    expect(map).toEqual({ "t.test.ts": ["a.md", "b.sh"], "u.test.ts": [] });
    expect(metas).toHaveLength(2);
  });
});

describe("formatAge", () => {
  it.each([
    [5 * 60_000, "5m"],
    [(3 * 60 + 12) * 60_000, "3h 12m"],
    [(2 * 24 + 3) * 3_600_000, "2d 3h"],
    [-1, "0m"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatAge(ms)).toBe(text);
  });
});

describe("main", () => {
  const listing = [line(UNIT_11, NOV_13), line(INTEGRATION_11, NOV_13)].join(
    "\n"
  );
  const downloads = {
    "11": {
      [UNIT_11]: {
        meta: { baseSha: A, createdAt: "2026-11-13T00:10:00.000Z" },
        map: { "tests/unit/a.test.ts": ["src/a.ts", "tests/unit/a.test.ts"] },
      },
      [INTEGRATION_11]: {
        meta: { baseSha: A, createdAt: "2026-11-13T00:05:00.000Z" },
        map: { "tests/integration/b.test.ts": ["docs/b.md"] },
      },
    },
  };

  it("saves the merged map and prints its base and age", () => {
    const result = runMain(["--base", B], listing, downloads);
    expect(result.code, result.stderr.join("\n")).toBe(0);
    const map = JSON.parse(
      fs.readFileSync(path.join(result.out, "map.json"), "utf8")
    );
    expect(map).toEqual({
      "tests/integration/b.test.ts": ["docs/b.md"],
      "tests/unit/a.test.ts": ["src/a.ts", "tests/unit/a.test.ts"],
    });
    const meta = JSON.parse(
      fs.readFileSync(path.join(result.out, "meta.json"), "utf8")
    );
    expect(meta).toMatchObject({
      requestedBase: B,
      baseSha: A,
      commitsBehind: 1,
      runId: "11",
      createdAt: "2026-11-13T00:05:00.000Z",
      testFiles: 2,
      triggers: [],
    });
    expect(result.stdout.join("\n")).toContain(`base ${A}`);
    expect(result.stdout.join("\n")).toContain("age 2h 55m");
    const download = result.calls.find(call => call[1] === "run");
    expect(download).toEqual(
      expect.arrayContaining(["--name", UNIT_11, INTEGRATION_11])
    );
  });

  it("exits 1 with 'no access map for <sha>' when nothing matches", () => {
    const result = runMain(["--base", X], listing, downloads);
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual([`no access map for ${X}`]);
    expect(fs.existsSync(path.join(result.out, "map.json"))).toBe(false);
  });

  it("exits 1 when the chosen run's artifacts hold no map", () => {
    const result = runMain(["--base", A], listing, {});
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual([`no access map for ${A}`]);
  });

  it("stops paging at the first page that yields a usable run", () => {
    const filler = Array.from({ length: 100 }, (_, index) =>
      JSON.stringify({
        name: `coverage-${index}`,
        runId: 99,
        createdAt: NOV_13,
      })
    ).join("\n");
    const pages = [filler, listing, filler];
    const calls: string[][] = [];
    const base = fakeRun(listing, downloads, calls);
    const out = fs.mkdtempSync(
      path.join(os.tmpdir(), "lisa-access-map-fetch-")
    );
    created.push(out);
    const code = main(["--base", B, "--out", out], {
      run: (command, args) => {
        const page = /[?&]page=(\d+)/.exec(String(args[1]))?.[1];
        if (command === "gh" && args[0] === "api" && page !== undefined) {
          calls.push([command, ...args]);
          return pages[Number(page) - 1] ?? "";
        }
        return base(command, args);
      },
      now: () => new Date(CLOCK),
      out: () => undefined,
      err: () => undefined,
    });
    expect(code).toBe(0);
    const listed = calls.filter(
      call => call[0] === "gh" && String(call[2]).includes("/artifacts?")
    );
    expect(listed.map(call => call[2])).toEqual([
      "repos/CodySwannGT/lisa/actions/artifacts?per_page=100&page=1",
      "repos/CodySwannGT/lisa/actions/artifacts?per_page=100&page=2",
      "repos/CodySwannGT/lisa/actions/runs/11/artifacts?per_page=100",
    ]);
  });

  it("stops paging once the listing is older than --max-age-days", () => {
    const old = Array.from({ length: 100 }, (_, index) =>
      JSON.stringify({
        name: `coverage-${index}`,
        runId: 99,
        createdAt: "2026-10-01T00:00:00Z",
      })
    ).join("\n");
    const calls: string[][] = [];
    const code = main(["--base", B, "--out", os.tmpdir()], {
      run: (command, args) => {
        calls.push([command, ...args]);
        if (command === "git") return `${B}\n`;
        return old;
      },
      now: () => new Date(CLOCK),
      out: () => undefined,
      err: () => undefined,
    });
    expect(code).toBe(1);
    expect(calls.filter(call => call[0] === "gh")).toHaveLength(1);
  });

  it("skips expired artifacts", () => {
    const expired = JSON.stringify({
      name: UNIT_11,
      runId: 11,
      createdAt: NOV_13,
      expired: true,
    });
    expect(parseArtifacts(expired)).toEqual([]);
  });

  it("exits 2 without --base", () => {
    expect(runMain([], listing).code).toBe(2);
  });
});
