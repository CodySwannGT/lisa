import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CommandResult,
  resolveBunExecutable,
  runCheckWithBun,
  runCheckerDirectWithBun,
  stagePackageWithFreshDist,
} from "./check-learnings-budget-helpers.js";
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-writer.js";

const BUN_EXECUTABLE = resolveBunExecutable(
  process.env.npm_execpath ?? process.execPath
);
const TAR_EXECUTABLE = realpathSync("/usr/bin/tar");
const MKFIFO_EXECUTABLE = realpathSync("/usr/bin/mkfifo");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("check:learnings-budget", () => {
  it("accepts the committed canonical learnings file by default", () => {
    const result = runCheck();

    expect(result.status).toBe(0);
  });

  it("accepts one explicit canonical within-budget file", () => {
    const fixture = writeFixture(
      "valid.md",
      renderLearningsFile([createEntry("valid-entry")])
    );

    const result = runCheck(fixture);

    expect(result.status).toBe(0);
  });

  it("names an entry whose rule exceeds maxRuleCharacters", () => {
    const id = "over-character-cap";
    const fixture = writeFixture(
      "over-characters.md",
      renderLearningsFile([
        createEntry(id, {
          rule: "x".repeat(LEARNINGS_CONTRACT.maxRuleCharacters + 1),
        }),
      ])
    );

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(fixture);
    expect(result.output).toContain("maxRuleCharacters");
    expect(result.output).toContain(id);
  });

  it("names an entry whose rule exceeds maxRuleLines", () => {
    const id = "over-line-cap";
    const rule = Array.from(
      { length: LEARNINGS_CONTRACT.maxRuleLines + 1 },
      (_unused, index) => `line-${index}`
    ).join("\n");
    const fixture = writeFixture(
      "over-lines.md",
      renderLearningsFile([createEntry(id, { rule })])
    );

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(fixture);
    expect(result.output).toContain("maxRuleLines");
    expect(result.output).toContain(id);
  });

  it("reports measured and allowed maxEntries values", () => {
    const measuredEntries = LEARNINGS_CONTRACT.maxEntries + 1;
    const entries = Array.from({ length: measuredEntries }, (_unused, index) =>
      createEntry(`entry-${index}`)
    );
    const fixture = writeFixture(
      "over-entries.md",
      renderLearningsFile(entries)
    );

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(fixture);
    expect(result.output).toContain("maxEntries");
    expect(result.output).toContain(String(measuredEntries));
    expect(result.output).toContain(String(LEARNINGS_CONTRACT.maxEntries));
  });

  it("reports measured and allowed maxTokens values", () => {
    const content = renderLearningsFile([
      createEntry("token-heavy-one", { why: "x".repeat(2000) }),
      createEntry("token-heavy-two", { why: "y".repeat(2000) }),
    ]);
    const measuredTokens = 4355;
    const fixture = writeFixture("over-tokens.md", content);

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(fixture);
    expect(result.output).toContain("maxTokens");
    expect(result.output).toContain(String(measuredTokens));
    expect(result.output).toContain(String(LEARNINGS_CONTRACT.maxTokens));
  });

  it("rejects malformed JSONL with a path-specific diagnostic", () => {
    const malformed = renderLearningsFile([]).replace(
      "```jsonl\n",
      "```jsonl\n{not-json}\n"
    );
    const fixture = writeFixture("malformed.md", malformed);

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(fixture);
    expect(result.output).toMatch(/JSONL|malformed|parse/i);
  });

  it("rejects a non-canonical document with a path-specific diagnostic", () => {
    const fixture = writeFixture(
      "noncanonical.md",
      `${JSON.stringify(createEntry("valid-but-unwrapped"))}\n`
    );

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(fixture);
    expect(result.output).toMatch(/canonical|format/i);
  });

  it("does not repeat control characters from a missing filesystem path", () => {
    const fixture = path.join(
      createTemporaryDirectory(),
      "missing\nforged-line\u001b[31m-\u0085-\u2028-\u2029.md"
    );

    const result = runCheckerDirect(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/\\u0085.*\\u2028.*\\u2029/u);
    expect(result.output).toContain("ENOENT");
    expect(result.output).not.toContain(fixture);
    for (const control of String.fromCharCode(0x1b, 0x85, 0x2028, 0x2029)) {
      expect(result.output).not.toContain(control);
    }
    expect(result.output.trim().split("\n")).toHaveLength(1);
  });

  it("rejects more than one explicit path as a usage error", () => {
    const result = runCheck("first.md", "second.md");

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/usage/i);
  });

  it("rejects an oversized regular file before parsing it", () => {
    const measuredBytes = LEARNINGS_CONTRACT.maxTokens + 1;
    const fixture = writeFixture("oversized.md", "x".repeat(measuredBytes));

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(JSON.stringify(fixture));
    expect(result.output).toContain("maxTokens");
    expect(result.output).toContain(String(measuredBytes));
    expect(result.output).toContain(String(LEARNINGS_CONTRACT.maxTokens));
  });

  it("rejects a FIFO without blocking or reading from it", () => {
    const fixture = path.join(createTemporaryDirectory(), "learnings.fifo");
    const created = spawnSync(MKFIFO_EXECUTABLE, [fixture], {
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(created.status).toBe(0);

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(JSON.stringify(fixture));
    expect(result.output).toMatch(/regular file/i);
  });

  it("runs against the canonical default from an extracted npm pack", () => {
    const temporary = createTemporaryDirectory();
    const staging = path.join(temporary, "staging");
    const compiled = stagePackageWithFreshDist(staging, BUN_EXECUTABLE);
    expect(compiled.output).toBe("");
    expect(compiled.status).toBe(0);
    const archive = path.join(temporary, "lisa-packed.tgz");
    const packed = spawnSync(
      BUN_EXECUTABLE,
      ["pm", "pack", "--ignore-scripts", "--filename", archive, "--quiet"],
      { cwd: staging, encoding: "utf8", timeout: 30_000 }
    );
    expect(`${packed.stdout}${packed.stderr}`).toBeTruthy();
    expect(packed.status).toBe(0);

    const extracted = path.join(temporary, "extracted");
    mkdirSync(extracted);
    const extraction = spawnSync(
      TAR_EXECUTABLE,
      ["-xzf", archive, "-C", extracted],
      { encoding: "utf8", timeout: 30_000 }
    );
    expect(`${extraction.stdout}${extraction.stderr}`).toBe("");
    expect(extraction.status).toBe(0);

    const packageRoot = path.join(extracted, "package");
    expect(existsSync(path.join(packageRoot, "src"))).toBe(false);
    expect(
      existsSync(path.join(packageRoot, "dist", "core", "learnings.js"))
    ).toBe(true);
    const result = spawnSync(
      BUN_EXECUTABLE,
      [
        "--no-install",
        path.join(packageRoot, "scripts", "check-learnings-budget.ts"),
      ],
      { cwd: packageRoot, encoding: "utf8", timeout: 10_000 }
    );

    expect(`${result.stdout}${result.stderr}`).toContain(
      "learnings budget passed"
    );
    expect(result.status).toBe(0);
    // This test compiles dist, `bun pm pack`s, and tar-extracts the full
    // published surface — its cost grows with the packaged content, and it
    // already grants its own subprocesses 30s. Match that budget at the it()
    // level so a normal content addition can't tip it over the 10s default.
    // Durable decoupling from surface growth is tracked as a follow-up.
  }, 60_000);
});

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
 * Write one real learnings document to an isolated temporary directory.
 * @param fileName - Fixture basename
 * @param content - Complete learnings document
 * @returns Absolute fixture path
 */
function writeFixture(fileName: string, content: string): string {
  const filePath = path.join(createTemporaryDirectory(), fileName);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

/**
 * Allocate and remember a temporary directory for deterministic cleanup.
 * @returns Absolute temporary-directory path
 */
function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-learnings-budget-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Run the package command with the validated Bun executable.
 * @param filePaths - Optional explicit learnings-file arguments
 * @returns Exit status and combined command output
 */
function runCheck(...filePaths: readonly string[]): CommandResult {
  return runCheckWithBun(BUN_EXECUTABLE, ...filePaths);
}

/**
 * Run the checker directly with the validated Bun executable.
 * @param filePaths - Optional explicit learnings-file arguments
 * @returns Exit status and checker-owned output only
 */
function runCheckerDirect(...filePaths: readonly string[]): CommandResult {
  return runCheckerDirectWithBun(BUN_EXECUTABLE, ...filePaths);
}
