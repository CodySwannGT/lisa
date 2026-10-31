/**
 * `scripts/lisa-rspec-shards.mjs`: the RSpec shard planner and verifier behind
 * `quality-rails.yml` `test_shards` (CodySwannGT/lisa#4560).
 *
 * The plan must be a partition of the suite — every spec file in exactly one
 * shard — and the aggregate must refuse any run in which a file was dropped or
 * ran twice. Both are exercised against real files on disk.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertPartition,
  buildPlan,
  buildTimings,
  canonicalPath,
  discoverSpecFiles,
  main,
  parseShardCount,
  partition,
  readShardRecords,
  readTimings,
  refuseCustomDiscovery,
  ShardError,
  shardFiles,
  stageResultset,
  verifyShards,
  weighFiles,
} from "../../../rails/copy-overwrite/scripts/lisa-rspec-shards.mjs";

const A_SPEC = "spec/a_spec.rb";
const B_SPEC = "spec/b_spec.rb";
const C_SPEC = "spec/c_spec.rb";
const RESULTSET = "resultset.json";
const SHARDS_DIR_FLAG = "--shards-dir";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A scratch directory removed after the test.
 * @returns Its path
 */
function scratch(): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-rspec-shards-"));
  roots.push(root);
  return root;
}

/**
 * Write a file, creating its directory.
 * @param root - Base directory
 * @param relative - Path under it
 * @param body - Contents
 * @returns The absolute path
 */
function put(root: string, relative: string, body = "x"): string {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}

/**
 * A project with spec files of the given byte sizes.
 * @param sizes - Bytes by repo-relative spec path
 * @returns The project root
 */
function project(sizes: Record<string, number>): string {
  const root = scratch();
  for (const [file, bytes] of Object.entries(sizes))
    put(root, file, "#".repeat(bytes));
  return root;
}

/** One shard record, as lisa_rspec_shard_recorder.rb writes it. */
interface ShardRecordDoc {
  version: number;
  shard: string;
  files_to_run: string[];
  examples: { file: string; run_time: number }[];
  simplecov: { active: boolean; coverage_path?: string };
}

/**
 * Write a shard's record (and optionally its staged resultset).
 * @param dir - Shards directory
 * @param record - The record
 * @param resultset - Whether to stage a resultset beside it
 */
function writeRecord(
  dir: string,
  record: ShardRecordDoc,
  resultset = false
): void {
  const index = record.shard.split("/")[0] ?? "0";
  const shardDir = path.join(dir, `rspec-shard-nonce-${index}`);
  put(shardDir, "record.json", JSON.stringify(record));
  if (resultset) put(shardDir, RESULTSET, "{}");
}

/**
 * A record that ran exactly the given files.
 * @param shard - "K/N"
 * @param files - Files RSpec loaded
 * @param active - Whether SimpleCov measured
 * @returns The record
 */
function ran(shard: string, files: string[], active = false): ShardRecordDoc {
  return {
    version: 1,
    shard,
    files_to_run: files,
    examples: files.map(file => ({ file, run_time: 1 })),
    simplecov: active
      ? { active: true, coverage_path: "coverage" }
      : { active: false },
  };
}

describe("discovering the suite a bare rspec loads", () => {
  it("finds every *_spec.rb under spec/, sorted, skipping dot entries and non-specs", () => {
    const root = scratch();
    put(root, "spec/models/user_spec.rb");
    put(root, A_SPEC);
    put(root, "spec/support/helpers.rb");
    put(root, "spec/.hidden/secret_spec.rb");
    put(root, "spec/.dot_spec.rb");
    put(root, "test/other_spec.rb");
    expect(discoverSpecFiles(root)).toEqual([
      A_SPEC,
      "spec/models/user_spec.rb",
    ]);
  });

  it("returns nothing for a project with no spec directory", () => {
    expect(discoverSpecFiles(scratch())).toEqual([]);
  });

  it("refuses a symlinked spec directory rather than guess at RSpec's traversal", () => {
    const root = scratch();
    put(root, "elsewhere/x_spec.rb");
    put(root, A_SPEC);
    fs.symlinkSync(
      path.join(root, "elsewhere"),
      path.join(root, "spec", "linked")
    );
    expect(() => discoverSpecFiles(root)).toThrow(/symlinked directory/);
  });

  it("refuses an .rspec that changes which files load, and accepts one that does not", () => {
    const root = scratch();
    put(root, ".rspec", "--format documentation\n--require spec_helper\n");
    expect(() => refuseCustomDiscovery(root)).not.toThrow();
    put(root, ".rspec-local", "--exclude-pattern=spec/slow/**/*_spec.rb\n");
    expect(() => refuseCustomDiscovery(root)).toThrow(
      /\.rspec-local sets --exclude-pattern/
    );
  });

  it("ignores a commented-out discovery option", () => {
    const root = scratch();
    put(root, ".rspec", "# --pattern spec/x\n");
    expect(() => refuseCustomDiscovery(root)).not.toThrow();
  });
});

describe("parsing test_shards", () => {
  it.each([
    ["1", 1],
    ["4", 4],
    ["20", 20],
    [" 3 ", 3],
  ])("accepts %j", (raw, count) => {
    expect(parseShardCount(raw)).toBe(count);
  });

  it.each(["0", "21", "-1", "2.5", "four", ""])("refuses %j", raw => {
    expect(() => parseShardCount(raw)).toThrow(ShardError);
  });
});

describe("weighing files", () => {
  it("uses file size when no timing is known", () => {
    expect(weighFiles(["a", "b"], { a: 100, b: 300 }, {})).toEqual({
      weights: { a: 100, b: 300 },
      basis: "size",
    });
  });

  it("uses recorded seconds when every file is known", () => {
    expect(weighFiles(["a", "b"], { a: 1, b: 1 }, { a: 5, b: 2 })).toEqual({
      weights: { a: 5, b: 2 },
      basis: "timings",
    });
  });

  it("scales an unknown file's size by the known files' seconds per byte", () => {
    const { weights, basis } = weighFiles(
      ["known", "new"],
      { known: 200, new: 100 },
      { known: 10 }
    );
    expect(basis).toBe("mixed");
    expect(weights).toEqual({ known: 10, new: 5 });
  });

  it("drops a malformed or foreign timings file instead of trusting it", () => {
    const root = scratch();
    const good = put(
      root,
      "t.json",
      JSON.stringify({ version: 1, files: { a: 2, b: -1, c: "x" } })
    );
    expect(readTimings(good)).toEqual({ a: 2 });
    expect(readTimings(put(root, "bad.json", "{not json"))).toEqual({});
    expect(
      readTimings(put(root, "old.json", JSON.stringify({ version: 0 })))
    ).toEqual({});
    expect(readTimings(path.join(root, "absent.json"))).toEqual({});
    expect(readTimings(undefined)).toEqual({});
  });
});

describe("splitting the suite", () => {
  it("balances by weight, heaviest first, and is a partition", () => {
    const files = ["a", "b", "c", "d", "e", "f"];
    const weights = { a: 9, b: 7, c: 6, d: 5, e: 4, f: 1 };
    const shards = partition(files, weights, 3);
    expect(shards.map(shard => shard.estimate)).toEqual([10, 11, 11]);
    expect(() => assertPartition(files, shards)).not.toThrow();
  });

  it("is deterministic: the same inputs give the same split", () => {
    const files = Array.from({ length: 40 }, (_, i) => `spec/f${i}_spec.rb`);
    const weights = Object.fromEntries(files.map(file => [file, 1]));
    expect(partition(files, weights, 4)).toEqual(
      partition([...files].reverse(), weights, 4)
    );
  });

  it("puts every file in the single shard when test_shards is 1", () => {
    const shards = partition(["b", "a"], { a: 1, b: 2 }, 1);
    expect(shards).toEqual([{ index: 1, files: ["a", "b"], estimate: 3 }]);
  });

  it("refuses a split that drops a file", () => {
    expect(() =>
      assertPartition(
        ["a", "b", "c"],
        [
          { index: 1, files: ["a"] },
          { index: 2, files: ["b"] },
        ]
      )
    ).toThrow(/in no shard: c/);
  });

  it("refuses a split that duplicates a file", () => {
    expect(() =>
      assertPartition(
        ["a", "b"],
        [
          { index: 1, files: ["a", "b"] },
          { index: 2, files: ["b"] },
        ]
      )
    ).toThrow(/in more than one shard: b \(shards 1, 2\)/);
  });

  it("refuses a split that names a file the suite does not have", () => {
    expect(() =>
      assertPartition(["a"], [{ index: 1, files: ["a", "z"] }])
    ).toThrow(/not a discovered spec file: z/);
  });

  it("refuses an empty shard, which a bare rspec would turn into the whole suite", () => {
    expect(() =>
      assertPartition(
        ["a"],
        [
          { index: 1, files: ["a"] },
          { index: 2, files: [] },
        ]
      )
    ).toThrow(/shard 2 has no spec files/);
  });
});

describe("building a plan", () => {
  it("plans a real tree and balances by size when there are no timings", () => {
    const root = project({
      "spec/big_spec.rb": 900,
      "spec/mid_spec.rb": 500,
      "spec/small_spec.rb": 400,
    });
    const plan = buildPlan({ root, total: 2 });
    expect(plan.basis).toBe("size");
    expect(plan.files).toHaveLength(3);
    expect(plan.shards.map(shard => shard.files)).toEqual([
      ["spec/big_spec.rb"],
      ["spec/mid_spec.rb", "spec/small_spec.rb"],
    ]);
  });

  it("rebalances by recorded timings", () => {
    const root = project({
      "spec/big_spec.rb": 900,
      "spec/mid_spec.rb": 500,
      "spec/small_spec.rb": 400,
    });
    const plan = buildPlan({
      root,
      total: 2,
      timings: {
        "spec/big_spec.rb": 1,
        "spec/mid_spec.rb": 1,
        "spec/small_spec.rb": 30,
      },
    });
    expect(plan.basis).toBe("timings");
    expect(plan.shards.map(shard => shard.files)).toEqual([
      ["spec/small_spec.rb"],
      ["spec/big_spec.rb", "spec/mid_spec.rb"],
    ]);
  });

  it("refuses more shards than spec files", () => {
    const root = project({ [A_SPEC]: 1, [B_SPEC]: 1 });
    expect(() => buildPlan({ root, total: 3 })).toThrow(
      /only 2 spec file\(s\)/
    );
  });

  it("refuses a project with no spec files", () => {
    expect(() => buildPlan({ root: scratch(), total: 2 })).toThrow(
      /nothing to shard/
    );
  });

  it("hands each leg exactly its planned files, and refuses an unknown shard", () => {
    const root = project({ [A_SPEC]: 5, [B_SPEC]: 1 });
    const plan = buildPlan({ root, total: 2 });
    expect(shardFiles(plan, 1)).toEqual([A_SPEC]);
    expect(shardFiles(plan, 2)).toEqual([B_SPEC]);
    expect(() => shardFiles(plan, 3)).toThrow(/no shard 3/);
  });
});

describe("verifying the shards ran the suite exactly once", () => {
  const files = [A_SPEC, B_SPEC, C_SPEC];
  const plan = {
    version: 1,
    total: 2,
    basis: "size" as const,
    files,
    shards: [
      { index: 1, files: [A_SPEC, C_SPEC], estimate: 2 },
      { index: 2, files: [B_SPEC], estimate: 1 },
    ],
  };

  /**
   * Verify a set of records against the plan.
   * @param records - Records to write
   * @param resultsets - Whether to stage a resultset with each
   * @returns The verdict
   */
  function verify(records: ShardRecordDoc[], resultsets = false) {
    const dir = scratch();
    for (const record of records) writeRecord(dir, record, resultsets);
    const read = readShardRecords(dir);
    return verifyShards({
      plan,
      records: read.records,
      recordProblems: read.problems,
      discovered: files,
    });
  }

  it("passes when every planned file ran in its own shard", () => {
    const verdict = verify([
      ran("1/2", [`./${A_SPEC}`, C_SPEC]),
      ran("2/2", [B_SPEC]),
    ]);
    expect(verdict).toEqual({ problems: [], resultsets: [], coverage: false });
  });

  it("fails when a shard dropped a file it was given", () => {
    const { problems } = verify([ran("1/2", [A_SPEC]), ran("2/2", [B_SPEC])]);
    expect(problems).toContain(
      "shard 1 did not run files it was given: spec/c_spec.rb"
    );
    expect(problems).toContain("ran in no shard: spec/c_spec.rb");
  });

  it("fails when a file ran in two shards", () => {
    const { problems } = verify([
      ran("1/2", [A_SPEC, C_SPEC]),
      ran("2/2", [B_SPEC, A_SPEC]),
    ]);
    expect(problems).toContain(
      "shard 2 ran files it was not given: spec/a_spec.rb"
    );
    expect(problems).toContain(
      "ran in more than one shard: spec/a_spec.rb (shards 1, 2)"
    );
  });

  it("fails when a shard left no record", () => {
    const { problems } = verify([ran("1/2", [A_SPEC, C_SPEC])]);
    expect(problems).toContain("shard 2/2 left no run record.");
  });

  it("fails when a shard directory has no record or a foreign one", () => {
    const dir = scratch();
    writeRecord(dir, ran("1/2", [A_SPEC, C_SPEC]));
    fs.mkdirSync(path.join(dir, "rspec-shard-nonce-2"));
    put(dir, "rspec-shard-nonce-3/record.json", JSON.stringify({ v: 9 }));
    put(dir, "rspec-shard-nonce-4/record.json", "{");
    const read = readShardRecords(dir);
    expect(read.problems).toHaveLength(3);
    expect(read.problems[0]).toMatch(/rspec-shard-nonce-2 has no record\.json/);
    expect(read.problems[1]).toMatch(/is not a version 1 shard record/);
    expect(read.problems[2]).toMatch(/is not JSON/);
  });

  it("fails when the plan no longer matches the checkout", () => {
    const read = readShardRecords(scratch());
    const { problems } = verifyShards({
      plan,
      records: read.records,
      discovered: [...files, "spec/new_spec.rb"],
    });
    expect(problems[0]).toMatch(
      /the plan does not match this checkout: .*in no shard: spec\/new_spec\.rb/
    );
  });

  it("names every shard's resultset when SimpleCov measured all of them", () => {
    const verdict = verify(
      [ran("1/2", [A_SPEC, C_SPEC], true), ran("2/2", [B_SPEC], true)],
      true
    );
    expect(verdict.problems).toEqual([]);
    expect(verdict.coverage).toBe(true);
    expect(verdict.resultsets).toHaveLength(2);
    expect(verdict.resultsets.every(file => file.endsWith(RESULTSET))).toBe(
      true
    );
  });

  it("fails when only some shards measured coverage, or one uploaded no resultset", () => {
    const partial = verify([
      ran("1/2", [A_SPEC, C_SPEC], true),
      ran("2/2", [B_SPEC], false),
    ]);
    expect(partial.problems).toContain(
      "SimpleCov measured 1 of 2 shards; merged coverage would be partial."
    );
    expect(partial.problems).toContain(
      "shard 1/2 measured coverage but uploaded no resultset.json."
    );
  });
});

describe("timings and staging", () => {
  it("sums example run times per file, keeping files with no examples at zero", () => {
    const timings = buildTimings([
      {
        record: {
          ...ran("1/2", [`./${A_SPEC}`, "spec/empty_spec.rb"]),
          examples: [
            { file: `./${A_SPEC}`, run_time: 1.25 },
            { file: A_SPEC, run_time: 0.5 },
          ],
        },
      },
    ]);
    expect(timings).toEqual({
      version: 1,
      files: { [A_SPEC]: 1.75, "spec/empty_spec.rb": 0 },
    });
  });

  it("stages a measuring shard's resultset and skips a non-measuring one", () => {
    const root = scratch();
    const coverage = path.join(root, "coverage");
    put(coverage, ".resultset.json", '{"RSpec":{}}');
    const measuring = put(
      root,
      "a/record.json",
      JSON.stringify({
        ...ran("1/1", []),
        simplecov: { active: true, coverage_path: coverage },
      })
    );
    const staged = stageResultset(measuring, path.join(root, "out"));
    expect(staged).toBe(path.join(root, "out", RESULTSET));
    expect(fs.readFileSync(staged as string, "utf8")).toBe('{"RSpec":{}}');

    const idle = put(root, "b/record.json", JSON.stringify(ran("1/1", [])));
    expect(stageResultset(idle, path.join(root, "out2"))).toBeNull();
  });

  it("refuses to stage when SimpleCov measured but wrote nothing", () => {
    const root = scratch();
    const record = put(
      root,
      "record.json",
      JSON.stringify({
        ...ran("1/1", []),
        simplecov: { active: true, coverage_path: path.join(root, "none") },
      })
    );
    expect(() => stageResultset(record, path.join(root, "out"))).toThrow(
      /wrote no/
    );
  });

  it("canonicalises RSpec's spellings of a path", () => {
    expect(canonicalPath(`./${A_SPEC}`)).toBe(A_SPEC);
    expect(canonicalPath(A_SPEC)).toBe(A_SPEC);
  });
});

describe("the command line", () => {
  it("plans, hands out files, verifies and records timings end to end", () => {
    const root = project({
      [A_SPEC]: 50,
      [B_SPEC]: 40,
      [C_SPEC]: 30,
    });
    const work = scratch();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const planFile = path.join(work, "plan.json");
    expect(
      main(["plan", "--shards", "2", "--out", planFile, "--root", root])
    ).toBe(0);
    const shardsDir = path.join(work, "shards");
    for (const index of [1, 2]) {
      const list = path.join(work, `files-${index}.txt`);
      expect(
        main([
          "files",
          "--plan",
          planFile,
          "--shard",
          String(index),
          "--out",
          list,
        ])
      ).toBe(0);
      const assigned = fs.readFileSync(list, "utf8").trim().split("\n");
      writeRecord(shardsDir, ran(`${index}/2`, assigned));
    }
    const resultsets = path.join(work, "resultsets.txt");
    expect(
      main([
        "verify",
        "--plan",
        planFile,
        SHARDS_DIR_FLAG,
        shardsDir,
        "--resultsets",
        resultsets,
        "--root",
        root,
      ])
    ).toBe(0);
    expect(fs.readFileSync(resultsets, "utf8")).toBe("");
    const timings = path.join(work, "timings.json");
    expect(
      main(["timings", SHARDS_DIR_FLAG, shardsDir, "--out", timings])
    ).toBe(0);
    expect(Object.keys(readTimings(timings))).toHaveLength(3);
  });

  it("exits non-zero and annotates when verification fails", () => {
    const root = project({ [A_SPEC]: 5, [B_SPEC]: 1 });
    const work = scratch();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const planFile = path.join(work, "plan.json");
    main(["plan", "--shards", "2", "--out", planFile, "--root", root]);
    writeRecord(path.join(work, "shards"), ran("1/2", [A_SPEC]));
    expect(
      main([
        "verify",
        "--plan",
        planFile,
        SHARDS_DIR_FLAG,
        path.join(work, "shards"),
        "--resultsets",
        path.join(work, "r.txt"),
        "--root",
        root,
      ])
    ).toBe(1);
    expect(log.mock.calls.flat().join("\n")).toContain(
      "::error title=RSpec shards did not run the suite exactly once::shard 2/2 left no run record."
    );
  });

  it("refuses an unknown subcommand or a missing flag", () => {
    expect(() => main(["bogus"])).toThrow(/unknown subcommand/);
    expect(() => main(["plan", "--out", "x"])).toThrow(/--shards is required/);
    expect(() => main(["plan", "--shards"])).toThrow(/needs a value/);
  });
});
