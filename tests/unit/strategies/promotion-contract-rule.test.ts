/**
 * Structural contract for the promotion-to-control rule pair (LLG-7, #1736).
 *
 * The rule's guidance prose is reviewed, not pinned. What stays pinned is
 * structure: the reference body is reachable from the eager rule index, and
 * the delimited AC-template snippet the gardener embeds verbatim into
 * EXECUTABLE-CONTROL promotion tickets is byte-identical between the canonical
 * plugin source and each checked-in runtime projection.
 *
 * Per-agent parity gaps (documented, not silently dropped): the agy variant
 * ships no `rules/` tree (its bounded AGENTS.md bridge covers rules), and
 * Cursor projects rules to flat `<name>.mdc` / `<name>-reference.mdc` files.
 * @module tests/unit/strategies/promotion-contract-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractAcTemplate } from "./promotion-contract-helpers.js";

const RULE_PAIR_ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-copilot",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(RULE_PAIR_ROOTS)("promotion-contract rule pair (%s)", root => {
  const reference = read(
    path.join(root, "rules/reference/promotion-contract.md")
  );

  it("stays reachable from the eager rule index", () => {
    expect(read(path.join(root, "rules/eager/00-rule-index.md"))).toContain(
      "reference/promotion-contract.md"
    );
  });

  it("AC template is identical across the canonical source and this fan-out", () => {
    const canonical = extractAcTemplate(
      read("plugins/src/base/rules/reference/promotion-contract.md")
    );

    expect(extractAcTemplate(reference)).toBe(canonical);
  });
});
