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
 * ## Why these assertions and not others
 *
 * **The rule must name the ACTION, not a judgement.** "Check whether your
 * context looks complete" is unsatisfiable — context completeness is not
 * observable from inside, which is the trap the issue exists to close. So the
 * text is pinned on saying *open the file from disk*.
 *
 * **It must stay a pointer.** A copy of any ruling is stale the moment the next
 * ruling is written, so the size ceiling below is load-bearing: it fails if
 * someone "helpfully" pastes host ruling text into Lisa's guidance.
 *
 * **The delivered/applied distinction is pinned** because it is the ambiguity
 * most likely to get a correct implementation rejected: the rule is DELIVERED at
 * session start (that is how eager rules travel) but the re-read it demands is
 * APPLIED at the escalation boundary. Property 3 of the issue constrains the
 * latter, not the former.
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

/** The canonical heading a host is expected to use. */
const HEADING = "## Standing rulings";

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

  it("ships the pointer in every copy, so no runtime is left behind", () => {
    const missing = copies()
      .filter(([, body]) => !body.includes(HEADING))
      .map(([file]) => file);

    expect(missing).toEqual([]);
  });
});
