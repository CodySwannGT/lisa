/** Codex-only command skill generation stays equivalent to the runtime transform. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  componentPointers,
  compactSkillFrontmatterDescription,
  convertCommandToCodexSkill,
  emitCodexSkillVariants,
  emitCommandSkills,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";
import { convertCommandToSkill } from "../../../src/codex/command-skill-transformer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const COMMAND = `---
description: Check Lisa status
argument-hint: "[--json]"
allowed-tools: Read, Bash
---

Run the status workflow for $ARGUMENTS
`;
const STATUS_SKILL = "lisa-status";
const CODEX_PLUGIN = ".codex-plugin";
const SKILLS = "skills";
const LONG_SKILL = "long-skill";

describe("Codex command plugin artifacts", () => {
  let pluginDir: string;

  beforeEach(async () => {
    pluginDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(pluginDir));

  it("generates command-only skills inside .codex-plugin", async () => {
    await fs.outputFile(path.join(pluginDir, "commands", "status.md"), COMMAND);
    expect(emitCommandSkills(pluginDir)).toEqual([STATUS_SKILL]);

    const generated = await fs.readFile(
      path.join(pluginDir, CODEX_PLUGIN, SKILLS, STATUS_SKILL, "SKILL.md"),
      "utf8"
    );
    expect(generated).toBe(
      compactSkillFrontmatterDescription(
        convertCommandToSkill(COMMAND, STATUS_SKILL, "lisa:status")
      )
    );
    expect(componentPointers(pluginDir).skills).toBe("./.codex-plugin/skills/");
  });

  it("does not duplicate an authored skill with the same native name", async () => {
    await fs.outputFile(path.join(pluginDir, "commands", "status.md"), COMMAND);
    await fs.outputFile(
      path.join(pluginDir, SKILLS, STATUS_SKILL, "SKILL.md"),
      "authored\n"
    );
    expect(emitCommandSkills(pluginDir)).toEqual([]);
    expect(
      await fs.pathExists(path.join(pluginDir, CODEX_PLUGIN, SKILLS))
    ).toBe(false);
    expect(componentPointers(pluginDir).skills).toBe("./skills/");
  });

  it("exports a pure converter for parity checks", () => {
    expect(
      convertCommandToCodexSkill(COMMAND, STATUS_SKILL, "lisa:status")
    ).toContain(`name: ${STATUS_SKILL}`);
  });

  it("derives compact Codex metadata without changing the skill body", async () => {
    const body = "# Workflow\n\nComplete instructions stay here.\n";
    const source = `---\nname: ${LONG_SKILL}\ndescription: "This skill should be used when a very long routing description needs to identify the correct workflow without consuming excessive startup context for every Codex session."\n---\n${body}`;
    await fs.outputFile(
      path.join(pluginDir, SKILLS, LONG_SKILL, "SKILL.md"),
      source
    );
    expect(emitCodexSkillVariants(pluginDir)).toEqual([LONG_SKILL]);
    const derived = await fs.readFile(
      path.join(pluginDir, CODEX_PLUGIN, SKILLS, LONG_SKILL, "SKILL.md"),
      "utf8"
    );
    expect(derived).toContain(body);
    expect(derived).not.toBe(source);
    expect(compactSkillFrontmatterDescription(source)).toBe(derived);
  });
});
