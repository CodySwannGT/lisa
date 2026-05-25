import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_PATH = path.resolve(
  ".agents/skills/harness-parity-council/SKILL.md"
);
const skill = readFileSync(SKILL_PATH, "utf8");

describe("harness-parity-council internal skill contract", () => {
  it("stays in the Lisa-only internal skill tree", () => {
    expect(skill).toMatch(/Lisa-only/i);
    expect(skill).toContain(".agents/skills/");
    expect(skill).toMatch(/do not move or mirror it into `plugins\/`/i);
  });

  it("defines the maintainer-facing invocation surface", () => {
    expect(skill).toContain("/harness-parity-council <topic-or-artifact>");
    expect(skill).toContain("--runtime <name>");
    expect(skill).toContain("--second-round");
    expect(skill).toContain("--dry-run");
    expect(skill).toContain("--write-mode <mode>");
  });

  it("documents the supported advisory runtimes and env overrides", () => {
    expect(skill).toContain("LISA_CURSOR_CLI");
    expect(skill).toContain("LISA_CODEX_CLI");
    expect(skill).toContain("LISA_COPILOT_CLI");
    expect(skill).toContain("LISA_ANTIGRAVITY_CLI");
    expect(skill).toContain("first-round.mjs");
  });

  it("locks the default mode to read-only advisory behavior", () => {
    expect(skill).toMatch(/Default to read-only advisory execution/i);
    expect(skill).toMatch(/Do not let external CLIs edit files/i);
    expect(skill).toMatch(/record them as unavailable and continue/i);
  });
});
