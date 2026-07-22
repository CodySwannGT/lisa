import { describe, expect, it } from "vitest";
import {
  chunk,
  extractWorkItemRefs,
  type RefExtractionDeps,
} from "../../../src/cli/deploy-status-refs.js";

const REPOSITORY = "acme/app";

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
      { range: "abc..def", tracker: "github", cwd: "/tmp" },
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
      "abc..def",
    ]);
  });

  it("rejects a range with characters outside the revision charset", async () => {
    const gitCalls: string[][] = [];
    await expect(
      extractWorkItemRefs(
        { range: "abc..$(reboot)", tracker: "github", cwd: "/tmp" },
        scriptedDeps([], gitCalls, [])
      )
    ).rejects.toThrow(/Invalid range .*revision/);
    expect(gitCalls).toHaveLength(0);
  });

  it("rejects an empty range side decision-readably", async () => {
    await expect(
      extractWorkItemRefs(
        { range: "..def", tracker: "github", cwd: "/tmp" },
        scriptedDeps([], [], [])
      )
    ).rejects.toThrow(/Invalid range/);
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
        range: "abc..def",
        tracker: "github",
        repository: REPOSITORY,
        cwd: "/tmp",
      },
      deps
    );
    expect(concurrencyLog.length).toBe(20);
    expect(Math.max(...concurrencyLog)).toBeLessThanOrEqual(8);
  });
});
