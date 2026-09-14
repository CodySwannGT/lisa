/** Incomplete remote evidence must not become a clean branch report. */
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  branchesAhead,
  branchesWithPullRequests,
  main,
} from "../../../all/copy-overwrite/scripts/check-orphaned-branches.mjs";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const spawn = vi.mocked(spawnSync);

/** One GraphQL page from GitHub's pull request connection. */
const page = (nodes: { headRefName: string }[], hasNextPage = false) => ({
  data: {
    repository: {
      pullRequests: {
        nodes,
        pageInfo: { hasNextPage, endCursor: nodes.at(-1)?.headRefName ?? null },
      },
    },
  },
});

beforeEach(() => vi.resetAllMocks());

describe("complete pull request enumeration", () => {
  it("includes a branch beyond the first thousand pull requests", () => {
    spawn.mockImplementation((_command, args) => {
      const paginated =
        args?.includes("--paginate") && args.includes("--slurp");
      const rows = Array.from({ length: 1_001 }, (_, index) => ({
        headRefName: `fix/${index}`,
      }));
      return {
        status: 0,
        stdout: JSON.stringify(
          paginated
            ? Array.from({ length: 11 }, (_, index) =>
                page(rows.slice(index * 100, (index + 1) * 100), index < 10)
              )
            : rows.slice(0, 1000)
        ),
      } as ReturnType<typeof spawnSync>;
    });
    expect(branchesWithPullRequests()?.has("fix/1000")).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining([
        "api",
        "graphql",
        "--paginate",
        "--slurp",
        "owner={owner}",
        "name={repo}",
        expect.stringContaining("after:$endCursor"),
      ]),
      expect.any(Object)
    );
  });

  it("rejects a successful response that still has another page", () => {
    spawn.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([page([{ headRefName: "fix/first" }], true)]),
    } as ReturnType<typeof spawnSync>);
    expect(branchesWithPullRequests()).toBeUndefined();
  });

  it("rejects a page with no completion metadata", () => {
    spawn.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([
        { data: { repository: { pullRequests: { nodes: [] } } } },
      ]),
    } as ReturnType<typeof spawnSync>);
    expect(branchesWithPullRequests()).toBeUndefined();
  });

  it("accepts a repository with no pull requests", () => {
    spawn.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([page([])]),
    } as ReturnType<typeof spawnSync>);
    expect(branchesWithPullRequests()).toEqual(new Set());
  });

  it.each(["{}", "[{}]", "[[{}]]"])("rejects malformed listing %s", stdout => {
    spawn.mockReturnValue({ status: 0, stdout } as ReturnType<
      typeof spawnSync
    >);
    expect(branchesWithPullRequests()).toBeUndefined();
  });
});

describe("branch count failures", () => {
  it.each([
    { status: 1, stdout: "" },
    { status: 0, stdout: "" },
    { status: 0, stdout: "2 commits" },
  ])("reports unavailable after a bad rev-list result: %j", result => {
    spawn.mockImplementation(
      (_command, args) =>
        ({
          ...(args?.[0] === "for-each-ref"
            ? { status: 0, stdout: "main\nfix/unreadable" }
            : result),
        }) as ReturnType<typeof spawnSync>
    );
    expect(branchesAhead()).toBeUndefined();
    const log = vi.fn();
    const warn = vi.fn();
    expect(
      main([], {
        resolveDefaultBranch: () => "main",
        collectSubmitted: () => new Set(),
        log,
        warn,
      })
    ).not.toBe(0);
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("NOT a clean result")
    );
  });

  it("accepts a measured zero and retains a branch with commits", () => {
    spawn.mockImplementation(
      (_command, args) =>
        ({
          status: 0,
          stdout:
            args?.[0] === "for-each-ref"
              ? "main\nfix/level\nfix/ahead"
              : args?.at(-1)?.endsWith("fix/level")
                ? "0"
                : "2",
        }) as ReturnType<typeof spawnSync>
    );
    expect(branchesAhead()).toEqual([{ branch: "fix/ahead", ahead: 2 }]);
  });
});
