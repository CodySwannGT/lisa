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

const PASSED_VERDICT = "learnings budget passed";
const DEFAULT_LEDGER = ".lisa/PROJECT_LEARNINGS.md";
const DEFAULT_OVERFLOW = ".lisa/PROJECT_LEARNINGS.overflow.md";
const RELOCATED_LEDGER = "docs/LEARNINGS.md";
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
  it("resolves the .lisa ledger via a learnings.file override and passes when within budget", async () => {
    const project = createTemporaryDirectory();
    writeConfig(project, { learnings: { file: RELOCATED_LEDGER } });
    writeLearnings(
      project,
      RELOCATED_LEDGER,
      renderLearningsFile([createEntry("within-budget")])
    );

    const run = await capture(undefined, project);

    expect(run.code).toBe(0);
    expect(run.errors).toHaveLength(0);
    expect(run.logs.join("\n")).toContain(PASSED_VERDICT);
    expect(run.logs.join("\n")).toContain(path.join("docs", "LEARNINGS.md"));
  });

  it("fails with exit 1 and names the budget when the resolved ledger is over budget", async () => {
    const project = createTemporaryDirectory();
    writeLearnings(
      project,
      DEFAULT_LEDGER,
      "x".repeat(LEARNINGS_CONTRACT.maxTokens + 1)
    );

    const run = await capture(undefined, project);

    expect(run.code).toBe(1);
    expect(run.errors.join("\n")).toContain("maxTokens");
    expect(run.logs).toHaveLength(0);
  });

  it("uses the .lisa ledger by default when no override is configured", async () => {
    const project = createTemporaryDirectory();
    writeLearnings(
      project,
      DEFAULT_LEDGER,
      renderLearningsFile([createEntry("default-dir")])
    );

    const run = await capture(undefined, project);

    expect(run.code).toBe(0);
    expect(run.logs.join("\n")).toContain(
      path.join(".lisa", "PROJECT_LEARNINGS.md")
    );
  });

  it("passes silently with exit 0 when no learnings file exists", async () => {
    const project = createTemporaryDirectory();

    const run = await capture(undefined, project);

    expect(run.code).toBe(0);
    expect(run.errors).toHaveLength(0);
    expect(run.logs.join("\n")).toMatch(/nothing to check/i);
  });

  // #3089. The shipped CLI is what every HOST project's CI runs, so the
  // saturation verdict has to reach them too — otherwise Lisa's own gate would
  // warn about a full ledger while every consumer's kept saying `passed`.
  it("reports a distinct saturated verdict, without failing, at the entry cap", async () => {
    const project = createTemporaryDirectory();
    const entries = Array.from(
      { length: LEARNINGS_CONTRACT.maxEntries },
      (_unused, index) => createEntry(`saturated-${index}`)
    );
    writeLearnings(project, DEFAULT_LEDGER, renderLearningsFile(entries));

    const run = await capture(undefined, project);

    // Exit 0 on purpose. The ledger is a shared corpus that fills over weeks;
    // failing here would stop a host project's unrelated change for a state it
    // did not create, and retiring an entry is the gardener's human-gated call.
    expect(run.code).toBe(0);
    expect(run.errors).toHaveLength(0);
    expect(run.logs.join("\n")).toContain("learnings budget saturated");
    expect(run.logs.join("\n")).not.toContain(PASSED_VERDICT);
    expect(run.logs.join("\n")).toContain("/lisa:learnings:audit");
  });

  // NEGATIVE CONTROL for the case above: a ledger with room still reports
  // plainly passed and says nothing about saturation.
  it("keeps a ledger with room plainly passed and free of saturation noise", async () => {
    const project = createTemporaryDirectory();
    writeLearnings(
      project,
      DEFAULT_LEDGER,
      renderLearningsFile([createEntry("has-room")])
    );

    const run = await capture(undefined, project);

    expect(run.code).toBe(0);
    expect(run.logs.join("\n")).toContain(PASSED_VERDICT);
    expect(run.logs.join("\n")).not.toContain("saturated");
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

  it("derives a relocated overflow path and reports an overflow-specific pass", async () => {
    const project = createTemporaryDirectory();
    writeConfig(project, { learnings: { file: RELOCATED_LEDGER } });
    writeLearnings(
      project,
      "docs/LEARNINGS.overflow.md",
      renderLearningsFile([createEntry("relocated-overflow")])
    );

    const run = await capture(undefined, project, true);

    expect(run.code).toBe(0);
    expect(run.errors).toHaveLength(0);
    expect(run.logs.join("\n")).toContain("LEARNINGS.overflow.md");
    expect(run.logs.join("\n")).toContain("learnings overflow budget passed");
  });

  it("passes explicitly when the configured overflow is absent", async () => {
    const project = createTemporaryDirectory();

    const run = await capture(undefined, project, true);

    expect(run.code).toBe(0);
    expect(run.errors).toHaveLength(0);
    expect(run.logs.join("\n")).toContain("no learnings overflow file");
    expect(run.logs.join("\n")).toContain(DEFAULT_OVERFLOW);
  });

  it("warns with drain remediation when the overflow is saturated", async () => {
    const project = createTemporaryDirectory();
    const entries = Array.from(
      { length: LEARNINGS_CONTRACT.maxEntries },
      (_unused, index) => createEntry(`overflow-${index}`)
    );
    writeLearnings(project, DEFAULT_OVERFLOW, renderLearningsFile(entries));

    const run = await capture(undefined, project, true);

    expect(run.code).toBe(0);
    expect(run.errors).toHaveLength(0);
    expect(run.logs.join("\n")).toContain(
      "learnings overflow budget saturated"
    );
    expect(run.logs.join("\n")).toContain("lisa learnings-overflow");
    expect(run.logs.join("\n")).not.toContain("/lisa:learnings:audit");
  });

  it("fails an over-budget overflow with drain rather than trim remediation", async () => {
    const project = createTemporaryDirectory();
    writeLearnings(
      project,
      DEFAULT_OVERFLOW,
      "x".repeat(LEARNINGS_CONTRACT.maxTokens + 1)
    );

    const run = await capture(undefined, project, true);

    expect(run.code).toBe(1);
    expect(run.errors.join("\n")).toContain(DEFAULT_OVERFLOW);
    expect(run.errors.join("\n")).toContain("lisa learnings-overflow");
    expect(run.errors.join("\n")).not.toMatch(
      /shorten or remove|consolidate or remove/i
    );
  });

  it("rejects combining overflow mode with an explicit path", async () => {
    const project = createTemporaryDirectory();

    const run = await capture("custom.md", project, true);

    expect(run.code).toBe(1);
    expect(run.errors.join("\n")).toContain(
      "cannot be combined with an explicit path"
    );
  });
});

/**
 * Run the command with captured output sinks anchored to a project directory.
 * @param fileArg - Optional explicit file argument
 * @param cwd - Project directory the run is anchored to
 * @param overflow - Whether to check the configured overflow sibling
 * @returns Exit code and captured output
 */
async function capture(
  fileArg: string | undefined,
  cwd: string,
  overflow = false
): Promise<CapturedRun> {
  const logs: string[] = [];
  const errors: string[] = [];
  const code = await runCheckLearningsBudget(fileArg, {
    cwd,
    overflow,
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
    fingerprint: `${id}-fingerprint`,
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
