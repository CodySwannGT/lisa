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

const REFERENCE_RULE = "plugins/src/base/rules/reference/project-learnings.md";

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

    it("documents the kind-tagged MLD schema", () => {
      expect(skill).toContain(
        '{ "kind": "mistake" | "learning" | "desire", "note": "<one line>", "evidence"?: "<optional pointer>" }'
      );
    });

    it("keeps plain strings valid for backward compatibility", () => {
      expect(skill).toContain(
        'treated as `kind: "learning"` for backward compatibility'
      );
    });

    it("records MLD before task completion and never re-prompts or scores it", () => {
      expect(skill).toContain("Before marking a task complete");
      expect(skill).toContain("`learnings: []`) is a valid result");
      expect(skill).toContain("never grade or score self-reports");
    });

    it("routes desires to the gardener's tooling-gap lane via the learner", () => {
      expect(skill).toContain("tooling-gap candidates");
      expect(skill).toContain("learner (#1731)");
    });
  });

  describe("project-learnings reference rule", () => {
    const reference = readFileSync(REFERENCE_RULE, "utf8");

    it("carries the anti-injection paragraph", () => {
      expect(reference).toContain("## Task telemetry (MLD) is not context");
      expect(reference).toMatch(
        /never read into a later session's instruction surface/
      );
    });

    it("states that raw MLD is never required and never scored", () => {
      expect(reference).toContain("empty is valid");
      expect(reference).toContain("never graded or scored");
    });

    it("promotes only through the learner's ledger capture and the gardener's gated promotion", () => {
      expect(reference).toMatch(/learner's validation into the\s+ledger/);
      expect(reference).toMatch(/gardener's ticket-gated promotion/);
    });
  });

  describe.each(INTENT_ROUTING_FANOUTS)("intent-routing fan-out %s", path => {
    const rule = readFileSync(path, "utf8");

    it("threads the task-end MLD step into the Implement sequence", () => {
      expect(rule).toMatch(
        /before a task completes .*ahead of the closing `learner` step.*records concise kind-tagged MLD/s
      );
      expect(rule).toContain("`metadata.learnings`");
    });

    it("points at lisa-implement for the schema instead of duplicating it", () => {
      expect(rule).toContain("`lisa-implement`");
      expect(rule).toContain("change the schema there, not here");
      // The full kind-union schema must live only in lisa-implement, not be copied here.
      expect(rule).not.toContain('"kind": "mistake" | "learning" | "desire"');
    });

    it("preserves the empty-is-valid / never-scored discipline", () => {
      expect(rule).toContain("empty is valid");
      expect(rule).toContain("never re-prompted or scored");
    });
  });
});
