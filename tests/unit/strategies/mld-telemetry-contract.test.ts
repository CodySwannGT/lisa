import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// LLG-3 (#1732): MLD task-end telemetry. The task-metadata block that carries
// the kind-tagged `learnings` schema is authored once in base and fanned out to
// every agent variant by `bun run build:plugins`. Agents copy that block
// verbatim, so it must stay valid JSON in every shipped copy. Prose around it
// is guidance and is reviewed, not pinned (#4867).

// Every built fan-out of lisa-implement that must carry the MLD schema.
const IMPLEMENT_FANOUTS = [
  "plugins/lisa/skills/lisa-implement/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-implement/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-implement/SKILL.md",
  "plugins/lisa-agy/skills/lisa-implement/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-implement/SKILL.md",
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
});
