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

  it("retains the full authored routing description after metadata compaction", async () => {
    const description =
      "Run one starter sync using the repository's declared branch and all factory gates.";
    const body = "# Starter sync\n\nFollow the declared workflow.\n";
    const source = `---\nname: ${LONG_SKILL}\ndescription: ${JSON.stringify(description)}\n---\n${body}`;
    await fs.outputFile(
      path.join(pluginDir, SKILLS, LONG_SKILL, "SKILL.md"),
      source
    );
    emitCodexSkillVariants(pluginDir);
    const generated = await fs.readFile(
      path.join(pluginDir, CODEX_PLUGIN, SKILLS, LONG_SKILL, "SKILL.md"),
      "utf8"
    );
    const metadata = generated.split("---")[1];

    expect(metadata).not.toContain(description);
    expect(generated.split("---").slice(2).join("---")).toContain(description);
    expect(generated).toContain(body);
    expect(compactSkillFrontmatterDescription(generated)).toBe(generated);
  });

  it("preserves a folded routing description in the loaded skill", () => {
    const source =
      "---\nname: folded\ndescription: >\n  Use this skill when a declared starter sync needs\n  the repository's actual branch and verification gates.\n---\n# Workflow\n";
    const generated = compactSkillFrontmatterDescription(source);

    expect(generated.split("---").slice(2).join("---")).toContain(
      "Use this skill when a declared starter sync needs the repository's actual branch and verification gates."
    );
    expect(generated).toContain("# Workflow");
  });

  it("truncates at an available early word boundary", () => {
    const description =
      "Run anUnbrokenRoutingWordThatExceedsTheRemainingBudget for this workflow.";
    const source = `---\nname: bounded\ndescription: ${JSON.stringify(description)}\n---\n# Workflow\n`;
    const generated = compactSkillFrontmatterDescription(source);

    expect(generated).toContain('description: "Run…"');
    expect(generated.split("---").slice(2).join("---")).toContain(description);
  });
});
