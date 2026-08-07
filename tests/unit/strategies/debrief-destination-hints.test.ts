/**
 * Prose contract for the destination hints a Debrief triage row shows a human.
 *
 * `debrief-reroute-contract` pins where `lisa-debrief-apply` actually WRITES
 * accepted knowledge categories (the committed learnings ledger, via the
 * executable contract). Nothing pinned what the triage document TELLS the human
 * those rows will do, so `learnings-synthesizer`'s "Recommended destination"
 * column and the debrief skill's example destinations kept recommending the
 * retired surfaces — machine-local auto-memory, `PROJECT_RULES.md`, and
 * `CLAUDE.md` — long after `apply` stopped writing to any of them. `apply`
 * routes on the category, never on the hint, so the files stayed correct while
 * the human triaged Accept/Reject against a description of the previous system.
 *
 * These assertions close that gap: the hint a human reads must name the same
 * destination the router will use. `AGENTS.md` is the human-authored source of
 * truth (`CLAUDE.md` is only a one-line `@AGENTS.md` pointer), so neither
 * filename may be offered as a place a learning lands.
 *
 * These are agent instructions, so the assertions cover the canonical plugin
 * source AND every checked-in runtime projection produced by
 * `bun run build:plugins` — Antigravity ships no `rules/` tree and the Codex
 * overlay is skills-only, matching debrief-reroute-contract's parity note.
 * @module tests/unit/strategies/debrief-destination-hints
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SYNTHESIZER_PATHS = [
  "plugins/src/base/agents/learnings-synthesizer.md",
  "plugins/lisa/agents/learnings-synthesizer.md",
  "plugins/lisa-cursor/agents/learnings-synthesizer.md",
  "plugins/lisa-agy/agents/learnings-synthesizer.md",
  "plugins/lisa-copilot/agents/learnings-synthesizer.agent.md",
] as const;

const DEBRIEF_SKILL_PATHS = [
  "plugins/src/base/skills/lisa-debrief/SKILL.md",
  "plugins/lisa/skills/lisa-debrief/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-debrief/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-debrief/SKILL.md",
  "plugins/lisa-agy/skills/lisa-debrief/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-debrief/SKILL.md",
] as const;

/** `lisa-debrief-apply` and its runtime projections (see debrief-reroute-contract). */
const APPLY_SKILL_PATHS = [
  "plugins/src/base/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-agy/skills/lisa-debrief-apply/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-debrief-apply/SKILL.md",
] as const;

/** The three categories `lisa-debrief-apply` persists to the ledger. */
const KNOWLEDGE_CATEGORIES = [
  "Recurring gotcha",
  "Process friction",
  "Convention drift",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * Return the categorization-table row whose first cell names the given
 * category. Rows are `| **Category** | meaning | destination hint |`. Returns
 * the raw line so assertions scope to exactly that row and never collide with
 * the prose that legitimately names retired surfaces (the "never a
 * destination" note) or with the output-template headings further down.
 * @param agent The full agent Markdown text to search.
 * @param category The category naming the row's first cell.
 * @returns The raw Markdown line for that category's row.
 */
const categoryRow = (agent: string, category: string): string => {
  const line = agent
    .split("\n")
    .find(l => l.trimStart().startsWith(`| **${category}**`));
  if (line === undefined) {
    throw new Error(`category row for "${category}" not found`);
  }
  return line;
};

describe.each(SYNTHESIZER_PATHS)(
  "synthesizer destination hints match where apply writes (%s)",
  agentPath => {
    const agent = read(agentPath);

    it.each(KNOWLEDGE_CATEGORIES)(
      "points %s at the ledger, not a retired surface",
      category => {
        const row = categoryRow(agent, category);
        expect(row).toMatch(/ledger/i);
        expect(row).not.toMatch(/project_\*\.md/);
        expect(row).not.toMatch(/PROJECT_RULES/);
        expect(row).not.toMatch(/CLAUDE\.md/);
        expect(row).not.toMatch(/AGENTS\.md/);
        expect(row).not.toMatch(/\bMemory file\b/i);
      }
    );

    it("keeps the non-knowledge hints unchanged", () => {
      expect(categoryRow(agent, "Edge case")).toMatch(
        /intent-routing|checklist/i
      );
      expect(categoryRow(agent, "Tooling gap")).toMatch(/ticket/i);
      expect(categoryRow(agent, "Decomposition infidelity")).toMatch(
        /upstream/i
      );
      expect(categoryRow(agent, "PRD defect")).toMatch(/PRD/);
      expect(categoryRow(agent, "Missing tool access")).toMatch(/ticket/i);
    });

    it("states the hint is advisory and apply routes on the category", () => {
      expect(agent).toMatch(/hint/i);
      expect(agent).toContain("lisa-debrief-apply");
      expect(agent).toMatch(/never.*(on this column|on the hint)/i);
    });

    it("names the retired surfaces as never-destinations", () => {
      const note = agent.slice(agent.indexOf("The destination column"));
      expect(note).toMatch(/PROJECT_RULES\.md/);
      expect(note).toMatch(/AGENTS\.md/);
      expect(note).toMatch(/never/i);
      // AGENTS.md is the source of truth; CLAUDE.md only points at it.
      expect(note).toContain("@AGENTS.md");
    });

    it("does not pin an ordinal to the ad-hoc overflow category", () => {
      // The table has grown from five categories to eight; a hardcoded
      // ordinal ("a sixth ad-hoc category") silently goes stale on the next
      // addition, so the overflow bucket is described without one.
      expect(agent).toContain("Uncategorized");
      expect(agent).not.toMatch(/\bsixth ad-hoc\b/i);
    });
  }
);

/**
 * Every category `learnings-synthesizer` can emit. A category that exists in
 * its table but nowhere downstream produces a row a human can Accept and
 * `apply` cannot route — which is exactly how the five-of-eight drift below
 * survived: the table grew, the output template and the apply routes did not.
 */
const ALL_CATEGORIES = [
  "Edge case",
  "Recurring gotcha",
  "Process friction",
  "Tooling gap",
  "Convention drift",
  "Decomposition infidelity",
  "PRD defect",
  "Missing tool access",
] as const;

describe.each(SYNTHESIZER_PATHS)(
  "the output template can represent every category (%s)",
  agentPath => {
    const agent = read(agentPath);
    const template = agent.slice(agent.indexOf("## Candidate learnings"));

    it.each(ALL_CATEGORIES)("has a section for %s", category => {
      // Singular/plural both appear as headings ("Edge cases", "PRD defects").
      const stem = category.replace(/y$/, "");
      expect(template.toLowerCase()).toContain(stem.toLowerCase());
    });

    it("keeps the overflow bucket alongside the eight", () => {
      expect(template).toContain("Uncategorized");
    });
  }
);

describe.each(APPLY_SKILL_PATHS)(
  "apply routes or explicitly refuses every emitted category (%s)",
  applyPath => {
    const apply = read(applyPath);

    it.each(ALL_CATEGORIES)("has a routing row for %s", category => {
      expect(apply).toContain(`| ${category} |`);
    });

    it("handles Uncategorized deterministically rather than dropping it", () => {
      // Not a destination — but a silent skip would lose an accepted row.
      const row = apply
        .split("\n")
        .find(l => l.trimStart().startsWith("| Uncategorized "));
      expect(row).toBeDefined();
      expect(row).toMatch(/reclassif/i);
      expect(row).toMatch(/(do not|don't|never).{0,40}(silently )?skip/i);
    });
  }
);

describe.each(DEBRIEF_SKILL_PATHS)(
  "debrief skill's example destinations stay current (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("lists every category the synthesizer can emit", () => {
      for (const category of ALL_CATEGORIES) {
        expect(skill).toContain(category);
      }
    });

    it("offers the ledger and forbids the retired surfaces by name", () => {
      const bullet = skill
        .split("\n")
        .find(l => l.includes("Recommended persistence destination"));
      expect(bullet).toBeDefined();
      expect(bullet).toMatch(/ledger/i);
      expect(bullet).toMatch(/[Nn]ever name/);
      expect(bullet).toMatch(/PROJECT_RULES\.md/);
      expect(bullet).toMatch(/AGENTS\.md/);
      // The pre-ledger examples must not survive as suggestions.
      expect(bullet).not.toMatch(/"PROJECT_RULES\.md"/);
      expect(bullet).not.toMatch(/memory: project_\*\.md/);
    });
  }
);
