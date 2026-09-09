/**
 * Writing a Linear relation onto an already-linked pair is treated as a
 * possible REPLACE, not an add (CodySwannGT/lisa#3605).
 *
 * ## What was reported
 *
 * `issueRelationCreate` on a pair that already carries a `related` edge appears
 * to CONVERT that edge rather than add a second — the source issue's outgoing
 * count did not grow — and the undo is not what it looks like: deleting the new
 * relation removes the link entirely instead of restoring the original. Full
 * reversal is delete PLUS re-create with the original type.
 *
 * ## What is asserted here, and what is not
 *
 * The vendor semantics are **not** asserted. Confirming them means writing a
 * relation to a live Linear workspace, which was forbidden and not done. These
 * cases pin the GUIDANCE, including its own UNVERIFIED marking — a suite
 * claiming to have proven Linear's behaviour would assert something nobody
 * here observed.
 *
 * What IS established from source, and pinned: `lisa-linear-access` resolves
 * `LINEAR_API_KEY` + raw GraphQL as tier 1, ahead of the MCP. So the ticket's
 * own reason for doubt — "Lisa reaches Linear through the MCP, which may be a
 * different code path" — does not hold for the normal autonomous path.
 *
 * ## Why repair-intake gets the stricter wording
 *
 * It runs unattended on a schedule and `max_candidates` defaults to 100, so a
 * converting write is not one lost edge but potentially a hundred, none of them
 * logged because nothing read the prior state.
 * @module tests/unit/strategies/linear-relation-convert-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/**
 * Read one skill's prose from a source or generated root.
 * @param root - Plugin root
 * @param skill - Skill directory name
 * @returns The skill text
 */
function read(root: string, skill: string): string {
  return readFileSync(path.resolve(root, `skills/${skill}/SKILL.md`), "utf8");
}

describe.each(ROOTS)("%s repair-intake relation write", root => {
  const skill = read(root, "lisa-repair-intake");

  it("reads the pair's relations before writing the blocked-by link", () => {
    expect(skill).toMatch(/READ the pair's existing relations before writing/);
  });

  it("escalates rather than writing over an existing edge", () => {
    // Converting silently is the defect; writing anyway with a warning would
    // still lose the edge.
    expect(skill).toMatch(/do\s+\*\*not\*\* write/);
    expect(skill).toMatch(/naming the existing edge and its\s+type/);
  });

  it("says why this site is worse than the others", () => {
    // Unattended plus a cap of 100 is what turns one lost edge into a hundred.
    expect(skill).toMatch(/unattended on a\s+schedule/);
    expect(skill).toContain("up to a hundred");
  });

  it("keeps the ordinary single-write case cheap", () => {
    // A fresh fix ticket has no prior edge, so the common path must not gain a
    // refusal — otherwise the fix stalls the self-healing loop it protects.
    expect(skill).toMatch(/no prior edge by\s+construction/);
  });

  it("marks the vendor semantics unverified", () => {
    expect(skill).toMatch(/[Mm]arked UNVERIFIED/);
    expect(skill).toMatch(/must not be done to close this/);
  });
});

describe.each(ROOTS)("%s write-issue relation guidance", root => {
  const skill = read(root, "lisa-linear-write-issue");

  it("warns that adding to a linked pair may replace", () => {
    expect(skill).toMatch(/may be a REPLACE, not an add/);
  });

  it("records the true undo", () => {
    // "undo = delete relation X" is a plan that loses the prior relationship.
    expect(skill).toMatch(/delete plus re-create with the original type/i);
    expect(skill).toMatch(/does not restore what was there before/);
  });

  it("says an inherited relation is not a verified one", () => {
    expect(skill).toContain("an inherited relation is not a verified one");
  });

  it("removes the ticket's own reason for doubt", () => {
    // The MCP-may-differ caveat does not cover Lisa's preferred substrate.
    expect(skill).toMatch(/tier 1, ahead of the MCP/);
  });

  it("marks the vendor semantics unverified here too", () => {
    expect(skill).toMatch(/\*\*Marked UNVERIFIED\.\*\*/);
  });
});
