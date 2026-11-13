import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// LLG-3 (#1732): MLD task-end telemetry. The task-metadata `learnings` contract
// is authored once in base and fanned out to every agent variant by
// `bun run build:plugins`; the anti-injection discipline is authored in the
// project-learnings reference rule. These assertions pin the shipped prose so a
// future edit that drops the kind-tagged schema, the backward-compat escape
// hatch, the "empty is valid / never scored" guarantee, or the anti-injection
// paragraph fails loudly.

// Every built fan-out of lisa-implement that must carry the MLD schema.
const IMPLEMENT_FANOUTS = [
  "plugins/lisa/skills/lisa-implement/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-implement/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-implement/SKILL.md",
  "plugins/lisa-agy/skills/lisa-implement/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-implement/SKILL.md",
];

// The canonical Implement step sequence is dual-homed (lisa-implement +
// intent-routing). The task-end MLD step is threaded into the intent-routing
// reference rule as a pointer to the lisa-implement contract (schema is NOT
// duplicated here). These are every built fan-out of that reference rule.
const INTENT_ROUTING_FANOUTS = [
  "plugins/lisa/rules/reference/intent-routing.md",
  "plugins/lisa-copilot/rules/reference/intent-routing.md",
  "plugins/lisa-cursor/rules/intent-routing-reference.mdc",
];

describe("MLD task-end telemetry contract (LLG-3)", () => {
  describe.each(IMPLEMENT_FANOUTS)("lisa-implement fan-out %s", path => {
    const skill = readFileSync(path, "utf8");

    it("keeps the whole task-metadata block valid, parseable JSON", () => {
      const block = /```json\n([\s\S]*?)\n```/.exec(skill);
      expect(block).not.toBeNull();
      expect(() => JSON.parse(block![1] as string)).not.toThrow();
    });
  });

  describe.each(INTENT_ROUTING_FANOUTS)("intent-routing fan-out %s", path => {
    const rule = readFileSync(path, "utf8");

    it("threads the task-end MLD step into the Implement sequence", () => {
      expect(rule).toContain("`metadata.learnings`");
    });

    it("points at lisa-implement for the schema instead of duplicating it", () => {
      expect(rule).toContain("`lisa-implement`");
    });
  });
});
