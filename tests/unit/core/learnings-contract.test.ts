/** Contract, public export, and shared path-resolution tests for issue #1568. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import {
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
      maxEntries: 20,
      maxTokens: 4000,
      measurement: "utf8-bytes-upper-bound",
    });
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

  it("resolves the default rules file and its separate learnings sibling", () => {
    expect(DEFAULT_PROJECT_RULES_FILE).toBe(".claude/rules/PROJECT_RULES.md");
    expect(resolveProjectRulesFile({})).toBe(DEFAULT_PROJECT_RULES_FILE);
    expect(resolveProjectLearningsFile({})).toBe(
      ".claude/rules/PROJECT_LEARNINGS.md"
    );
  });

  it("derives the learnings file beside a configured project-rules file", () => {
    const config = { projectRulesFile: CUSTOM_PROJECT_RULES_FILE };
    expect(resolveProjectRulesFile(config)).toBe(CUSTOM_PROJECT_RULES_FILE);
    expect(resolveProjectLearningsFile(config)).toBe(
      "rules/PROJECT_LEARNINGS.md"
    );
  });

  it("rejects unsafe projectRulesFile paths", () => {
    for (const projectRulesFile of [
      "../ESCAPE.md",
      "C:rules/PROJECT_RULES.md",
      "rules/\tPROJECT_RULES.md",
      "rules/\nPROJECT_RULES.md",
      path.resolve(tempDir, "ABSOLUTE_RULES.md"),
    ]) {
      expect(() => resolveProjectRulesFile({ projectRulesFile })).toThrow(
        /projectRulesFile/i
      );
    }
  });
});
