/**
 * Unit tests for the instruction-files migration that `lisa doctor` runs to
 * bring projects onto the canonical AGENTS.md + CLAUDE.md-pointer pattern.
 * @module tests/unit/core/instruction-files-migration
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_MD_AGENTS_IMPORT } from "../../../src/claude/claude-md-installer.js";
import {
  LISA_RULES_END_MARKER,
  LISA_RULES_START_MARKER,
  migrateInstructionFiles,
  stripBakedAgyRulesBlock,
} from "../../../src/core/instruction-files-migration.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("core/instruction-files-migration", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  const agentsPath = (): string => path.join(dir, "AGENTS.md");
  const claudePath = (): string => path.join(dir, "CLAUDE.md");

  it("creates a canonical AGENTS.md and a CLAUDE.md pointer when both are absent", async () => {
    const result = await migrateInstructionFiles(dir);

    expect(result.changed).toBe(true);
    expect(await fs.pathExists(agentsPath())).toBe(true);
    const claude = await fs.readFile(claudePath(), "utf8");
    expect(claude).toContain(CLAUDE_MD_AGENTS_IMPORT);
  });

  it("prepends the @AGENTS.md import to an existing host CLAUDE.md without losing content", async () => {
    const hostClaude = "# My Project\n\nUse tabs, not spaces.\n";
    await fs.writeFile(claudePath(), hostClaude, "utf8");

    const result = await migrateInstructionFiles(dir);

    const claude = await fs.readFile(claudePath(), "utf8");
    expect(claude).toContain(CLAUDE_MD_AGENTS_IMPORT);
    expect(claude).toContain("Use tabs, not spaces.");
    expect(result.actions.some(a => a.includes("CLAUDE.md"))).toBe(true);
  });

  it("strips a legacy agy baked-rules block from AGENTS.md but keeps host content", async () => {
    const baked = [
      "# AGENTS.md",
      "",
      "Host note above.",
      "",
      LISA_RULES_START_MARKER,
      "",
      "## coding-philosophy",
      "",
      "Lots of baked rule text.",
      "",
      LISA_RULES_END_MARKER,
      "",
    ].join("\n");
    await fs.writeFile(agentsPath(), baked, "utf8");

    const result = await migrateInstructionFiles(dir);

    const agents = await fs.readFile(agentsPath(), "utf8");
    expect(agents).not.toContain(LISA_RULES_START_MARKER);
    expect(agents).not.toContain("Lots of baked rule text.");
    expect(agents).toContain("Host note above.");
    expect(result.actions.some(a => a.includes("baked-rules"))).toBe(true);
  });

  it("with createClaudePointer:false, does not create CLAUDE.md but still writes canonical AGENTS.md", async () => {
    const result = await migrateInstructionFiles(dir, {
      createClaudePointer: false,
    });

    expect(await fs.pathExists(agentsPath())).toBe(true);
    expect(await fs.pathExists(claudePath())).toBe(false);
    expect(result.actions.some(a => a.includes("CLAUDE.md"))).toBe(false);
  });

  it("with createClaudePointer:false, still adds the import to an existing CLAUDE.md", async () => {
    await fs.writeFile(claudePath(), "# Host Claude\n\nNotes.\n", "utf8");

    const result = await migrateInstructionFiles(dir, {
      createClaudePointer: false,
    });

    const claude = await fs.readFile(claudePath(), "utf8");
    expect(claude).toContain(CLAUDE_MD_AGENTS_IMPORT);
    expect(claude).toContain("Notes.");
    expect(result.actions.some(a => a.includes("CLAUDE.md"))).toBe(true);
  });

  it("is idempotent — a second run reports no changes", async () => {
    await migrateInstructionFiles(dir);
    const second = await migrateInstructionFiles(dir);

    expect(second.changed).toBe(false);
    expect(second.actions).toEqual([]);
  });

  it("does not re-add the import when CLAUDE.md already points at AGENTS.md", async () => {
    await fs.writeFile(claudePath(), "# Claude\n\n@AGENTS.md\n", "utf8");

    const result = await migrateInstructionFiles(dir);

    const claude = await fs.readFile(claudePath(), "utf8");
    // Exactly one occurrence — no duplicate import prepended.
    expect(claude.match(/@AGENTS\.md/g)).toHaveLength(1);
    expect(result.actions.some(a => a.includes("CLAUDE.md"))).toBe(false);
  });

  describe("stripBakedAgyRulesBlock", () => {
    it("returns the body unchanged when no block is present", () => {
      const body = "# AGENTS.md\n\nJust host content.\n";
      expect(stripBakedAgyRulesBlock(body)).toBe(body);
    });

    it("removes a well-formed block and collapses whitespace", () => {
      const body = `Before\n\n${LISA_RULES_START_MARKER}\n\nrules\n\n${LISA_RULES_END_MARKER}\n\nAfter\n`;
      const stripped = stripBakedAgyRulesBlock(body);
      expect(stripped).not.toContain(LISA_RULES_START_MARKER);
      expect(stripped).toContain("Before");
      expect(stripped).toContain("After");
      expect(stripped).not.toMatch(/\n\n\n/);
    });
  });
});
