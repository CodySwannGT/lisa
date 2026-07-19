import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheckLearningsBudget } from "../../../src/cli/check-learnings-budget-cmd.js";
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-document.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** Capture the informational and diagnostic sinks for one command run. */
interface CapturedRun {
  readonly code: number;
  readonly logs: readonly string[];
  readonly errors: readonly string[];
}

describe("runCheckLearningsBudget", () => {
  it("resolves the default file from .lisa.config.json projectRulesFile and passes when within budget", async () => {
    const project = createTemporaryDirectory();
    writeConfig(project, { projectRulesFile: "custom/rules/RULES.md" });
    writeLearnings(
      project,
      "custom/rules/PROJECT_LEARNINGS.md",
      renderLearningsFile([createEntry("within-budget")])
    );

    const run = await capture(undefined, project);

    expect(run.code).toBe(0);
    expect(run.errors).toHaveLength(0);
    expect(run.logs.join("\n")).toContain("learnings budget passed");
    expect(run.logs.join("\n")).toContain(
      path.join("custom", "rules", "PROJECT_LEARNINGS.md")
    );
  });

  it("fails with exit 1 and names the budget when the resolved default file is over budget", async () => {
    const project = createTemporaryDirectory();
    writeConfig(project, { projectRulesFile: "custom/rules/RULES.md" });
    writeLearnings(
      project,
      "custom/rules/PROJECT_LEARNINGS.md",
      "x".repeat(LEARNINGS_CONTRACT.maxTokens + 1)
    );

    const run = await capture(undefined, project);

    expect(run.code).toBe(1);
    expect(run.errors.join("\n")).toContain("maxTokens");
    expect(run.logs).toHaveLength(0);
  });

  it("uses the default rules directory when no projectRulesFile is configured", async () => {
    const project = createTemporaryDirectory();
    writeLearnings(
      project,
      ".claude/rules/PROJECT_LEARNINGS.md",
      renderLearningsFile([createEntry("default-dir")])
    );

    const run = await capture(undefined, project);

    expect(run.code).toBe(0);
    expect(run.logs.join("\n")).toContain(
      path.join(".claude", "rules", "PROJECT_LEARNINGS.md")
    );
  });

  it("passes silently with exit 0 when no learnings file exists", async () => {
    const project = createTemporaryDirectory();

    const run = await capture(undefined, project);

    expect(run.code).toBe(0);
    expect(run.errors).toHaveLength(0);
    expect(run.logs.join("\n")).toMatch(/nothing to check/i);
  });

  it("checks an explicit path argument over the resolved default", async () => {
    const project = createTemporaryDirectory();
    const explicit = path.join(project, "explicit.md");
    writeFileSync(
      explicit,
      "x".repeat(LEARNINGS_CONTRACT.maxTokens + 1),
      "utf8"
    );

    const run = await capture(explicit, project);

    expect(run.code).toBe(1);
    expect(run.errors.join("\n")).toContain("maxTokens");
  });
});

/**
 * Run the command with captured output sinks anchored to a project directory.
 * @param fileArg - Optional explicit file argument
 * @param cwd - Project directory the run is anchored to
 * @returns Exit code and captured output
 */
async function capture(
  fileArg: string | undefined,
  cwd: string
): Promise<CapturedRun> {
  const logs: string[] = [];
  const errors: string[] = [];
  const code = await runCheckLearningsBudget(fileArg, {
    cwd,
    log: message => logs.push(message),
    error: message => errors.push(message),
  });
  return { code, logs, errors };
}

/**
 * Create one structurally valid entry, optionally replacing selected fields.
 * @param id - Stable learning identifier
 * @param overrides - Fields replaced for a specific boundary fixture
 * @returns Learning entry suitable for canonical rendering
 */
function createEntry(
  id: string,
  overrides: Partial<LearningEntry> = {}
): LearningEntry {
  return {
    id,
    rule: "r",
    why: "w",
    provenance: ["p"],
    first_learned: "2026-07-16",
    last_confirmed: "2026-07-16",
    confidence: "low",
    ...overrides,
  };
}

/**
 * Write a `.lisa.config.json` into a project directory.
 * @param project - Project root
 * @param config - Config object to serialize
 */
function writeConfig(project: string, config: Record<string, unknown>): void {
  writeFileSync(
    path.join(project, ".lisa.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Write a learnings document at a project-relative path, creating parents.
 * @param project - Project root
 * @param relative - Project-relative learnings path
 * @param content - Learnings document content
 */
function writeLearnings(
  project: string,
  relative: string,
  content: string
): void {
  const filePath = path.join(project, relative);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

/**
 * Allocate and remember a temporary directory for deterministic cleanup.
 * @returns Absolute temporary-directory path
 */
function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-budget-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}
