/**
 * `lisa-implement` must review the branch before it opens a pull request.
 *
 * The flow used to run commit → push → open PR → watch loop, with the only
 * review being *reactive*: the watch loop handles review comments that arrive.
 * When no reviewer arrives, nothing was reviewed and nothing said so.
 *
 * That is the normal case rather than an edge one. Measured on this repository,
 * **47 of the last 60 merged pull requests** carried a review context reporting
 * `SUCCESS` while having read nothing — 29 rate limited, 16 skipped because the
 * vendor does not auto-review public repositories, one skipped on size. The
 * capability to review locally already existed (`lisa-review-local`) and the
 * contract for handling findings already existed (`convergent-review`); nothing
 * connected them.
 *
 * These assertions pin the properties that make the step worth having, not its
 * prose. A step that merely mentions reviewing would satisfy a keyword check
 * and still be wrong in each of the ways below — which is why each is asserted
 * separately, by name.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Canonical source plus every checked-in per-agent projection. */
const SKILLS = [
  "plugins/src/base/skills/lisa-implement/SKILL.md",
  "plugins/lisa/skills/lisa-implement/SKILL.md",
  "plugins/lisa-agy/skills/lisa-implement/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-implement/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-implement/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-implement/SKILL.md",
];

/**
 * One skill file's text.
 * @param relative - Repo-relative path.
 * @returns File contents.
 */
function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe.each(SKILLS)("%s pre-PR local review", relative => {
  const text = read(relative);

  it("reviews locally before the pull-request step, not after it", () => {
    const review = text.indexOf("lisa-review-local");
    const openPr = text.indexOf("Open a pull request with auto-merge on");
    expect(review).toBeGreaterThan(-1);
    expect(openPr).toBeGreaterThan(-1);
    // Ordering is the whole point: auto-merge is armed at submit time, so a
    // review placed after the PR step races a latch that is already set.
    expect(review).toBeLessThan(openPr);
  });

  it("is unconditional rather than a fallback for an absent reviewer", () => {
    // A rule that fires only when the vendor is missing must detect four
    // distinct vacuity strings forever, and still leaves "present but wrong"
    // unguarded.
    expect(text).toContain("Unconditional, not a fallback");
    expect(text).toMatch(/Do not gate this on whether a third-party reviewer/);
  });

  it("keeps the third-party review additive rather than replaced", () => {
    // The local review must not be described as standing in for the vendor's;
    // its findings still arrive at the watch loop and are handled there.
    expect(text).toMatch(/additive/);
  });

  it("records the outcome as self-reviewed, never as reviewed", () => {
    // The agents reviewing the branch are the ones that wrote it. Reporting
    // that as `reviewed` would be the vacuous claim this step exists to remove,
    // one level up.
    expect(text).toMatch(/self-reviewed/i);
    expect(text).toMatch(/never as \*reviewed\*/);
  });

  it("denies that a local review satisfies the required check", () => {
    // The third-party context is ruleset-required and only that vendor's app
    // can post to it. A step implying otherwise would turn a report into a
    // false claim about branch protection.
    expect(text).toMatch(/ruleset-required/);
  });

  it("treats an unavailable review as unavailable, not as a pass", () => {
    // The failure mode this whole subsystem refuses: "could not run" reported
    // as "ran and found nothing".
    expect(text).toMatch(
      /must never be reported as "reviewed and found nothing"/
    );
  });
});
