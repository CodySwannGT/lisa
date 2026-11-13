/**
 * Regression tests for CodySwannGT/lisa#4608: `lisa-drive-pr-to-merge` must
 * name ONE way to wait on CI, and that way must be bounded and in the
 * foreground.
 *
 * Before this change the watch loop polled the PR state but never said how to
 * wait between polls. Agents filled the gap themselves — a backgrounded
 * `gh pr checks --watch`, a sleep loop, a harness background task — and those
 * stall silently, die with the session, or let the session end while required
 * checks are still pending, so a later CI failure reaches nobody.
 *
 * The skill's guidance prose is not pinned (#4867). What stays is the one
 * machine-read token in the watch loop: `[lisa-ci-failed]`, the marker the
 * CI-failure re-dispatch scripts parse, which is how a later CI failure on a
 * pending PR reaches anyone.
 *
 * The section heading is matched with a leading newline because several
 * section headings are also quoted inline elsewhere; an unanchored search can
 * slice the wrong range and pass on an empty string. Every generated plugin
 * root is asserted so a missed `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/drive-pr-bounded-ci-watch
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const readSkill = (root: string): string =>
  readFileSync(
    path.resolve(root, "lisa-drive-pr-to-merge", "SKILL.md"),
    "utf8"
  );

/**
 * Slice a document between two line-anchored headings.
 * @param content - Whole skill text
 * @param from - Heading that opens the range, including its leading newline
 * @param to - Heading that closes the range, or undefined for end of document
 * @returns The text from `from` up to (not including) `to`
 */
const slice = (content: string, from: string, to?: string): string => {
  const start = content.indexOf(from);
  const end = to === undefined ? content.length : content.indexOf(to, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return content.slice(start, end);
};

describe.each(ROOTS)("drive-pr-to-merge bounded CI watch (%s)", root => {
  const content = readSkill(root);
  const watchLoop = (): string =>
    slice(content, "\n## 2. The watch loop", "\n## 3. Merge and verify");

  it("names the [lisa-ci-failed] re-dispatch marker in the watch loop", () => {
    // The wake-up for a later failure is E1's re-dispatch, named not rebuilt.
    expect(watchLoop()).toContain("[lisa-ci-failed]");
  });
});
