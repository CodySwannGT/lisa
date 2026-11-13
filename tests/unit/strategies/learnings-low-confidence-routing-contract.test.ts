/**
 * `learnings.lowConfidence` changes what happens to a low-confidence learning
 * PR, so the skill that submits it, the judge that grades it, and the gardener
 * that re-reviews it must say the same thing on every agent surface
 * (CodySwannGT/lisa#4659). The default must stay the human-triage gate.
 * @module tests/unit/strategies/learnings-low-confidence-routing-contract
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PERSIST_LEARNING = "lisa-persist-learning";
const SKILL_SURFACES = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

/**
 * Read one generated or source skill body.
 * @param surface - Plugin skill root
 * @param skill - Skill directory name
 * @returns SKILL.md contents
 */
function skillBody(surface: string, skill: string): string {
  return readFileSync(path.join(ROOT, surface, skill, "SKILL.md"), "utf8");
}

/**
 * Isolate the Phase 3 confidence-routing step of lisa-persist-learning.
 * @param body - Full skill body
 * @returns The step-6 text up to the Rules section
 */
function routingStep(body: string): string {
  const start = body.indexOf("6. **Confidence routing.**");
  const end = body.indexOf("## Rules", start);
  expect(start).toBeGreaterThan(-1);
  return body.slice(start, end);
}

describe("learnings.lowConfidence routing contract", () => {
  it.each(SKILL_SURFACES)(
    "persist-learning in %s resolves the setting through the executable contract",
    surface => {
      const step = routingStep(skillBody(surface, PERSIST_LEARNING));
      expect(step).toContain("resolveLearningsSettings(c).lowConfidence");
      expect(step).not.toMatch(/cat \.lisa\.config\.json|jq .*lowConfidence/u);
    }
  );

  it.each(SKILL_SURFACES)(
    "persist-learning in %s defaults to auto-merge under access-only and human-triage under strict",
    surface => {
      const step = routingStep(skillBody(surface, PERSIST_LEARNING));
      // #4687: the absent-key default follows humanGate.mode; an explicit key wins.
      expect(step).toMatch(
        /prints `auto-merge` under the default `"access-only"` mode and `human-triage` under `"strict"`/u
      );
      expect(step).toContain(
        "A value the project sets explicitly always wins over the mode."
      );
      const marker =
        '**`low` + `human-triage`** (the default under `humanGate.mode: "strict"`, or set explicitly)';
      expect(step).toContain(marker);
      const triage = step.slice(step.indexOf(marker));
      expect(triage).toContain("`auto_merge=false`");
      expect(triage).toContain(
        'gh pr edit <pr> --add-label "learning:needs-triage"'
      );
    }
  );

  it.each(SKILL_SURFACES)(
    "persist-learning in %s submits auto-merge lows with defaults and a findable label",
    surface => {
      const step = routingStep(skillBody(surface, PERSIST_LEARNING));
      const auto = step.slice(
        step.indexOf("**`low` + `auto-merge`**"),
        step.indexOf("**`low` + `human-triage`**")
      );
      expect(auto).toContain("with its defaults, exactly like `high`");
      expect(auto).toContain(
        'This is the default under `humanGate.mode: "access-only"`'
      );
      expect(auto).not.toContain("auto_merge=false");
      expect(auto).toContain(
        'gh pr edit <pr> --add-label "learning:low-confidence"'
      );
      expect(auto).not.toContain('--add-label "learning:needs-triage"');
    }
  );

  it.each(SKILL_SURFACES)(
    "the gardener in %s re-reviews auto-merged low-confidence entries first",
    surface => {
      const body = skillBody(surface, "lisa-learnings-audit");
      expect(body).toContain(
        "**Auto-merged low-confidence entries are re-reviewed first.**"
      );
      expect(body).toContain('confidence: "low"');
      expect(body).toContain("low-confidence re-reviewed: <ids>");
    }
  );

  it("the judge grades confidence independently of the routing setting", () => {
    const judge = readFileSync(
      path.join(ROOT, "plugins/src/base/agents/learning-judge.md"),
      "utf8"
    );
    const step4 = judge.slice(
      judge.indexOf("### Step 4: Confidence"),
      judge.indexOf("### ", judge.indexOf("### Step 4: Confidence") + 5)
    );
    expect(step4).toContain('learnings.lowConfidence: "auto-merge"');
    expect(step4).toContain("Grade confidence on the evidence alone.");
  });
});
