/** Contract, public export, and shared path-resolution tests for issue #1568. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEARNINGS_CONTRACT,
  PER_ENTRY_BYTE_ALLOWANCE,
} from "../../../src/core/learnings-contract.js";
import {
  DEFAULT_PROJECT_LEARNINGS_FILE,
  DEFAULT_PROJECT_RULES_FILE,
  PROJECT_CONFIG_FILENAME,
  readProjectConfig,
  resolveProjectLearningsFile,
  resolveProjectRulesFile,
} from "../../../src/core/project-config.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const EXPECTED_ENTRY_FIELDS = [
  "id",
  "rule",
  "why",
  "provenance",
  "first_learned",
  "last_confirmed",
  "confidence",
] as const;
const CUSTOM_PROJECT_RULES_FILE = "rules/CUSTOM_RULES.md";

describe("learnings contract", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("declares exactly the seven required entry fields", () => {
    expect(LEARNINGS_CONTRACT.fields).toEqual(EXPECTED_ENTRY_FIELDS);
  });

  it.each([
    "maxRuleCharacters",
    "maxRuleLines",
    "maxProvenanceReferences",
    "maxEntries",
    "maxTokens",
  ] as const)("exports %s as a positive checkable integer", limit => {
    const value = LEARNINGS_CONTRACT[limit];
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
  });

  it("defines hard entry and file budgets with a conservative measurement", () => {
    expect(LEARNINGS_CONTRACT).toMatchObject({
      maxRuleCharacters: 240,
      maxRuleLines: 2,
      maxProvenanceReferences: 20,
      maxEntries: 20,
      maxTokens: 12000,
      measurement: "utf8-bytes-upper-bound",
    });
  });

  it("derives the byte budget from the entry cap so the two caps can never diverge", () => {
    // #1959: maxTokens is DERIVED (maxEntries * PER_ENTRY_BYTE_ALLOWANCE), never
    // an independently hardcoded number that could re-contradict the entry cap.
    // Pin both the concrete allowance and the derivation relationship: a future
    // edit that re-hardcodes maxTokens (e.g. back to a flat 4000) breaks this.
    expect(PER_ENTRY_BYTE_ALLOWANCE).toBe(600);
    expect(LEARNINGS_CONTRACT.maxTokens).toBe(
      LEARNINGS_CONTRACT.maxEntries * PER_ENTRY_BYTE_ALLOWANCE
    );
  });

  it("publishes the contract for the future CI budget reader", async () => {
    const packageJson = (await fs.readJson(path.resolve("package.json"))) as {
      exports?: Record<string, string>;
    };
    expect(packageJson.exports?.["./learnings"]).toBe(
      "./dist/core/learnings.js"
    );
  });

  it("registers the project rules default for lisa sync", () => {
    expect(
      SYNC_REGISTRY.find(setting => setting.key === "projectRulesFile")
    ).toMatchObject({ defaultValue: DEFAULT_PROJECT_RULES_FILE });
  });

  it("formalizes projectRulesFile in .lisa.config.json", async () => {
    await fs.writeJson(path.join(tempDir, PROJECT_CONFIG_FILENAME), {
      projectRulesFile: CUSTOM_PROJECT_RULES_FILE,
    });
    await expect(readProjectConfig(tempDir)).resolves.toEqual({
      projectRulesFile: CUSTOM_PROJECT_RULES_FILE,
    });
  });

  it("resolves the default rules file and the relocated .lisa learnings ledger", () => {
    expect(DEFAULT_PROJECT_RULES_FILE).toBe(".claude/rules/PROJECT_RULES.md");
    expect(resolveProjectRulesFile({})).toBe(DEFAULT_PROJECT_RULES_FILE);
    expect(DEFAULT_PROJECT_LEARNINGS_FILE).toBe(".lisa/PROJECT_LEARNINGS.md");
    expect(resolveProjectLearningsFile({})).toBe(
      DEFAULT_PROJECT_LEARNINGS_FILE
    );
  });

  it("keeps the ledger at .lisa regardless of the configured project-rules file", () => {
    // The ledger no longer rides along with projectRulesFile: relocating rules
    // must never drag the machine-managed ledger back into an eager tree.
    const config = { projectRulesFile: CUSTOM_PROJECT_RULES_FILE };
    expect(resolveProjectRulesFile(config)).toBe(CUSTOM_PROJECT_RULES_FILE);
    expect(resolveProjectLearningsFile(config)).toBe(
      DEFAULT_PROJECT_LEARNINGS_FILE
    );
  });

  it("honors a valid learnings.file override ahead of the default", () => {
    expect(
      resolveProjectLearningsFile({ learnings: { file: "docs/LEARNINGS.md" } })
    ).toBe("docs/LEARNINGS.md");
  });

  it("rejects a learnings.file override that lands in an auto-loaded rules tree, a root eager instruction file, or escapes the root", () => {
    for (const file of [
      ".claude/rules/PROJECT_LEARNINGS.md",
      ".claude/rules/nested/LEARNINGS.md",
      ".cursor/rules/LEARNINGS.md",
      ".github/instructions/LEARNINGS.md",
      // Repo-root instruction files auto-loaded whole by the runtimes.
      "AGENTS.md",
      "CLAUDE.md",
      "claude.md",
      ".github/copilot-instructions.md",
      "../ESCAPE.md",
      "rules/\tLEARNINGS.md",
      "notmarkdown.txt",
    ]) {
      expect(() =>
        resolveProjectLearningsFile({ learnings: { file } })
      ).toThrow(/learnings\.file/i);
    }
  });

  it("teaches the recommended default when rejecting an eager-tree override", () => {
    expect(() =>
      resolveProjectLearningsFile({
        learnings: { file: ".claude/rules/LEARNINGS.md" },
      })
    ).toThrow(
      /the default \.lisa\/PROJECT_LEARNINGS\.md is the recommended location/
    );
  });

  it("rejects unsafe projectRulesFile paths", () => {
    for (const projectRulesFile of [
      "../ESCAPE.md",
      "C:rules/PROJECT_RULES.md",
      "rules/\tPROJECT_RULES.md",
      "rules/\nPROJECT_RULES.md",
      "rules/PROJECT_LEARNINGS.md",
      "rules/project_learnings.md",
      path.resolve(tempDir, "ABSOLUTE_RULES.md"),
    ]) {
      expect(() => resolveProjectRulesFile({ projectRulesFile })).toThrow(
        /projectRulesFile/i
      );
    }
  });
});
