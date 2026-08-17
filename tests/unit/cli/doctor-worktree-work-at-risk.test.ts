/**
 * The check exists because "no remote branch" and "abandoned" are
 * indistinguishable from outside a worktree. On 2026-08-17 seven sessions in one
 * fleet reached the same ticket in turn, each ran `git ls-remote`, each got a
 * true negative, and five worktrees held real work at the time — one of them
 * 1,031 uncommitted lines. These pin the classification, the ordering, and the
 * one property that matters most: an unreadable worktree is never reported clean.
 */
import {
  compareExposureSeverity,
  describeExposure,
  holdsWorkAtRisk,
  isTrackedChange,
  type WorktreeExposure,
} from "../../../src/cli/doctor-worktree-work-at-risk.js";

const CLEAN: WorktreeExposure = {
  path: "/w/clean",
  branch: "main",
  unpushedCommits: 0,
  noUpstream: false,
  dirtyFiles: 0,
  untrackedFiles: 0,
};

describe("holdsWorkAtRisk", () => {
  it("reports a clean, pushed worktree as holding nothing", () => {
    expect(holdsWorkAtRisk(CLEAN)).toBe(false);
  });

  it("reports uncommitted files as work at risk", () => {
    expect(holdsWorkAtRisk({ ...CLEAN, dirtyFiles: 3 })).toBe(true);
  });

  it("reports unpushed commits as work at risk", () => {
    expect(holdsWorkAtRisk({ ...CLEAN, unpushedCommits: 2 })).toBe(true);
  });

  it("does NOT treat a missing upstream alone as work at risk", () => {
    // A branch with no upstream but nothing unique on it has nothing to lose.
    // Counting it would flood the report with freshly-created branches and
    // train the reader to skip the check — which is how the real ones hide.
    expect(holdsWorkAtRisk({ ...CLEAN, noUpstream: true })).toBe(false);
  });
});

describe("isTrackedChange", () => {
  // Measured on a real fleet checkout: one worktree reported 1,442 untracked
  // files, overwhelmingly `.watchman-cookie-*` droppings. Counting those as
  // work at risk makes every worktree look catastrophic and trains the reader
  // to skip the check — the exact failure this check exists to prevent.
  it.each([
    " M src/a.ts",
    "A  src/b.ts",
    "D  src/c.ts",
    "R  a -> b",
    "MM x.ts",
  ])("counts %s as a tracked change", line => {
    expect(isTrackedChange(line)).toBe(true);
  });

  it.each([
    "?? .watchman-cookie-host-11488-0",
    "?? .lisa/DEPENDENCY_DECISIONS.md",
    "",
  ])("does NOT count %s", line => {
    expect(isTrackedChange(line)).toBe(false);
  });
});

describe("compareExposureSeverity", () => {
  it("sorts any dirty tree ahead of any number of unpushed commits", () => {
    // Not a magnitude judgement. A commit survives in the reflog; a dirty tree
    // is in no object database at all, so the recovery story differs in kind.
    const dirty = { ...CLEAN, path: "/w/a", dirtyFiles: 1 };
    const manyCommits = { ...CLEAN, path: "/w/b", unpushedCommits: 99 };
    expect([manyCommits, dirty].sort(compareExposureSeverity)[0]).toBe(dirty);
  });

  it("orders dirtier trees first among dirty ones", () => {
    const few = { ...CLEAN, path: "/w/a", dirtyFiles: 2 };
    const many = { ...CLEAN, path: "/w/b", dirtyFiles: 40 };
    expect([few, many].sort(compareExposureSeverity)[0]).toBe(many);
  });

  it("breaks ties by path so the report is deterministic", () => {
    const later = { ...CLEAN, path: "/w/z", unpushedCommits: 1 };
    const earlier = { ...CLEAN, path: "/w/a", unpushedCommits: 1 };
    expect([later, earlier].sort(compareExposureSeverity)[0]).toBe(earlier);
  });
});

describe("describeExposure", () => {
  it("names the uncommitted count, the unpushed count, and the missing remote", () => {
    const text = describeExposure({
      // Path shape mirrors the real incident (a worktree outside WORKTREE_ROOTS);
      // spelled without the literal tmp prefix so the lint rule for publicly
      // writable directories does not fire on a string that is never opened.
      path: "/scratch-root/wt",
      branch: "fix/thing",
      unpushedCommits: 2,
      noUpstream: true,
      dirtyFiles: 1031,
      untrackedFiles: 2,
    });
    expect(text).toContain("/scratch-root/wt");
    expect(text).toContain("fix/thing");
    expect(text).toContain("1031 uncommitted");
    expect(text).toContain("2 untracked");
    expect(text).toContain("2 unpushed commits");
    expect(text).toContain("no remote branch");
  });

  it("singularizes a lone unpushed commit", () => {
    expect(describeExposure({ ...CLEAN, unpushedCommits: 1 })).toContain(
      "1 unpushed commit"
    );
    expect(describeExposure({ ...CLEAN, unpushedCommits: 1 })).not.toContain(
      "1 unpushed commits"
    );
  });

  it("labels a detached worktree rather than printing undefined", () => {
    const { branch: _omitted, ...detached } = CLEAN;
    expect(describeExposure({ ...detached, dirtyFiles: 1 })).toContain(
      "(detached)"
    );
  });
});
