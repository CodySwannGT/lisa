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

const RULE_PAIR_ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-copilot",
] as const;

const CURSOR_RULE_PATHS = [
  "plugins/lisa-cursor/rules/promotion-contract.mdc",
  "plugins/lisa-cursor/rules/promotion-contract-reference.mdc",
] as const;

const REWORK_TRIAGE_PATHS = [
  "plugins/src/base/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa-agy/skills/lisa-rework-triage/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-rework-triage/SKILL.md",
] as const;

const PROJECT_RULES_PATHS = [
  ".claude/rules/PROJECT_RULES.md",
  "all/create-only/.claude/rules/PROJECT_RULES.md",
] as const;

const AC_TEMPLATE_START = "<!-- promotion-contract-ac-template:start -->";
const AC_TEMPLATE_END = "<!-- promotion-contract-ac-template:end -->";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * Extracts the delimited AC-template snippet from a promotion-contract rule
 * body so the gardener's verbatim embedding can be asserted byte-for-byte.
 * @param body Full markdown body of a promotion-contract reference rule.
 * @returns The template text between the start/end markers, inclusive.
 */
export function extractAcTemplate(body: string): string {
  const start = body.indexOf(AC_TEMPLATE_START);
  const end = body.indexOf(AC_TEMPLATE_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("promotion-contract AC template markers not found");
  }
  const result = body.slice(start, end + AC_TEMPLATE_END.length);
  return result;
}

describe.each(RULE_PAIR_ROOTS)("promotion-contract rule pair (%s)", root => {
  const eager = read(path.join(root, "rules/eager/promotion-contract.md"));
  const reference = read(
    path.join(root, "rules/reference/promotion-contract.md")
  );

  it("eager head breadcrumbs to the reference body", () => {
    expect(eager).toContain(
      "[reference/promotion-contract.md](../reference/promotion-contract.md)"
    );
  });

  it("eager head states the atomic four-part contract and rejection-by-rule", () => {
    expect(eager).toMatch(/atomic/i);
    expect(eager).toMatch(/enables? the control/i);
    expect(eager).toMatch(/existing violation population/i);
    expect(eager).toMatch(/remediation-teaching diagnostic/i);
    expect(eager).toMatch(/deletes? the superseded prose/i);
    expect(eager).toMatch(/one PR/i);
    expect(eager).toMatch(/rejected by rule/i);
  });

  it("reference enumerates all four legs of the promote-and-delete contract", () => {
    expect(reference).toMatch(/enable the control/i);
    expect(reference).toMatch(/fix the existing violation population/i);
    expect(reference).toMatch(/remediation-teaching diagnostic/i);
    expect(reference).toMatch(/delete the superseded prose/i);
    expect(reference).toMatch(/one atomic PR|all in one PR|one PR/i);
    expect(reference).toMatch(/missing any of the four is rejected by rule/i);
  });

  it("reference explains why each omission fails (double-pay / stranding)", () => {
    expect(reference).toMatch(/double-pays? forever/i);
    expect(reference).toMatch(/strands? agents/i);
  });

  it("reference states the diagnostic-quality bar: invariant + why + concrete fix", () => {
    expect(reference).toMatch(/violated invariant/i);
    expect(reference).toMatch(/why/i);
    expect(reference).toMatch(/concrete fix/i);
    expect(reference).toMatch(/teach(es)? the repair/i);
  });

  it("reference states the demotion-biased eager-tier admission policy", () => {
    expect(reference).toMatch(/demotion-biased/i);
    expect(reference).toMatch(/repeated-miss/i);
    expect(reference).toMatch(/every run/i);
    expect(reference).toMatch(/Lisa'?s own shipped eager rules/i);
  });

  it("reference carries the delimited AC template for EXECUTABLE-CONTROL promotion tickets", () => {
    const template = extractAcTemplate(reference);

    expect(template).toMatch(/Enables the control/);
    expect(template).toMatch(/Fixes the existing violation population/);
    expect(template).toMatch(/Ships a remediation-teaching diagnostic/);
    expect(template).toMatch(/Deletes the superseded prose/);
    expect(template).toMatch(/rejected by rule/);
  });

  it("AC template is identical across the canonical source and this fan-out", () => {
    const canonical = extractAcTemplate(
      read("plugins/src/base/rules/reference/promotion-contract.md")
    );

    expect(extractAcTemplate(reference)).toBe(canonical);
  });
});

describe.each(CURSOR_RULE_PATHS)("cursor rule projection (%s)", rulePath => {
  it("carries the promotion-contract content", () => {
    const body = read(rulePath);

    expect(body).toMatch(/remediation-teaching diagnostic/i);
    expect(body).toMatch(/rejected by rule/i);
  });
});

describe.each(REWORK_TRIAGE_PATHS)(
  "rework-triage upstream lanes (%s)",
  triagePath => {
    const triage = read(triagePath);

    it("documents both upstream lanes with distinct labels", () => {
      expect(triage).toContain("self-hardening");
      expect(triage).toContain("template-candidate");
    });

    it("keeps the dedupe-marker + evidence-chain discipline for the second lane", () => {
      expect(triage).toMatch(/dedupe first/i);
      expect(triage).toMatch(/evidence chain/i);
    });

    it("requires the proposed-template-change section on template-candidate filings", () => {
      expect(triage).toMatch(/proposed template change/i);
    });
  }
);

describe.each(PROJECT_RULES_PATHS)(
  "PROJECT_RULES.md human-authored-only contract (%s)",
  rulesPath => {
    const rules = read(rulesPath);

    it("states the file is human-authored only", () => {
      expect(rules).toMatch(/human-authored only/i);
    });

    it("routes machine-captured knowledge to the ledger and the gardener", () => {
      expect(rules).toMatch(/PROJECT_LEARNINGS\.md/);
      expect(rules).toMatch(/gardener|learnings:audit|learnings-audit/i);
    });

    it("treats existing content as first-run gardener candidates", () => {
      expect(rules).toMatch(/first-run.*candidates|candidates.*first-run/i);
    });
  }
);
