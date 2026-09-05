/**
 * Which branches count as pushed-but-never-submitted, and which deliberately do not.
 *
 * The check exists because `lisa-git-submit-pr` binds Push and PR Management
 * with nothing — no atomicity, no post-condition — so an agent that stops
 * between them leaves finished work on a remote branch that is in no review, no
 * CI run and no report. Measured at 15 such branches in one day, and 64
 * repository-wide once the check existed to look.
 *
 * **The exclusion cases carry the weight here.** A check that reported every
 * remote branch would satisfy the positive case while being pure noise, and a
 * noisy check is one nobody reads — the same outcome as no check at all. So
 * each reason for silence is asserted separately, by name, rather than through
 * a single count that a broken filter could still satisfy.
 */
import { describe, expect, it } from "vitest";

import {
  main,
  orphanedBranches,
  refInBranchName,
  workItemStates,
} from "../../../all/copy-overwrite/scripts/check-orphaned-branches.mjs";

/**
 * The measured case, named once: a branch on the remote, one commit ahead of
 * the base, no pull request in any state — and a work item that had already
 * closed because the behaviour shipped from a sibling item.
 */
const SUPERSEDED_BRANCH = "qd/3604-follow-execution-not-args";

/** A branch whose work item is still open, so it really is unsubmitted work. */
const LIVE_BRANCH = "fix/3904-live";

describe("orphaned branch selection", () => {
  it("reports a branch ahead of base with no pull request", () => {
    const found = orphanedBranches({
      ahead: [{ ahead: 3, branch: "stack/1234" }],
      submitted: new Set<string>(),
    });
    expect(found.map(row => row.branch)).toEqual(["stack/1234"]);
  });

  it("stays silent on a branch with an OPEN pull request", () => {
    const found = orphanedBranches({
      ahead: [{ ahead: 3, branch: "fix/in-review" }],
      submitted: new Set(["fix/in-review"]),
    });
    expect(found).toEqual([]);
  });

  it("stays silent on a branch whose pull request already MERGED", () => {
    // Branches routinely outlive their merged pull requests. Keying on "no OPEN
    // pull request" would report every un-deleted branch in the repository and
    // bury the real findings — which is why the collector asks for state=all.
    const found = orphanedBranches({
      ahead: [{ ahead: 7, branch: "fix/landed-last-week" }],
      submitted: new Set(["fix/landed-last-week"]),
    });
    expect(found).toEqual([]);
  });

  it("carries the commit count through, so a report can be acted on", () => {
    // "17 commits ahead" and "1 commit ahead" warrant different responses; a
    // report that only named branches would make the reader go and look.
    const found = orphanedBranches({
      ahead: [{ ahead: 17, branch: "stack/big" }],
      submitted: new Set<string>(),
    });
    expect(found[0]?.ahead).toBe(17);
    expect(found[0]?.branch).toBe("stack/big");
  });

  it("separates submitted from unsubmitted in a mixed set", () => {
    const found = orphanedBranches({
      ahead: [
        { ahead: 1, branch: "stack/a" },
        { ahead: 2, branch: "stack/b" },
        { ahead: 3, branch: "stack/c" },
      ],
      submitted: new Set(["stack/b"]),
    });
    expect(found.map(row => row.branch)).toEqual(["stack/a", "stack/c"]);
  });

  it("reports nothing when every branch ahead has been submitted", () => {
    const found = orphanedBranches({
      ahead: [
        { ahead: 1, branch: "stack/a" },
        { ahead: 2, branch: "stack/b" },
      ],
      submitted: new Set(["stack/a", "stack/b"]),
    });
    expect(found).toEqual([]);
  });
});

/**
 * The work item decides, and it decides FIRST.
 *
 * Every assertion below was written against the unfixed module and observed to
 * fail there, because a control that passes in both states measures nothing.
 * The unfixed classifier was `ahead.filter(row => !submitted.has(row.branch))`
 * — branch facts and no others — so each `verdict` came back `undefined`.
 *
 * The case is real and was reproduced in this repository before the fix: a
 * branch one commit ahead of `main`, no pull request in any state, and its work
 * item CLOSED because the behaviour shipped from a sibling item. Every
 * filesystem and branch signal says unique unrecoverable work; one tracker read
 * says superseded.
 */
describe("work-item state decides before branch state", () => {
  it("calls a candidate whose work item is CLOSED superseded, not unsubmitted", () => {
    // The measured case. Branch facts alone are indistinguishable from the
    // `unsubmitted` row below — only the item state separates them.
    const found = orphanedBranches({
      ahead: [{ ahead: 1, branch: SUPERSEDED_BRANCH }],
      items: new Map([
        [SUPERSEDED_BRANCH, { ref: "#3604", route: "#3613", state: "CLOSED" }],
      ]),
      submitted: new Set<string>(),
    });
    expect(found.map(row => row.verdict)).toEqual(["superseded"]);
  });

  it("names the route the work actually took, so supersession is checkable", () => {
    // Without the merged pull request named, "superseded" is a classification
    // the reader has to trust. With it, they can go and read the diff.
    const found = orphanedBranches({
      ahead: [{ ahead: 1, branch: SUPERSEDED_BRANCH }],
      items: new Map([
        [SUPERSEDED_BRANCH, { ref: "#3604", route: "#3613", state: "CLOSED" }],
      ]),
      submitted: new Set<string>(),
    });
    expect(found[0]?.route).toBe("#3613");
  });

  it("keeps a candidate whose work item is OPEN as unsubmitted work", () => {
    // The verdict has to discriminate. A classifier that called everything
    // superseded would satisfy the assertion above and be worthless.
    const found = orphanedBranches({
      ahead: [{ ahead: 4, branch: LIVE_BRANCH }],
      items: new Map([[LIVE_BRANCH, { ref: "#3904", state: "OPEN" }]]),
      submitted: new Set<string>(),
    });
    expect(found.map(row => row.verdict)).toEqual(["unsubmitted"]);
  });

  it("refuses to call an unresolvable work item clean", () => {
    // A branch with no `Work-Item:` trailer and no number in its name is the
    // common case, not an exotic one — the measured branch above carried no
    // trailer at all. "Could not look" must never collapse into either verdict.
    const found = orphanedBranches({
      ahead: [{ ahead: 2, branch: "experiment/no-ref-anywhere" }],
      items: new Map(),
      submitted: new Set<string>(),
    });
    expect(found.map(row => row.verdict)).toEqual(["unresolved"]);
  });
});

/**
 * Which side is ahead is a number that was read, never an impression formed
 * from a diff.
 *
 * The branch that motivated this was 1 commit ahead of `main` while `main` was
 * 374 ahead of it. `git diff` between them is symmetric and enormous, so the
 * branch reads as carrying hundreds of stranded commits; taking the branch side
 * of that conflict deletes everything `main` gained.
 */
describe("conflict direction", () => {
  it("marks a candidate whose base leads, so the branch side is refusable", () => {
    const found = orphanedBranches({
      ahead: [{ ahead: 1, branch: SUPERSEDED_BRANCH }],
      divergence: new Map([
        [SUPERSEDED_BRANCH, { baseAhead: 374, branchAhead: 1 }],
      ]),
      items: new Map([[SUPERSEDED_BRANCH, { ref: "#3604", state: "CLOSED" }]]),
      submitted: new Set<string>(),
    });
    expect(found[0]?.baseLeads).toBe(true);
  });

  it("does not mark a candidate whose base has not moved", () => {
    const found = orphanedBranches({
      ahead: [{ ahead: 3, branch: LIVE_BRANCH }],
      divergence: new Map([[LIVE_BRANCH, { baseAhead: 0, branchAhead: 3 }]]),
      items: new Map([[LIVE_BRANCH, { ref: "#3904", state: "OPEN" }]]),
      submitted: new Set<string>(),
    });
    expect(found[0]?.baseLeads).toBe(false);
  });

  it("leaves the direction undetermined when it was not measured", () => {
    // Not false. An unmeasured direction that reported "base does not lead"
    // would be the vacuous pass this whole family exists to refuse.
    const found = orphanedBranches({
      ahead: [{ ahead: 3, branch: LIVE_BRANCH }],
      items: new Map([[LIVE_BRANCH, { ref: "#3904", state: "OPEN" }]]),
      submitted: new Set<string>(),
    });
    expect(found[0]?.baseLeads).toBeUndefined();
  });
});

/**
 * References invented from branch names, which is how a wrong verdict gets
 * stated confidently.
 *
 * Every branch name below is real, taken from this repository's remote, and
 * every one of them produced a confident false verdict on the first run of this
 * check against live data. That run is why these assertions exist: the caveat
 * text ("reference inferred from the branch name") was already printed beside
 * each one and did nothing, because a reader who sees a number, a state and a
 * merged pull request does not go and check.
 */
describe("references lifted from a branch name", () => {
  it("reads the reference out of the conventional shapes", () => {
    expect(refInBranchName("qd/3604-follow-execution-not-args")).toBe("3604");
    expect(refInBranchName("stack/3400")).toBe("3400");
    expect(refInBranchName("wi3791")).toBe("3791");
    expect(refInBranchName("claude/issue-1423-20260704-1813")).toBe("1423");
    expect(refInBranchName("worktree-issues-1055")).toBe("1055");
  });

  it("refuses a date", () => {
    // Read as work item #2026, resolved to a merged pull request, and reported
    // as superseded work. Nothing about that chain was true.
    expect(
      refInBranchName("chore/lisa-update-fixes-2026-04-12")
    ).toBeUndefined();
    expect(refInBranchName("stack/queue-drain-20260904-c")).toBeUndefined();
  });

  it("refuses a hex suffix", () => {
    // `61d007` was read as work item #61.
    expect(refInBranchName("claude/wonderful-vaughan-61d007")).toBeUndefined();
  });

  it("refuses a name with no reference in it at all", () => {
    expect(
      refInBranchName("claude/plugins-functionality-fLPCB")
    ).toBeUndefined();
  });
});

/**
 * `gh issue view <n>` answers for pull requests too, and says MERGED.
 */
describe("a pull request is not a work item", () => {
  /**
   * A command runner that answers as GitHub did for this measured case.
   * @param command Executable.
   * @param args Arguments.
   * @returns Canned stdout.
   */
  function ghAnsweringWithAPullRequest(
    command: string,
    args: readonly string[]
  ): string | undefined {
    if (command === "git") return "";
    if (args[0] === "issue")
      return JSON.stringify({
        number: 2026,
        state: "MERGED",
        url: "https://github.com/owner/repo/pull/2026",
      });
    return "[]";
  }

  it("does not accept a merged pull request as a closed work item", () => {
    // Unfixed, this branch was reported SUPERSEDED on the strength of a pull
    // request that has nothing to do with it. Resolving nothing is the correct
    // answer, and it surfaces as `unresolved`.
    const states = workItemStates(
      ["chore/lisa-update-fixes-2026-04-12"],
      "main",
      "origin",
      ghAnsweringWithAPullRequest
    );
    expect(states.size).toBe(0);
  });

  it("never claims a work item reached the base through itself", () => {
    // The merged-pull-request search matches the reference itself, so the
    // report said "#2026 … reached main through #2026".
    const states = workItemStates(
      ["fix/4242-something"],
      "main",
      "origin",
      (command: string, args: readonly string[]) => {
        if (command === "git") return "";
        if (args[0] === "issue" && args[1] === "view")
          return JSON.stringify({
            number: 4242,
            state: "CLOSED",
            url: "https://github.com/owner/repo/issues/4242",
          });
        if (args[0] === "issue")
          return JSON.stringify({ closedByPullRequestsReferences: [] });
        return JSON.stringify([{ number: 4242 }]);
      }
    );
    expect(states.get("fix/4242-something")?.route).toBeUndefined();
  });
});

/**
 * What the report says, which is the only part an operator ever sees.
 */
describe("the report an operator reads", () => {
  /** Probes standing in for git and gh, so no assertion here shells out. */
  const supersededProbe = {
    collectAhead: () => [{ ahead: 1, branch: SUPERSEDED_BRANCH }],
    collectDivergence: () =>
      new Map([[SUPERSEDED_BRANCH, { baseAhead: 374, branchAhead: 1 }]]),
    collectSubmitted: () => new Set<string>(),
    collectWorkItems: () =>
      new Map([
        [SUPERSEDED_BRANCH, { ref: "#3604", route: "#3613", state: "CLOSED" }],
      ]),
    resolveDefaultBranch: () => "main",
  };

  /**
   * Run `main` with the probes and collect everything it printed.
   * @param probe Probe overrides.
   * @returns The joined stdout the report produced.
   */
  function report(probe: object): string {
    const lines: string[] = [];
    main([], { ...probe, log: (line: string) => lines.push(line) });
    return lines.join("\n");
  }

  it("never tells the operator to open a pull request for superseded work", () => {
    // The commit gate requires a trailer naming a LIVE item, so this advice is
    // not merely wrong — following it ends in a refusal or in retro-fitted
    // attribution, which is a falsified provenance rather than a recovery.
    expect(report(supersededProbe)).not.toMatch(/open a pull request/i);
  });

  it("says superseded, and names the merged route beside it", () => {
    const text = report(supersededProbe);
    expect(text).toMatch(/superseded/i);
    expect(text).toContain("#3613");
  });

  it("states that the work item was resolved before the branch", () => {
    // Acceptance asks the flow to SAY it resolved the item first. A report that
    // did the right thing silently leaves the next reader guessing which signal
    // the ruling came from.
    expect(report(supersededProbe)).toMatch(/work item.*before.*branch/is);
  });

  it("prints the two-sided count when the base leads", () => {
    const text = report(supersededProbe);
    expect(text).toContain("374");
    expect(text).toMatch(/main leads/i);
  });

  it("still tells the operator to submit work whose item is live", () => {
    const text = report({
      ...supersededProbe,
      collectAhead: () => [{ ahead: 4, branch: LIVE_BRANCH }],
      collectDivergence: () =>
        new Map([[LIVE_BRANCH, { baseAhead: 0, branchAhead: 4 }]]),
      collectWorkItems: () =>
        new Map([[LIVE_BRANCH, { ref: "#3904", state: "OPEN" }]]),
    });
    expect(text).toMatch(/open a pull request/i);
  });
});
