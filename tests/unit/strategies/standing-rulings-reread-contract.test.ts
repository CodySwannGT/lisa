/**
 * Contract coverage for the standing-rulings re-read pointer (issue #3592).
 *
 * ## The defect
 *
 * A host records durable owner decisions under `## Standing rulings` in its
 * instruction file. Sessions receive that file as injected context at start, so
 * a ruling written *after* a session begins is not in that session's copy — and
 * the injected copy can also be delivered SHORT, cut at a clean section
 * boundary. A cut mid-sentence announces itself; a cut at a section break is
 * indistinguishable from a document that never had the section. Six lanes
 * re-opened one settled decision in a single night, one of them twenty minutes
 * after the ruling was written.
 *
 * ## What stays pinned
 *
 * The rule must stay a pointer. A copy of any ruling is stale the moment the
 * next ruling is written, so the size ceiling below is load-bearing: it fails
 * if someone "helpfully" pastes host ruling text into Lisa's guidance. The
 * rule's wording is guidance prose and is not pinned (#4867).
 * @module tests/unit/strategies/standing-rulings-reread-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every root shipping the rule. Since the 2026-11 eager-tier cut the pointer
 * lives in the `when-to-stop` reference body (the eager head carries the
 * one-line "re-read `AGENTS.md` from disk" instruction), which absorbed the
 * former `settled-decisions` head.
 */
const MARKDOWN_ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-copilot",
] as const;

/** Cursor ships the same rule as a front-mattered `.mdc` at a flat path. */
const CURSOR_RULE = "plugins/lisa-cursor/rules/when-to-stop-reference.mdc";

/**
 * Read one shipped copy of the rule.
 * @param relative Project-relative path.
 * @returns File contents.
 */
const read = (relative: string): string =>
  readFileSync(path.resolve(relative), "utf8");

/**
 * Every shipped copy, by the path it ships at.
 * @returns Path/body pairs for each runtime's copy of the rule.
 */
const copies = (): readonly (readonly [string, string])[] => [
  ...MARKDOWN_ROOTS.map(
    root =>
      [
        `${root}/rules/reference/when-to-stop.md`,
        read(`${root}/rules/reference/when-to-stop.md`),
      ] as const
  ),
  [CURSOR_RULE, read(CURSOR_RULE)] as const,
];

describe("standing-rulings re-read pointer (#3592)", () => {
  describe.each(copies())("%s", (_path, body) => {
    it("carries no host ruling text — the size ceiling is the guard", () => {
      // A pointer stays roughly this size as rulings accumulate; a copy grows.
      // This fails loudly if someone pastes a host's rulings into guidance.
      expect(body.length).toBeLessThan(7000);
    });
  });
});
