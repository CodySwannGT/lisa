/**
 * Prose contract for the promotion-to-control rule pair (LLG-7, #1736).
 *
 * When a gardener promotion ticket is implemented, the change must be atomic:
 * enable the control + fix the existing violation population + ship a
 * remediation-teaching diagnostic + delete the superseded prose — one PR, and
 * a PR missing any of the four is rejected by rule, not by reviewer taste.
 * The rule pair also carries the diagnostic-quality bar, the demotion-biased
 * eager-tier admission policy (the gardener audits the eager tier every run,
 * including Lisa's own shipped eager rules), and the documented AC-template
 * snippet the gardener embeds verbatim into EXECUTABLE-CONTROL promotion
 * tickets.
 *
 * These are agent instructions, so the assertions cover the canonical plugin
 * source and the checked-in runtime projections. Per-agent parity gaps
 * (documented, not silently dropped): the agy variant ships no `rules/` tree
 * (its bounded AGENTS.md bridge covers rules), and Cursor projects rules to
 * flat `<name>.mdc` / `<name>-reference.mdc` files.
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

const REWORK_TRIAGE_PATHS = [
  "plugins/src/base/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa-agy/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-rework-triage/SKILL.md",
] as const;

/**
 * Host-rules surfaces keep machine-captured knowledge in the learning flow.
 * Operator-directed edits are separate from automated learning promotion.
 */
const PROJECT_RULES_PATHS = [
  ".claude/rules/PROJECT_RULES.md",
  "all/create-only/.agents/rules/README.md",
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

describe.each(REWORK_TRIAGE_PATHS)(
  "rework-triage upstream lanes (%s)",
  triagePath => {
    const triage = read(triagePath);

    it("documents both upstream lanes with distinct labels", () => {
      expect(triage).toContain("self-hardening");
    });
  }
);

describe.each(PROJECT_RULES_PATHS)(
  "host-rules learning boundary (%s)",
  rulesPath => {
    const rules = read(rulesPath);

    it("routes machine-captured knowledge to the ledger and the gardener", () => {
      expect(rules).toMatch(/PROJECT_LEARNINGS\.md/);
      expect(rules).toMatch(/gardener|learnings:audit|learnings-audit/i);
    });
  }
);
