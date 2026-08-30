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

import { orphanedBranches } from "../../../all/copy-overwrite/scripts/check-orphaned-branches.mjs";

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
    expect(found[0]).toEqual({ ahead: 17, branch: "stack/big" });
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
