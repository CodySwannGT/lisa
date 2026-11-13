/**
 * Prose contract for debrief-apply's knowledge-category reroute (LLG-4, #1733).
 *
 * Before this ticket, `lisa-debrief-apply` routed three accepted knowledge
 * categories to unmanaged prose surfaces: recurring gotchas → machine-local
 * auto-memory `project_*.md`, process friction → `PROJECT_RULES.md`, convention
 * drift → `CLAUDE.md`. None of those are budgeted, validated, expiring, or
 * shared with cloud runs / teammates. This ticket reroutes all three to the
 * committed learnings ledger through the SAME executable contract the learner
 * uses (`@codyswann/lisa/learnings`): consolidation-at-write, resolver-only
 * paths, provenance from the triage row's evidence links, and a human-Accept
 * starting confidence of `high` (an Accept is human corroboration).
 *
 * The category routes that were never knowledge routing stay byte-for-byte:
 * edge case → intent-routing checklist; tooling gap → tracker/upstream split;
 * decomposition infidelity → upstream; PRD defect → PRD comment; missing tool
 * access → tracker ticket.
 *
 * These are agent instructions, so the assertions cover the canonical plugin
 * source AND every checked-in runtime projection produced by
 * `bun run build:plugins`. Per-agent parity: the skill fans out to all five
 * runtimes plus the Codex overlay; the project-learnings reference rule ships to
 * Claude/Codex-base, Cursor (flattened `.mdc`), and Copilot — Antigravity ships
 * no `rules/` tree and the Codex overlay is skills-only, so neither carries the
 * reference projection (matching learner-capture-contract).
 * @module tests/unit/strategies/debrief-reroute-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DEBRIEF_APPLY_SKILL_PATHS = [
  "plugins/src/base/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-agy/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-debrief-apply/SKILL.md",
] as const;

const REFERENCE_RULE_PATHS = [
  "plugins/src/base/rules/reference/project-learnings.md",
  "plugins/lisa/rules/reference/project-learnings.md",
  "plugins/lisa-cursor/rules/project-learnings-reference.mdc",
  "plugins/lisa-copilot/rules/reference/project-learnings.md",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * Return the single Markdown routing-table row whose first cell names the given
 * category. Rows are `| Category | Destination | Action |`. Returns the raw line
 * so per-cell token assertions can scope to exactly that category's route and
 * never collide with the prose sections that legitimately mention retired
 * surfaces (e.g. the "memory is no longer a destination" note).
 * @param skill The full skill Markdown text to search.
 * @param category The routing-table category naming the row's first cell.
 * @returns The raw Markdown line for that category's routing row.
 */
const routingRow = (skill: string, category: string): string => {
  const line = skill
    .split("\n")
    .find(l => l.trimStart().startsWith(`| ${category} `));
  if (line === undefined) {
    throw new Error(`routing row for "${category}" not found`);
  }
  return line;
};

describe.each(DEBRIEF_APPLY_SKILL_PATHS)(
  "debrief-apply reroutes knowledge categories to the ledger (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("persists the three knowledge categories through the executable contract", () => {
      // The reroute writes via the same contract the learner uses — no hand-edits.
      expect(skill).toContain("@codyswann/lisa/learnings");
      expect(skill).toContain("resolveProjectLearningsFile");
      expect(skill).toContain("persistLearningEntry");
      expect(skill).toContain("persistConsolidatedLearning");
      // Consolidation-at-write: scan existing entries before appending.
      expect(skill).toContain("parseLearningsFile");
    });

    it.each(["Recurring gotcha", "Process friction", "Convention drift"])(
      "routes %s to the ledger with no retired destination tokens",
      category => {
        const row = routingRow(skill, category);
        expect(row).not.toMatch(/PROJECT_RULES/);
        expect(row).not.toMatch(/projectRulesFile/);
        expect(row).not.toMatch(/CLAUDE\.md/);
      }
    );

    it("checks idempotency via ledger provenance, not scattered-file greps", () => {
      const idempotency = skill.slice(skill.indexOf("## Idempotency"));
      expect(idempotency).toContain("parseLearningsFile");
    });
  }
);

describe.each(REFERENCE_RULE_PATHS)(
  "project-learnings reference rule promotes debrief-apply to a contract writer (%s)",
  rulePath => {
    const rule = read(rulePath);

    it("lists debrief-apply among the contract-mediated writers", () => {
      expect(rule).toContain("lisa-debrief-apply");
      expect(rule).toContain("persistLearningEntry");
      expect(rule).toContain("persistConsolidatedLearning");
    });
  }
);
