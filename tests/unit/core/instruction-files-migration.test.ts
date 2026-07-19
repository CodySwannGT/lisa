/**
 * Unit tests for the instruction-files migration that `lisa doctor` runs to
 * bring projects onto the canonical AGENTS.md + CLAUDE.md-pointer pattern.
 * @module tests/unit/core/instruction-files-migration
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_MD_AGENTS_IMPORT } from "../../../src/claude/claude-md-installer.js";
import { renderLearningsFile } from "../../../src/core/learnings-document.js";
import {
  LISA_PROJECT_LEARNINGS_END_MARKER,
  LISA_PROJECT_LEARNINGS_START_MARKER,
  LISA_RULES_END_MARKER,
  LISA_RULES_START_MARKER,
  buildAgyProjectLearningsBridge,
  migrateInstructionFiles,
  relocateProjectLearningsLedger,
  stripAgyProjectLearningsBridge,
  stripBakedAgyRulesBlock,
} from "../../../src/core/instruction-files-migration.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CONFIG_PATH = ".lisa.config.json";
const CUSTOM_RULES_PATH = "rules/CUSTOM_RULES.md";
const DEFAULT_LEARNINGS_LINE =
  "Resolved path for this project: `.lisa/PROJECT_LEARNINGS.md`.";
const OVERRIDE_LEARNINGS_LINE =
  "Resolved path for this project: `docs/LEARNINGS.md`.";
const OVERRIDE_LEARNINGS_PATH = "docs/LEARNINGS.md";
const CUSTOM_LEARNINGS_PATH = "rules/PROJECT_LEARNINGS.md";
const LEGACY_LEARNINGS_PATH = ".claude/rules/PROJECT_LEARNINGS.md";
const NEW_LEARNINGS_PATH = ".lisa/PROJECT_LEARNINGS.md";

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

  it("adds the bounded agy project-learnings bridge for agy harnesses", async () => {
    await fs.writeJson(path.join(dir, CONFIG_PATH), {
      harness: "agy",
    });

    const result = await migrateInstructionFiles(dir);

    const agents = await fs.readFile(agentsPath(), "utf8");
    expect(result.actions.some(a => a.includes("project-learnings"))).toBe(
      true
    );
    expect(agents).toContain(LISA_PROJECT_LEARNINGS_START_MARKER);
    expect(agents).toContain(DEFAULT_LEARNINGS_LINE);
    expect(agents).not.toContain(LISA_RULES_START_MARKER);
  });

  it("replaces the agy bridge when a learnings.file override moves the ledger", async () => {
    await fs.writeJson(path.join(dir, CONFIG_PATH), {
      harness: "agy",
    });
    await migrateInstructionFiles(dir);
    await fs.writeJson(path.join(dir, CONFIG_PATH), {
      harness: "agy",
      learnings: { file: OVERRIDE_LEARNINGS_PATH },
    });

    const result = await migrateInstructionFiles(dir);

    const agents = await fs.readFile(agentsPath(), "utf8");
    expect(result.changed).toBe(true);
    expect(agents.match(/LISA_PROJECT_LEARNINGS_START/g)).toHaveLength(1);
    expect(agents).toContain(OVERRIDE_LEARNINGS_LINE);
    expect(agents).not.toContain(DEFAULT_LEARNINGS_LINE);
  });

  it("removes the agy bridge when the harness no longer includes agy", async () => {
    await fs.writeFile(
      agentsPath(),
      `Host\n\n${buildAgyProjectLearningsBridge(CUSTOM_LEARNINGS_PATH)}\n\nAfter\n`,
      "utf8"
    );
    await fs.writeJson(path.join(dir, CONFIG_PATH), {
      harness: "codex",
    });

    const result = await migrateInstructionFiles(dir);

    const agents = await fs.readFile(agentsPath(), "utf8");
    expect(result.actions.some(a => a.includes("removed agy"))).toBe(true);
    expect(agents).not.toContain(LISA_PROJECT_LEARNINGS_START_MARKER);
    expect(agents).toContain("Host");
    expect(agents).toContain("After");
  });

  it("removes legacy baked rules while preserving the bounded agy learnings bridge", async () => {
    await fs.writeFile(
      agentsPath(),
      [
        "Host before.",
        "",
        LISA_RULES_START_MARKER,
        "Full eager rule body that must not survive.",
        LISA_RULES_END_MARKER,
        "",
        buildAgyProjectLearningsBridge(CUSTOM_LEARNINGS_PATH),
        "",
        "Host after.",
      ].join("\n"),
      "utf8"
    );
    await fs.writeJson(path.join(dir, CONFIG_PATH), {
      harness: "agy",
      projectRulesFile: CUSTOM_RULES_PATH,
    });

    await migrateInstructionFiles(dir);

    const agents = await fs.readFile(agentsPath(), "utf8");
    expect(agents).not.toContain("Full eager rule body");
    expect(agents).toContain(LISA_PROJECT_LEARNINGS_START_MARKER);
    expect(agents).toContain("Host before.");
    expect(agents).toContain("Host after.");
  });

  it("does not re-add the import when CLAUDE.md already points at AGENTS.md", async () => {
    await fs.writeFile(claudePath(), "# Claude\n\n@AGENTS.md\n", "utf8");

    const result = await migrateInstructionFiles(dir);

    const claude = await fs.readFile(claudePath(), "utf8");
    // Exactly one occurrence — no duplicate import prepended.
    expect(claude.match(/@AGENTS\.md/g)).toHaveLength(1);
    expect(result.actions.some(a => a.includes("CLAUDE.md"))).toBe(false);
  });

  describe("relocateProjectLearningsLedger", () => {
    const legacyPath = (): string => path.join(dir, LEGACY_LEARNINGS_PATH);
    const newPath = (): string => path.join(dir, NEW_LEARNINGS_PATH);
    const ledger = (): string =>
      renderLearningsFile([
        {
          id: "relocate-1",
          rule: "Keep the ledger out of eager context.",
          why: "Raw injection bypasses the contract.",
          provenance: ["https://github.com/CodySwannGT/lisa/issues/1730"],
          first_learned: "2026-07-16",
          last_confirmed: "2026-07-16",
          confidence: "high",
        },
      ]);

    it("moves a legacy ledger byte-for-byte to the new path and removes the legacy file", async () => {
      const content = ledger();
      await fs.outputFile(legacyPath(), content);

      const result = await relocateProjectLearningsLedger(dir);

      expect(result.moved).toBe(true);
      expect(await fs.readFile(newPath(), "utf8")).toBe(content);
      expect(await fs.pathExists(legacyPath())).toBe(false);
    });

    it("keeps both files without clobbering when the new path already exists", async () => {
      const legacyContent = ledger();
      const newContent = renderLearningsFile([]);
      await fs.outputFile(legacyPath(), legacyContent);
      await fs.outputFile(newPath(), newContent);

      const result = await relocateProjectLearningsLedger(dir);

      expect(result.moved).toBe(false);
      expect(result.warning).toMatch(/both/i);
      expect(result.warning).toContain(LEGACY_LEARNINGS_PATH);
      expect(result.warning).toContain(NEW_LEARNINGS_PATH);
      // Neither file is touched — a human reconciles.
      expect(await fs.readFile(legacyPath(), "utf8")).toBe(legacyContent);
      expect(await fs.readFile(newPath(), "utf8")).toBe(newContent);
    });

    it("is idempotent — a second run is a quiet no-op", async () => {
      await fs.outputFile(legacyPath(), ledger());
      await relocateProjectLearningsLedger(dir);

      const second = await relocateProjectLearningsLedger(dir);

      expect(second.moved).toBe(false);
      expect(second.warning).toBeUndefined();
    });

    it("does nothing when no legacy ledger exists", async () => {
      const result = await relocateProjectLearningsLedger(dir);

      expect(result.moved).toBe(false);
      expect(await fs.pathExists(newPath())).toBe(false);
    });

    it("refuses to write through a target parent symlink that escapes the project root", async () => {
      // Guards doctor's direct path (no apply-phase pre-check): a symlinked
      // .lisa/ pointing outside the project must throw before any write.
      const external = await createTempDir();
      await fs.symlink(external, path.join(dir, ".lisa"), "dir");
      await fs.outputFile(legacyPath(), ledger());

      await expect(relocateProjectLearningsLedger(dir)).rejects.toThrow(
        /parent escapes project root/i
      );
      expect(
        await fs.pathExists(path.join(external, "PROJECT_LEARNINGS.md"))
      ).toBe(false);
      // The legacy file is left intact — nothing was moved.
      expect(await fs.pathExists(legacyPath())).toBe(true);

      await fs.remove(external);
    });

    it("runs inside migrateInstructionFiles so doctor relocates too", async () => {
      const content = ledger();
      await fs.outputFile(legacyPath(), content);

      const result = await migrateInstructionFiles(dir);

      expect(result.actions.some(action => action.includes("ledger"))).toBe(
        true
      );
      expect(await fs.readFile(newPath(), "utf8")).toBe(content);
      expect(await fs.pathExists(legacyPath())).toBe(false);
    });
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

  describe("stripAgyProjectLearningsBridge", () => {
    it("removes a well-formed managed bridge and preserves surrounding text", () => {
      const body = `Before\n\n${buildAgyProjectLearningsBridge(CUSTOM_LEARNINGS_PATH)}\n\nAfter\n`;
      const stripped = stripAgyProjectLearningsBridge(body);
      expect(stripped).not.toContain(LISA_PROJECT_LEARNINGS_START_MARKER);
      expect(stripped).toContain("Before");
      expect(stripped).toContain("After");
    });

    it("leaves malformed markers unchanged", () => {
      const body = `Before\n${LISA_PROJECT_LEARNINGS_START_MARKER}\nAfter\n`;
      expect(stripAgyProjectLearningsBridge(body)).toBe(body);
    });

    it("leaves duplicate marker pairs unchanged rather than deleting only the first pair", () => {
      const bridge = buildAgyProjectLearningsBridge(CUSTOM_LEARNINGS_PATH);
      // Two full bridge blocks back to back is malformed for this managed-block
      // contract: indexOf would only find the first pair, silently stranding the
      // second block's markers and text as stale host content.
      const body = `Before\n\n${bridge}\n\n${bridge}\n\nAfter\n`;
      expect(stripAgyProjectLearningsBridge(body)).toBe(body);
    });

    it("leaves a duplicated start marker unchanged even with a single end marker", () => {
      const body = [
        "Before",
        LISA_PROJECT_LEARNINGS_START_MARKER,
        "first",
        LISA_PROJECT_LEARNINGS_START_MARKER,
        "second",
        LISA_PROJECT_LEARNINGS_END_MARKER,
        "After",
      ].join("\n");
      expect(stripAgyProjectLearningsBridge(body)).toBe(body);
    });
  });
});
