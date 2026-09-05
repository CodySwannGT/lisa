/**
 * Contract tests for the canonical, agent-neutral host-rules directory
 * (`.agents/rules/`) and the idempotent Lisa-managed pointer block that
 * `lisa apply` / `lisa doctor` reconcile into `AGENTS.md`.
 *
 * These assertions encode work unit A of
 * `wiki/decisions/2026-08-12-agent-neutral-host-rules-path.md`:
 * the path is fixed, Lisa never writes rule bodies into it, the pointer is a
 * bounded managed block that never touches host prose, and a host's legacy
 * `PROJECT_RULES.md` survives the migration intact and reachable.
 * @module tests/unit/core/host-rules-pointer
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_HOST_RULES_END_MARKER,
  LISA_HOST_RULES_START_MARKER,
  buildHostRulesPointer,
  migrateInstructionFiles,
  stripHostRulesPointer,
} from "../../../src/core/instruction-files-migration.js";
import {
  HOST_RULES_DIR,
  LEGACY_PROJECT_RULES_FILE,
  resolveLegacyProjectRulesFile,
} from "../../../src/core/project-config.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const HOST_PROSE = "# My Project\n\nWe deploy on Fridays. Deal with it.\n";
/** A legacy rules path outside `.claude/rules/`, which Claude auto-loads nothing from. */
const CUSTOM_RULES_FILE = "rules/CUSTOM.md";

/**
 * Whether any line of a block is an `@` import directive.
 * @param block - The emitted pointer block.
 * @returns True when a line starts with `@`, leading whitespace aside.
 */
const hasImportDirective = (block: string): boolean =>
  block.split("\n").some(line => line.trimStart().startsWith("@"));

describe("core/host-rules pointer", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  const agentsPath = (): string => path.join(dir, "AGENTS.md");
  const readAgents = async (): Promise<string> =>
    fs.readFile(agentsPath(), "utf8");

  describe("canonical path", () => {
    it("fixes the host-rules directory at .agents/rules", () => {
      expect(HOST_RULES_DIR).toBe(".agents/rules");
    });

    it("keeps the retired single-file path available only as a legacy constant", () => {
      expect(LEGACY_PROJECT_RULES_FILE).toBe(".claude/rules/PROJECT_RULES.md");
      expect(resolveLegacyProjectRulesFile({})).toBe(LEGACY_PROJECT_RULES_FILE);
      expect(
        resolveLegacyProjectRulesFile({ projectRulesFile: "rules/OLD.md" })
      ).toBe("rules/OLD.md");
    });
  });

  describe("pointer block content", () => {
    it("names the canonical directory and instructs the reader to read it", () => {
      const block = buildHostRulesPointer();

      expect(block.startsWith(LISA_HOST_RULES_START_MARKER)).toBe(true);
      expect(block.endsWith(LISA_HOST_RULES_END_MARKER)).toBe(true);
      expect(block).toContain(HOST_RULES_DIR);
      // The instruction verb is the load-bearing part, not the path. A block
      // that names the directory without telling anyone to read it is what an
      // import-directive-only form degrades to on the five agents that do not
      // parse `@` — measured inert even on Claude, which does.
      expect(block).toMatch(/read every file under/iu);
    });

    it("carries no import directive, which only Claude parses and only for files", () => {
      const block = buildHostRulesPointer(LEGACY_PROJECT_RULES_FILE);

      // `@.agents/rules/` loads nothing: `@path` is Claude Code syntax the other
      // five agents ignore, and it resolves files rather than directories even
      // there. Emitting one would put a line that instructs no agent into every
      // host's AGENTS.md forever.
      expect(hasImportDirective(block)).toBe(false);
    });

    it("stays short enough to earn its place in every session's context", () => {
      // The block is loaded by every agent in every session. The retired prose
      // form was 20 lines; this pins the shape, not a byte count.
      expect(buildHostRulesPointer().split("\n")).toHaveLength(5);
      expect(
        buildHostRulesPointer(LEGACY_PROJECT_RULES_FILE).split("\n")
      ).toHaveLength(7);
    });

    it("carries no transition paragraph when no legacy rules file exists", () => {
      expect(buildHostRulesPointer()).not.toContain("PROJECT_RULES.md");
    });

    it("names a legacy rules file and forbids double-loading it", () => {
      const block = buildHostRulesPointer(LEGACY_PROJECT_RULES_FILE);

      expect(block).toContain(LEGACY_PROJECT_RULES_FILE);
      // The caveat is the half of the retired transition paragraph that had to
      // survive the trim: `.agents/rules/` auto-loads nowhere, but a legacy path
      // can, and an unqualified "also read it" reintroduces the double-load this
      // block exists to prevent.
      expect(block).toMatch(/unless your runtime auto-loads it/iu);
      expect(block).toMatch(/Claude Code auto-loads/iu);
    });

    it("qualifies the caveat by runtime, not by path, so a custom path stays true", () => {
      // `projectRulesFile` can point outside `.claude/rules/`, where Claude Code
      // auto-loads nothing. Naming that directory as the reason would make the
      // sentence false for such a host.
      const block = buildHostRulesPointer(CUSTOM_RULES_FILE);

      expect(block).toContain(CUSTOM_RULES_FILE);
      expect(block).toMatch(/unless your runtime auto-loads it/iu);
    });

    it("round-trips through the stripper", () => {
      const body = `${HOST_PROSE}\n${buildHostRulesPointer()}\n`;

      expect(stripHostRulesPointer(body)).toContain("deploy on Fridays");
      expect(stripHostRulesPointer(body)).not.toContain(
        LISA_HOST_RULES_START_MARKER
      );
    });

    it("leaves a body with malformed markers untouched", () => {
      const malformed = `${HOST_PROSE}${LISA_HOST_RULES_START_MARKER}\nno end marker\n`;

      expect(stripHostRulesPointer(malformed)).toBe(malformed);
    });
  });

  describe("migration into an existing AGENTS.md", () => {
    it("adds the pointer without touching surrounding host prose", async () => {
      await fs.writeFile(agentsPath(), HOST_PROSE, "utf8");

      const result = await migrateInstructionFiles(dir);

      const body = await readAgents();
      expect(result.changed).toBe(true);
      expect(body).toContain("We deploy on Fridays. Deal with it.");
      expect(body).toContain(LISA_HOST_RULES_START_MARKER);
      expect(body).toContain(HOST_RULES_DIR);
      expect(result.actions.join(" ")).toMatch(/host-rules pointer/iu);
    });

    it("is a no-op on a repeat run", async () => {
      await fs.writeFile(agentsPath(), HOST_PROSE, "utf8");
      await migrateInstructionFiles(dir);
      const afterFirst = await readAgents();

      const second = await migrateInstructionFiles(dir);

      expect(await readAgents()).toBe(afterFirst);
      expect(second.actions.join(" ")).not.toMatch(/host-rules pointer/iu);
    });

    it("adds the pointer to a freshly created AGENTS.md", async () => {
      await migrateInstructionFiles(dir);

      expect(await readAgents()).toContain(LISA_HOST_RULES_START_MARKER);
    });

    it("refreshes a stale pointer in place rather than appending a second one", async () => {
      const stale = [
        HOST_PROSE,
        LISA_HOST_RULES_START_MARKER,
        "Read the rules in .claude/rules/ instead.",
        LISA_HOST_RULES_END_MARKER,
        "",
      ].join("\n");
      await fs.writeFile(agentsPath(), stale, "utf8");

      await migrateInstructionFiles(dir);

      const body = await readAgents();
      expect(body).toContain(HOST_RULES_DIR);
      expect(body).not.toContain("Read the rules in .claude/rules/ instead.");
      expect(body.split(LISA_HOST_RULES_START_MARKER)).toHaveLength(2);
      expect(body).toContain("We deploy on Fridays. Deal with it.");
    });
  });

  describe("transition for a host with existing PROJECT_RULES.md", () => {
    const legacyBody = "# Project Rules\n\nNever force-push to main.\n";

    beforeEach(async () => {
      await fs.outputFile(
        path.join(dir, LEGACY_PROJECT_RULES_FILE),
        legacyBody,
        "utf8"
      );
    });

    it("leaves the legacy file byte-for-byte intact", async () => {
      await migrateInstructionFiles(dir);

      expect(
        await fs.readFile(path.join(dir, LEGACY_PROJECT_RULES_FILE), "utf8")
      ).toBe(legacyBody);
    });

    it("keeps the legacy content reachable by naming it in the pointer", async () => {
      await migrateInstructionFiles(dir);

      expect(await readAgents()).toContain(LEGACY_PROJECT_RULES_FILE);
    });

    it("names a custom projectRulesFile instead of the default when configured", async () => {
      const custom = CUSTOM_RULES_FILE;
      await fs.outputFile(path.join(dir, custom), "custom", "utf8");
      await fs.writeJson(path.join(dir, ".lisa.config.json"), {
        projectRulesFile: custom,
      });

      await migrateInstructionFiles(dir);

      expect(await readAgents()).toContain(custom);
    });

    it("drops the transition paragraph once the legacy file is gone", async () => {
      await migrateInstructionFiles(dir);
      await fs.remove(path.join(dir, LEGACY_PROJECT_RULES_FILE));

      await migrateInstructionFiles(dir);

      const body = await readAgents();
      expect(body).toContain(HOST_RULES_DIR);
      expect(body).not.toContain(LEGACY_PROJECT_RULES_FILE);
    });
  });
});
