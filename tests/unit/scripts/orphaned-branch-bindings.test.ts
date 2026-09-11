/** Ambiguous or unreadable attribution must never become a wrong issue verdict. */
import { describe, expect, it, vi } from "vitest";

import {
  branchLanes,
  main,
  workItemRef,
  workItemStates,
} from "../../../all/copy-overwrite/scripts/check-orphaned-branches.mjs";

const BRANCH = "fix/issue-999";
const CONTRACT = { provider: "github", repository: "CodySwannGT/lisa" };
const REFERENCE = "CodySwannGT/lisa#123";
const TRAILER = `Work-Item: ${REFERENCE}`;

describe("complete branch trailer validation", () => {
  it("accepts repeated and case-normalized copies of one canonical reference", () => {
    const messages = `${TRAILER}\n\nwork-item: codyswanngt/LISA#123\n`;
    expect(
      workItemRef(BRANCH, "main", "origin", () => messages, CONTRACT)
    ).toEqual({ ref: "123", refSource: "trailer" });
  });

  it.each([
    `${TRAILER}\nWork-Item: CodySwannGT/lisa#456`,
    `Work-Item: nonsense\n${TRAILER}`,
    `${TRAILER}\nWork-Item: nonsense`,
    "Work-Item: garbage 2026",
    "Work-Item: another/repository#123",
    "Work-Item: #123",
  ])("keeps invalid or ambiguous binding unresolved: %s", messages => {
    const exec = vi.fn((command: string) =>
      command === "git"
        ? messages
        : JSON.stringify({ number: 999, state: "CLOSED" })
    );
    const states = workItemStates([BRANCH], "main", "origin", exec, CONTRACT);
    expect(states.size).toBe(0);
    expect(exec.mock.calls.every(([command]) => command === "git")).toBe(true);
  });

  it("does not infer a binding when commit messages could not be read", () => {
    expect(
      workItemRef(BRANCH, "main", "origin", () => undefined, CONTRACT)
    ).toBeUndefined();
  });

  it("retains branch-name fallback only for a readable untrailered history", () => {
    expect(
      workItemRef(
        BRANCH,
        "main",
        "origin",
        () => "feat: ordinary work",
        CONTRACT
      )
    ).toEqual({ ref: "999", refSource: "branch name" });
  });

  it("does not reinterpret a non-GitHub contract as a GitHub issue number", () => {
    expect(
      workItemRef(BRANCH, "main", "origin", () => "Work-Item: ENG-123", {
        provider: "linear",
        teamKey: "ENG",
      })
    ).toBeUndefined();
  });
});

describe("unreadable lane diagnostics", () => {
  it("distinguishes unreadable commits from readable commits without a stamp", () => {
    const lanes = branchLanes([BRANCH, "fix/bare"], "origin", (_, args) =>
      args[3] === `origin/${BRANCH}` ? undefined : "feat: ordinary work"
    );
    const lines: string[] = [];
    main([], {
      resolveDefaultBranch: () => "main",
      collectAhead: () => [
        { branch: BRANCH, ahead: 1 },
        { branch: "fix/bare", ahead: 1 },
      ],
      collectSubmitted: () => new Set(),
      collectDivergence: () => new Map(),
      collectWorkItems: () => new Map(),
      collectLanes: () => lanes,
      log: (line: string) => lines.push(line),
    });
    expect(lanes.has(BRANCH)).toBe(true);
    expect(lanes.has("fix/bare")).toBe(false);
    expect(lines.join("\n")).toContain("tip commit could not be read");
    expect(lines.join("\n")).toContain("no lane on the tip commit");
  });
});
