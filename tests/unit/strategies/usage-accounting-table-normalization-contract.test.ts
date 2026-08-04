/**
 * Regression tests for the TUN-440 arm of the usage-accounting contract.
 *
 * The rule must ban entry tokens from table rows, cite the Linear measurement
 * that forced it, keep historical row-trailing ledgers readable, and require
 * read-back verification instead of trusting a host mutation's return value.
 * Both the source and generated plugin roots must carry it.
 * @module tests/unit/strategies/usage-accounting-table-normalization-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RULE_ROOTS = [
  "plugins/src/base/rules/reference",
  "plugins/lisa/rules/reference",
] as const;
const RULE_NAME = "usage-accounting.md";

const readRule = (root: string): string =>
  readFileSync(path.resolve(root, RULE_NAME), "utf8");

describe.each(RULE_ROOTS)("%s table-normalization contract", root => {
  const content = readRule(root);

  it("bans entry tokens inside table rows and cites the measurement", () => {
    expect(content).toMatch(
      /\*\*Entry tokens are never rendered inside a table row\.\*\*/
    );
    expect(content).toMatch(/measured against Linear on 2026-08-04/i);
    expect(content).toMatch(
      /correlate to their rows by `entry_id`, not by position/i
    );
  });

  it("keeps historical row-trailing ledgers readable", () => {
    expect(content).toMatch(/parsing is position-agnostic/i);
    expect(content).toMatch(
      /migrate to the own-line layout on their next rewrite/i
    );
  });

  it("requires read-back verification rather than trusting the mutation result", () => {
    expect(content).toMatch(/## Write verification/);
    expect(content).toMatch(/never by the mutation's\s+return value/i);
    expect(content).toMatch(/verifyLisaUsageSectionIntegrity/);
    expect(content).toMatch(/missing-section/);
    expect(content).toMatch(/missing-entry-token/);
    expect(content).toMatch(/missing-rollup-token/);
    expect(content).toMatch(/unrecorded-entry/);
  });

  it("states the rollup/entry agreement invariant in both directions", () => {
    expect(content).toMatch(
      /Every `entry_id` in the rollup's `direct_entry_ids` resolves to a parseable direct entry/i
    );
    expect(content).toMatch(
      /Every parseable direct entry in the section appears in the rollup's `direct_entry_ids`/i
    );
  });
});
