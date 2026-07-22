import { describe, expect, it } from "vitest";
import {
  chunk,
  extractWorkItemRefs,
  type RefExtractionDeps,
} from "../../../src/cli/deploy-status-refs.js";

const REPOSITORY = "acme/app";
const RANGE = "abc..def";
const CWD = "/tmp";
const REF_103 = "acme/app#103";

/**
 * Build fully-scripted deps recording git/gh argv.
 * @param gitResponses - Stdout payload per git invocation, in call order
 * @param gitCalls - Sink recording git argv
 * @param ghCalls - Sink recording gh argv
 * @returns Injectable deps
 */
function scriptedDeps(
  gitResponses: readonly string[],
  gitCalls: string[][],
  ghCalls: string[][]
): RefExtractionDeps {
  const queue = [...gitResponses];
  return {
    execGit: args => {
      gitCalls.push([...args]);
      return Promise.resolve(queue.shift() ?? "");
    },
    execGh: args => {
      ghCalls.push([...args]);
      return Promise.resolve("[]");
    },
  };
}

describe("extractWorkItemRefs revision hardening", () => {
  it("passes --end-of-options before every revision argument (argv pin)", async () => {
    const gitCalls: string[][] = [];
    const result = await extractWorkItemRefs(
      { range: RANGE, tracker: "github", cwd: CWD },
      scriptedDeps(["deadbeef\n", ""], gitCalls, [])
    );
    expect(result.refs).toEqual([]);
    expect(gitCalls[0]).toEqual([
      "rev-parse",
      "--verify",
      "--end-of-options",
      "def",
    ]);
    expect(gitCalls[1]).toEqual([
      "rev-list",
      "--reverse",
      "--end-of-options",
      RANGE,
    ]);
  });

  it("rejects a range with characters outside the revision charset", async () => {
    const gitCalls: string[][] = [];
    await expect(
      extractWorkItemRefs(
        { range: "abc..$(reboot)", tracker: "github", cwd: CWD },
        scriptedDeps([], gitCalls, [])
      )
    ).rejects.toThrow(/Invalid range .*revision/);
    expect(gitCalls).toHaveLength(0);
  });

  it("rejects an empty range side decision-readably", async () => {
    await expect(
      extractWorkItemRefs(
        { range: "..def", tracker: "github", cwd: CWD },
        scriptedDeps([], [], [])
      )
    ).rejects.toThrow(/Invalid range/);
  });
});

describe("PR-body token edges", () => {
  const MERGED_AT = "2026-07-01T00:00:00Z";

  /**
   * Run extraction over a scripted single-commit range with one merged PR.
   * @param body - The PR body
   * @returns Extraction result
   */
  function extractWithPrBody(
    body: string
  ): ReturnType<typeof extractWorkItemRefs> {
    const pr = JSON.stringify([{ number: 7, merged_at: MERGED_AT, body }]);
    const deps: RefExtractionDeps = {
      execGit: args =>
        Promise.resolve(
          args[0] === "rev-parse"
            ? "headsha\n"
            : args[0] === "rev-list"
              ? "sha1\n"
              : ""
        ),
      execGh: () => Promise.resolve(pr),
    };
    return extractWorkItemRefs(
      {
        range: RANGE,
        tracker: "github",
        repository: REPOSITORY,
        cwd: CWD,
      },
      deps
    );
  }

  it("strips trailing punctuation from candidate tokens", async () => {
    const result = await extractWithPrBody("Closes #102.\nRefs #103,\n");
    expect(result.refs).toEqual(["acme/app#102", REF_103]);
  });

  it("ignores Refs lines inside fenced code regions", async () => {
    const result = await extractWithPrBody(
      "Refs #103\n```\nCloses #500\n```\nSome prose\n"
    );
    expect(result.refs).toEqual([REF_103]);
    expect(result.skipped.map(entry => entry.token)).not.toContain("#500");
  });

  it("reports a dropped candidate in skipped with a reason, never silently", async () => {
    const result = await extractWithPrBody("Refs abc#xyz\nRefs #103\n");
    expect(result.refs).toEqual([REF_103]);
    const dropped = result.skipped.find(entry => entry.token === "abc#xyz");
    expect(dropped?.reason).toBeTruthy();
  });
});

describe("chunk", () => {
  it("splits items into consecutive chunks of at most the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when items fit", () => {
    expect(chunk(["a"], 8)).toEqual([["a"]]);
  });

  it("returns no chunks for no items", () => {
    expect(chunk([], 8)).toEqual([]);
  });
});

describe("gh fan-out bounding", () => {
  it("never runs more than 8 concurrent gh lookups for many SHAs", async () => {
    const shas = Array.from(
      { length: 20 },
      (_, index) => `sha${String(index)}`
    );
    const concurrencyLog: number[] = [];
    const state = { inFlight: 0 };
    const deps: RefExtractionDeps = {
      execGit: args =>
        Promise.resolve(
          args[0] === "rev-parse"
            ? "headsha\n"
            : args[0] === "rev-list"
              ? `${shas.join("\n")}\n`
              : ""
        ),
      execGh: async () => {
        state.inFlight += 1;
        concurrencyLog.push(state.inFlight);
        await new Promise(resolve => setTimeout(resolve, 1));
        state.inFlight -= 1;
        return "[]";
      },
    };
    await extractWorkItemRefs(
      {
        range: RANGE,
        tracker: "github",
        repository: REPOSITORY,
        cwd: CWD,
      },
      deps
    );
    expect(concurrencyLog.length).toBe(20);
    expect(Math.max(...concurrencyLog)).toBeLessThanOrEqual(8);
  });
});
