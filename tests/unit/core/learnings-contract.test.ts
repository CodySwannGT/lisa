/** Contract, public export, and shared path-resolution tests for issue #1568. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEARNINGS_CONTRACT,
  PER_ENTRY_BYTE_ALLOWANCE,
} from "../../../src/core/learnings-contract.js";
import { parseLearningsDocument } from "../../../src/core/learnings-document.js";
import {
  DEFAULT_PROJECT_LEARNINGS_FILE,
  HOST_RULES_DIR,
  LEGACY_PROJECT_RULES_FILE,
  PROJECT_CONFIG_FILENAME,
  readProjectConfig,
  resolveLegacyProjectRulesFile,
  resolveProjectLearningsFile,
} from "../../../src/core/project-config.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const EXPECTED_ENTRY_FIELDS = [
  "id",
  "fingerprint",
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

  it("declares exactly the eight required v2 entry fields", () => {
    expect(LEARNINGS_CONTRACT.fields).toEqual(EXPECTED_ENTRY_FIELDS);
    expect(LEARNINGS_CONTRACT.version).toBe(2);
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
      maxTokens: 12800,
      measurement: "utf8-bytes-upper-bound",
    });
  });

  it("derives the byte budget from the entry cap so the two caps can never diverge", () => {
    // #1959: maxTokens is DERIVED (maxEntries * PER_ENTRY_BYTE_ALLOWANCE), never
    // an independently hardcoded number that could re-contradict the entry cap.
    // Pin both the concrete allowance and the derivation relationship: a future
    // edit that re-hardcodes maxTokens (e.g. back to a flat 4000) breaks this.
    expect(PER_ENTRY_BYTE_ALLOWANCE).toBe(640);
    expect(LEARNINGS_CONTRACT.maxTokens).toBe(
      LEARNINGS_CONTRACT.maxEntries * PER_ENTRY_BYTE_ALLOWANCE
    );
  });

  it("normalizes a canonical v1 document without rewriting its source contract", () => {
    const legacy = `# Project Learnings

<!-- lisa-learnings-contract:v1 -->

\`\`\`jsonl
{"id":"learner-legacy123","rule":"Keep legacy ledgers readable.","why":"A read must not force a migration write.","provenance":["issue:#2015"],"first_learned":"2026-07-01","last_confirmed":"2026-07-02","confidence":"high"}
\`\`\`
`;

    expect(parseLearningsDocument(legacy)).toEqual({
      sourceVersion: 1,
      sourceMaxTokens: 12000,
      canonicalSource: true,
      entries: [
        {
          id: "learner-legacy123",
          fingerprint: "learner-legacy123",
          rule: "Keep legacy ledgers readable.",
          why: "A read must not force a migration write.",
          provenance: ["issue:#2015"],
          first_learned: "2026-07-01",
          last_confirmed: "2026-07-02",
          confidence: "high",
        },
      ],
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

  it("stops syncing a project-rules default now that the path is fixed", () => {
    // Host rules live at the non-configurable HOST_RULES_DIR, so there is no
    // value for `lisa sync` to populate or reconcile.
    expect(
      SYNC_REGISTRY.some(setting => setting.key === "projectRulesFile")
    ).toBe(false);
  });

  it("still parses and preserves a legacy projectRulesFile in .lisa.config.json", async () => {
    await fs.writeJson(path.join(tempDir, PROJECT_CONFIG_FILENAME), {
      projectRulesFile: CUSTOM_PROJECT_RULES_FILE,
    });
    await expect(readProjectConfig(tempDir)).resolves.toEqual({
      projectRulesFile: CUSTOM_PROJECT_RULES_FILE,
    });
  });

  it("resolves the canonical host-rules directory, the legacy rules file, and the relocated .lisa learnings ledger", () => {
    expect(HOST_RULES_DIR).toBe(".agents/rules");
    expect(LEGACY_PROJECT_RULES_FILE).toBe(".claude/rules/PROJECT_RULES.md");
    expect(resolveLegacyProjectRulesFile({})).toBe(LEGACY_PROJECT_RULES_FILE);
    expect(DEFAULT_PROJECT_LEARNINGS_FILE).toBe(".lisa/PROJECT_LEARNINGS.md");
    expect(resolveProjectLearningsFile({})).toBe(
      DEFAULT_PROJECT_LEARNINGS_FILE
    );
  });

  it("keeps the ledger at .lisa regardless of the configured project-rules file", () => {
    // The ledger no longer rides along with projectRulesFile: relocating rules
    // must never drag the machine-managed ledger back into an eager tree.
    const config = { projectRulesFile: CUSTOM_PROJECT_RULES_FILE };
    expect(resolveLegacyProjectRulesFile(config)).toBe(
      CUSTOM_PROJECT_RULES_FILE
    );
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
      expect(() => resolveLegacyProjectRulesFile({ projectRulesFile })).toThrow(
        /projectRulesFile/i
      );
    }
  });
});
