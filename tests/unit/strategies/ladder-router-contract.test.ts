/**
 * Prose contract for the six-rung ladder router (LLG-5, #1734).
 *
 * `skill-evaluator` is no longer a binary skill-worthiness gate deciding among
 * {CREATE SKILL, ADD TO RULES, UPSTREAM, OMIT}. It is the shared classifier of
 * the learnings ladder (PRD #1729): given a candidate learning plus evidence it
 * recommends a destination rung — EXECUTABLE-CONTROL | EAGER-RULE | SKILL |
 * WIKI | KEEP-IN-LEDGER | RETIRE — and a scope (project | upstream), with a
 * three-audience rationale and a drafted artifact per rung. It is advisory-only:
 * it writes nothing and files nothing; action belongs to the gardener's
 * human-gated tickets (#1735).
 *
 * These are agent instructions, so the assertions cover the canonical plugin
 * source and every checked-in runtime projection. Per-agent parity gaps
 * (documented, not silently dropped): the Codex overlay
 * (`plugins/lisa/.codex-plugin`) distributes skills only — it has no `agents/`
 * tree — and Copilot renames agent files to `<name>.agent.md`.
 * @module tests/unit/strategies/ladder-router-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROUTER_AGENT_PATHS = [
  "plugins/src/base/agents/skill-evaluator.md",
  "plugins/lisa/agents/skill-evaluator.md",
  "plugins/lisa-cursor/agents/skill-evaluator.md",
  "plugins/lisa-agy/agents/skill-evaluator.md",
  "plugins/lisa-copilot/agents/skill-evaluator.agent.md",
] as const;

const LEARNING_JUDGE_PATHS = [
  "plugins/src/base/agents/learning-judge.md",
  "plugins/lisa/agents/learning-judge.md",
  "plugins/lisa-cursor/agents/learning-judge.md",
  "plugins/lisa-agy/agents/learning-judge.md",
  "plugins/lisa-copilot/agents/learning-judge.agent.md",
] as const;

const PERSIST_LEARNING_PATHS = [
  "plugins/src/base/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-agy/skills/lisa-persist-learning/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-persist-learning/SKILL.md",
] as const;

const PARITY_SKILL_CREATOR_PATHS = [
  "plugins/src/base/skills/lisa-parity-skill-creator/SKILL.md",
  "plugins/lisa/skills/lisa-parity-skill-creator/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-parity-skill-creator/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-parity-skill-creator/SKILL.md",
  "plugins/lisa-agy/skills/lisa-parity-skill-creator/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-parity-skill-creator/SKILL.md",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(ROUTER_AGENT_PATHS)("ladder router agent (%s)", routerPath => {
  const router = read(routerPath);

  it("declares the six-rung decision vocabulary with the scope axis", () => {
    expect(router).toContain(
      "EXECUTABLE-CONTROL | EAGER-RULE | SKILL | WIKI | KEEP-IN-LEDGER | RETIRE"
    );
    expect(router).toContain("KEEP-IN-LEDGER");
    // Every rung recommendation carries the orthogonal scope axis.
    expect(router).toContain("`project` | `upstream`");
  });

  it("has dropped the pre-ladder decision vocabulary entirely", () => {
    expect(router).not.toContain("CREATE SKILL");
    expect(router).not.toContain("ADD TO RULES");
    // OMIT is gone as a concept, not just as a phrase — redundant prose is
    // RETIREd citing its mechanical owner instead of silently omitted.
    expect(router).not.toMatch(/\bOMIT\b/);
  });

  it("keeps the five worthiness criteria as inputs, not the verdict", () => {
    expect(router).toMatch(/breadth/i);
    expect(router).toMatch(/reusability/i);
    expect(router).toMatch(/complexity/i);
    expect(router).toMatch(/stability/i);
    expect(router).toMatch(/non-redundancy/i);
    expect(router).toMatch(/inputs/i);
  });

  it("routes mechanically decidable invariants to EXECUTABLE-CONTROL with a drafted diagnostic", () => {
    expect(router).toMatch(/mechanically decidable/i);
    expect(router).toContain("remediation-teaching diagnostic");
    // The context is relocated into the error message, not deleted.
    expect(router).toMatch(/relocated into the error message/);
  });

  it("is demotion-biased for the eager tier", () => {
    expect(router).toContain("demotion-biased");
    expect(router).toMatch(/repeated misses/);
    // Eager placement must be earned; the default answer is no.
    expect(router).toMatch(/default answer is no/i);
  });

  it("runs the redundancy check first, across mechanical owners, wiki index, and ledger", () => {
    expect(router).toMatch(/redundancy check \(do first\)/i);
    expect(router).toContain("mechanical owner");
    expect(router).toMatch(/wiki index/i);
    expect(router).toMatch(/ledger/i);
    // Prose duplicating a mechanical owner routes to RETIRE, citing the owner.
    expect(router).toMatch(
      /RETIRE[^\n]*mechanical owner|mechanical owner[^\n]*RETIRE/
    );
  });

  it("documents the candidate input and recommendation output contract", () => {
    expect(router).toContain("`rule`");
    expect(router).toContain("`why`");
    expect(router).toContain("`provenance`");
    expect(router).toContain("`evidence`");
    expect(router).toContain("`rung`");
    expect(router).toContain("`scope`");
    expect(router).toContain("`rationale`");
    expect(router).toContain("`drafted_artifact`");
    expect(router).toMatch(/three-audience/);
  });

  it("defines the drafted artifact per rung", () => {
    expect(router).toContain("lint/hook sketch");
    expect(router).toContain("diagnostic text");
    expect(router).toContain("failure evidence");
    expect(router).toContain("skill outline");
    expect(router).toContain("page outline");
    expect(router).toContain("index placement");
    expect(router).toContain("redundancy/staleness proof");
  });

  it("is advisory-only and names the gardener as the primary caller", () => {
    expect(router).toMatch(/advisory-only/i);
    expect(router).toMatch(/writes nothing/i);
    expect(router).toMatch(/files nothing/i);
    expect(router).toContain("gardener");
    expect(router).toContain("#1735");
    // The learner no longer calls it (LLG-2, #1731).
    expect(router).not.toMatch(
      /\blearner\b[^\n]*invokes|invoked by the learner/i
    );
  });

  it("instructs dynamic discovery instead of the stale hardcoded skills list", () => {
    expect(router).toContain(".claude/skills/");
    expect(router).toMatch(/rules tree/i);
    expect(router).toMatch(/lint config/i);
    // The 2024-era hardcoded project skill list is gone.
    expect(router).not.toContain("Existing Skills Reference");
    expect(router).not.toContain("gluestack-nativewind");
    expect(router).not.toContain("expo-router-best-practices");
    expect(router).not.toContain("container-view-pattern");
  });
});

describe.each(LEARNING_JUDGE_PATHS)(
  "learning-judge references the router accurately (%s)",
  judgePath => {
    const judge = read(judgePath);

    it("no longer claims the learner invokes skill-evaluator (stale post-#1731 analogy)", () => {
      expect(judge).not.toMatch(
        /contract `learner` holds with `skill-evaluator`/
      );
      expect(judge).not.toMatch(/`learner` uses for `skill-evaluator`/);
    });

    it("describes the router as recommending promotion destinations for the gardener", () => {
      expect(judge).toContain("ladder router");
      expect(judge).toMatch(/destination/i);
      expect(judge).toContain("gardener");
    });
  }
);

describe.each(PERSIST_LEARNING_PATHS)(
  "lisa-persist-learning references the router accurately (%s)",
  persistPath => {
    const persist = read(persistPath);

    it("no longer cites the removed learner→skill-evaluator invoke pattern", () => {
      expect(persist).not.toMatch(/`learner` uses for `skill-evaluator`/);
      expect(persist).not.toMatch(
        /contract `learner` holds with `skill-evaluator`/
      );
    });
  }
);

describe.each(PARITY_SKILL_CREATOR_PATHS)(
  "lisa-parity-skill-creator reflects the router's new contract (%s)",
  creatorPath => {
    it("frames skill-evaluator as the ladder router, SKILL being one rung", () => {
      const creator = read(creatorPath);

      expect(creator).toContain("ladder router");
      expect(creator).toMatch(/rung/);
    });
  }
);
