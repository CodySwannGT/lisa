/**
 * Prose contract for the capture-only learner agent (LLG-2, #1731).
 *
 * The learner is the ledger's missing writer, not a promoter. After
 * implementation it collects task learnings, builds seven-field entries, and
 * persists them through the executable contract (`@codyswann/lisa/learnings`)
 * with provenance — consolidating related entries instead of siblinging them.
 * It takes NO promotion decisions: no skill-evaluator gate, no `/skill-creator`
 * call, no `PROJECT_RULES.md` append, no upstream issue filing. Promotion of any
 * kind is the gardener's ticket-gated job (stream 6). Upstream root causes are
 * MARKED (`scope:upstream-candidate` in provenance) for the gardener to route;
 * desires are routed to a `lisa-tooling-gap` marker in task metadata, never the
 * ledger.
 *
 * These are agent instructions, so the assertions cover the canonical plugin
 * source and every checked-in runtime projection. Per-agent parity gaps
 * (documented, not silently dropped): the learner agent does NOT fan out to the
 * Codex overlay (`plugins/lisa/.codex-plugin` distributes skills only — it has
 * no `agents/` tree), and Copilot renames the agent file to `learner.agent.md`.
 * Antigravity ships no `rules/` tree and the Codex overlay is skills-only, so
 * neither carries the project-learnings reference projection; Cursor flattens
 * the reference rule into a `.mdc`.
 * @module tests/unit/strategies/learner-capture-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const LEARNER_AGENT_PATHS = [
  "plugins/src/base/agents/learner.md",
  "plugins/lisa/agents/learner.md",
  "plugins/lisa-cursor/agents/learner.md",
  "plugins/lisa-agy/agents/learner.md",
  "plugins/lisa-copilot/agents/learner.agent.md",
] as const;

const REFERENCE_RULE_PATHS = [
  "plugins/src/base/rules/reference/project-learnings.md",
  "plugins/lisa/rules/reference/project-learnings.md",
  "plugins/lisa-cursor/rules/project-learnings-reference.mdc",
  "plugins/lisa-copilot/rules/reference/project-learnings.md",
] as const;

const IMPLEMENT_SKILL_PATHS = [
  "plugins/src/base/skills/lisa-implement/SKILL.md",
  "plugins/lisa/skills/lisa-implement/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-implement/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-implement/SKILL.md",
  "plugins/lisa-agy/skills/lisa-implement/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-implement/SKILL.md",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(LEARNER_AGENT_PATHS)(
  "learner capture-only agent (%s)",
  agentPath => {
    const agent = read(agentPath);

    it("declares capture-only semantics and defers promotion to the gardener", () => {
      expect(agent).toMatch(/capture-only/i);
      expect(agent).toContain("gardener");
      // Promotion is human-gated through the tracker, never the learner.
      expect(agent).toMatch(/status:ready/);
    });

    it("writes to the ledger only through the executable contract", () => {
      expect(agent).toContain("@codyswann/lisa/learnings");
      expect(agent).toContain("persistLearningEntry");
      expect(agent).toContain("persistConsolidatedLearning");
      expect(agent).toContain("resolveProjectLearningsFile");
      expect(agent).toContain("PROJECT_LEARNINGS.md");
    });

    it("mandates write-time consolidation over siblinging", () => {
      expect(agent).toMatch(/consolidat/i);
      expect(agent).toContain("supersede");
      expect(agent).toMatch(/sibling/i);
      expect(agent).toMatch(/parseLearningsFile/);
    });

    it("marks upstream candidates in provenance instead of filing", () => {
      expect(agent).toContain("scope:upstream-candidate");
      // The learner explicitly never files an issue anywhere.
      expect(agent).toMatch(/never file|file no issue/i);
    });

    it("routes desires to a tooling-gap marker, never the ledger", () => {
      expect(agent).toMatch(/desire/i);
      expect(agent).toContain("lisa-tooling-gap");
      expect(agent).toContain("tooling_gap_candidates");
    });

    it("builds the seven-field entry with evidence-based confidence", () => {
      expect(agent).toContain("first_learned");
      expect(agent).toContain("last_confirmed");
      expect(agent).toContain("confidence");
      expect(agent).toContain("provenance");
      expect(agent).toContain("LEARNINGS_CONTRACT");
      // Single-occurrence learnings default to low confidence.
      expect(agent).toMatch(/low/);
    });

    it("emits a disposition summary table", () => {
      expect(agent).toMatch(/dropped-duplicate/);
      expect(agent).toMatch(/merged-into/);
      expect(agent).toMatch(/desire-recorded/);
    });

    it("does NOT invoke the promotion machinery removed by LLG-2", () => {
      // skill-evaluator gate, skill-creator, PROJECT_RULES appends, and the
      // upstream filing procedure are all the gardener's job now — absent here.
      expect(agent).not.toMatch(/skill-evaluator/);
      expect(agent).not.toMatch(/skill-creator/);
      expect(agent).not.toMatch(/PROJECT_RULES/);
      expect(agent).not.toMatch(/self-hardening/);
      expect(agent).not.toMatch(/hardening\.upstreamRepo/);
      expect(agent).not.toMatch(/gh issue create/);
    });
  }
);

describe.each(REFERENCE_RULE_PATHS)(
  "project-learnings reference rule enumerates ledger writers (%s)",
  rulePath => {
    it("names the learner (capture), debrief-apply, and claim-time confirm", () => {
      const rule = read(rulePath);

      expect(rule).toContain("Who writes the ledger");
      expect(rule).toMatch(/learner/);
      expect(rule).toMatch(/capture time/);
      expect(rule).toContain("lisa-debrief-apply");
      expect(rule).toContain("confirmLearningEntry");
      // Promotion is the gardener's ticket-gated job, not a writer here.
      expect(rule).toContain("gardener");
      expect(rule).toMatch(/status:ready/);
    });
  }
);

describe.each(IMPLEMENT_SKILL_PATHS)(
  "lisa-implement describes learner capture semantics (%s)",
  skillPath => {
    it("says learnings are captured to the ledger, not reviewed", () => {
      const skill = read(skillPath);

      expect(skill).toContain("captured to the ledger by the learner subagent");
      expect(skill).not.toContain("reviewed by the learner subagent");
    });
  }
);
