import { spawnSync } from "node:child_process";
import {
  cpSync,
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
  assertChildCompleted,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-writer.js";

// Spawns `bun`, `tar`, `mkfifo`, and a real package tarball. The heaviest case
// in the file was measured at 2.70s with 7 sibling vitest processes live and a
// 1-minute load average of 10.1 on 18 cores, and at 36.6s across 12 concurrent
// runs of the same suite (79 vitest processes, load 21-42) — a 13x inflation
// from load alone. The budget is therefore a ratio rather than a number; see
// tests/helpers/io-latency-budget.ts (CodySwannGT/lisa#2490,
// CodySwannGT/lisa#2822).
//
// It used to inline `vi.setConfig` rather than call the helper, to stay under a
// 300-line `max-lines` cap the file has since outgrown anyway. It calls the
// helper now, which is also what installs the per-case margin guard.
useIoLatencyBudget();

const BUN_EXECUTABLE = resolveBunExecutable(
  process.env.npm_execpath ?? process.execPath
);
const PASSED_VERDICT = "learnings budget passed";
const NO_INSTALL = "--no-install";
const OVERFLOW_PASSED_VERDICT = "learnings overflow budget passed";
const OVERFLOW_FLAG = "--overflow";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_CHECKER = "scripts/check-learnings-budget.ts";
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

  it("checks BOTH the shipped template and this repo's ledger by default", () => {
    // #2932. The default used to be the shipped `all/create-only` template
    // alone — 0 entries, so it passed unconditionally — which made
    // `bun run check:learnings-budget` look like a gate on the ledger and act
    // like a gate on nothing. The quality job worked around it by passing the
    // resolved path explicitly and said so: "passing the real path explicitly
    // is what keeps this a gate and not a silent no-op." A default whose only
    // safe use is not using it is a trap, so the default now covers both.
    //
    // Asserted on the OUTPUT, not on an internal, because the property is
    // which files were examined. The ledger is not empty here (this repository
    // records learnings), so a run that reported only one path would be the
    // old behaviour wearing the new name.
    //
    // Counted on the VERDICT, not on the word `passed`. There are two
    // within-budget verdicts as of #3089 — `passed` and `saturated` — and this
    // repository's own ledger has been the saturated one, so matching `passed`
    // alone would fail here for a reason that has nothing to do with which
    // surfaces were examined.
    const result = runCheck();
    const verdicts = result.output
      .split("\n")
      .filter(line => /learnings budget (?:passed|saturated)/u.test(line));

    expect(result.status).toBe(0);
    // Two verdicts, and one of them must NOT be the template. Asserting only
    // that the ledger's path appears would be satisfied by the template line,
    // whose own path ends in the same `.lisa/PROJECT_LEARNINGS.md` — a
    // substring match that passes against the exact behaviour under test.
    expect(verdicts).toHaveLength(2);
    expect(
      verdicts.filter(line =>
        line.includes(path.join("all", "create-only", ".lisa"))
      )
    ).toHaveLength(1);
    expect(
      verdicts.filter(
        line => !line.includes(path.join("all", "create-only", ".lisa"))
      )
    ).toHaveLength(1);
  });

  // #3089. The ledger sat at 20/20 entries and 11924/12000 bytes and this
  // script printed `learnings budget passed`, so a full ledger and a healthy
  // one were the same line of output. They are now different words.
  it("prints a saturated verdict, at exit 0, for a ledger at the entry cap", () => {
    const fixture = writeFixture(
      "at-cap.md",
      renderLearningsFile(
        Array.from(
          { length: LEARNINGS_CONTRACT.maxEntries },
          (_unused, index) => createEntry(`at-cap-${index}`)
        )
      )
    );

    const result = runCheckerDirect(fixture);

    // Not a failure: the caps are unchanged and the document is valid. The
    // person mid-change did not fill the ledger and cannot retire from it.
    expect(result.status).toBe(0);
    expect(result.output).toContain("learnings budget saturated");
    expect(result.output).not.toContain(PASSED_VERDICT);
    expect(result.output).toContain("/lisa:learnings:audit");
  });

  // NEGATIVE CONTROL. Without this, a check that printed `saturated`
  // unconditionally would satisfy the case above.
  it("prints a plain passed verdict for a ledger with room", () => {
    const fixture = writeFixture(
      "has-room.md",
      renderLearningsFile([createEntry("has-room")])
    );

    const result = runCheckerDirect(fixture);

    expect(result.status).toBe(0);
    expect(result.output).toContain(PASSED_VERDICT);
    expect(result.output).not.toContain("saturated");
  });

  it("accepts an absent resolved overflow as an explicit no-op verdict", () => {
    const result = runCheckerDirect(OVERFLOW_FLAG);

    expect(result.status).toBe(0);
    expect(result.output).toContain("no learnings overflow file");
    expect(result.output).toContain("PROJECT_LEARNINGS.overflow.md");
  });

  it("checks a relocated overflow from staged source with no dependencies installed", () => {
    const root = createTemporaryDirectory();
    stageSourceChecker(root);
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      `${JSON.stringify({ learnings: { file: "docs/LEARNINGS.md" } })}\n`,
      "utf8"
    );
    const overflow = path.join(root, "docs", "LEARNINGS.overflow.md");
    mkdirSync(path.dirname(overflow), { recursive: true });
    writeFileSync(
      overflow,
      renderLearningsFile([createEntry("relocated-overflow")]),
      "utf8"
    );

    const result = runStagedSourceChecker(root, OVERFLOW_FLAG);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(OVERFLOW_PASSED_VERDICT);
    expect(result.stdout).toContain("docs/LEARNINGS.overflow.md");
    expect(result.stdout).not.toContain("all/create-only");
    expect(result.stderr).toBe("");
  });

  it.each([
    ["../escape.md", "path traversal"],
    [".claude/rules/LEARNINGS.md", "auto-loaded"],
  ])(
    "rejects unsafe configured overflow source path %s without dependencies installed",
    (configuredPath, diagnostic) => {
      const root = createTemporaryDirectory();
      stageSourceChecker(root);
      writeFileSync(
        path.join(root, ".lisa.config.json"),
        `${JSON.stringify({ learnings: { file: configuredPath } })}\n`,
        "utf8"
      );

      const result = runStagedSourceChecker(root, OVERFLOW_FLAG);

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(diagnostic);
      expect(result.stdout).not.toContain(OVERFLOW_PASSED_VERDICT);
    }
  );

  // VACUITY GUARD. A source checkout commits its ledger, so an absent one means
  // the resolver drifted off it — and the old behaviour printed `no learnings
  // file` and exited 0, which the CI marker grep accepts as a green verdict.
  // An inspection of nothing then looked exactly like a healthy ledger, the
  // same shape that let this gate check only a 0-entry template for a release
  // (#2932). Staged as a real source-shaped tree, because the script decides
  // from what is on disk beside it.
  it("fails rather than reporting all-clear when a source checkout has no ledger", () => {
    const root = createTemporaryDirectory();
    stageSourceChecker(root);

    const staged = spawnSync(
      BUN_EXECUTABLE,
      [NO_INSTALL, path.join(root, SOURCE_CHECKER)],
      { cwd: root, encoding: "utf8", timeout: ioLatencyBudgetMs(10_000) }
    );
    assertChildCompleted(
      staged,
      "staged source-tree check-learnings-budget.ts"
    );
    const output = `${staged.stdout}${staged.stderr}`;

    expect(staged.status).toBe(1);
    expect(output).toContain("resolved ledger does not exist");
    // The template still parsed fine, so without the guard this run would have
    // ended on a green `learnings budget passed` line for the template alone.
    expect(output).toContain("source checkout");
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
    // Overrun the byte budget without tripping the entry cap first: a handful
    // of within-entry-cap entries whose bytes exceed the derived maxTokens.
    const content = renderLearningsFile(
      Array.from({ length: 5 }, (_unused, index) =>
        createEntry(`token-heavy-${index}`, { why: "x".repeat(3000) })
      )
    );
    const measuredTokens = Buffer.byteLength(content, "utf8");
    // Guard the fixture stays a maxTokens case (over bytes, under entry cap).
    expect(measuredTokens).toBeGreaterThan(LEARNINGS_CONTRACT.maxTokens);
    const fixture = writeFixture("over-tokens.md", content);

    const result = runCheck(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(fixture);
    expect(result.output).toContain("maxTokens");
    expect(result.output).toContain(String(measuredTokens));
    expect(result.output).toContain(String(LEARNINGS_CONTRACT.maxTokens));
  });

  it("fits a full ledger of real-sized entries once the byte budget derives from the entry cap (#1959 R1)", () => {
    // A full ledger (maxEntries) of realistic ~466 B entries totals ~9.3 KB:
    // above the retired flat 4000 B cap but below the derived budget
    // (maxEntries * PER_ENTRY_BYTE_ALLOWANCE = 14900 B). On the old flat cap
    // this FAILS maxTokens though entry count == maxEntries; once the byte
    // budget derives from the entry cap, a full ledger of real entries fits.
    const RETIRED_FLAT_BUDGET = 4000;
    const DERIVED_BUDGET = LEARNINGS_CONTRACT.maxTokens;
    const entries = Array.from(
      { length: LEARNINGS_CONTRACT.maxEntries },
      (_unused, index) => realisticEntry(index)
    );
    const content = renderLearningsFile(entries);
    const measured = Buffer.byteLength(content, "utf8");
    expect(entries.length).toBe(LEARNINGS_CONTRACT.maxEntries);
    expect(measured).toBeGreaterThan(RETIRED_FLAT_BUDGET);
    expect(measured).toBeLessThan(DERIVED_BUDGET);
    const fixture = writeFixture("full-real-ledger.md", content);

    const result = runCheck(fixture);

    expect(result.status).toBe(0);
    expect(result.output).not.toContain("maxTokens exceeded");

    // Boundary: maxTokens gates the WHOLE rendered document (entries + jsonl
    // framing), not just summed entry bytes, and it is an average allowance,
    // not a per-entry cap. Pad one entry's why so the document lands on exactly
    // maxTokens and confirm it still passes — the paired "over maxTokens" test
    // below proves one byte more fails. This exercises the ceiling itself,
    // closing the earlier ~2.7 KB-of-slack gap.
    const pad = LEARNINGS_CONTRACT.maxTokens - measured;
    entries[0] = { ...entries[0], why: `${entries[0].why}${"x".repeat(pad)}` };
    const atLimit = renderLearningsFile(entries);
    expect(Buffer.byteLength(atLimit, "utf8")).toBe(
      LEARNINGS_CONTRACT.maxTokens
    );
    expect(runCheck(writeFixture("at-token-limit.md", atLimit)).status).toBe(0);
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
      timeout: ioLatencyBudgetMs(2_000),
    });
    assertChildCompleted(created, "mkfifo");
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
      {
        cwd: staging,
        encoding: "utf8",
        timeout: ioLatencyBudgetMs(30_000),
      }
    );
    assertChildCompleted(packed, "bun pm pack");
    expect(`${packed.stdout}${packed.stderr}`).toBeTruthy();
    expect(packed.status).toBe(0);

    const extracted = path.join(temporary, "extracted");
    mkdirSync(extracted);
    const extraction = spawnSync(
      TAR_EXECUTABLE,
      ["-xzf", archive, "-C", extracted],
      { encoding: "utf8", timeout: ioLatencyBudgetMs(30_000) }
    );
    assertChildCompleted(extraction, "tar -xzf");
    expect(`${extraction.stdout}${extraction.stderr}`).toBe("");
    expect(extraction.status).toBe(0);

    const packageRoot = path.join(extracted, "package");
    expect(existsSync(path.join(packageRoot, "src"))).toBe(false);
    const closureModules = [
      "learnings-budget-check.js",
      "learnings-contract.js",
      "configured-learnings-path.js",
      "learnings-document.js",
      "learnings-entry.js",
      "learnings-location.js",
      "learnings-overflow-path.js",
      "safe-relative-markdown-path.js",
    ] as const;
    for (const moduleName of closureModules) {
      expect(
        existsSync(path.join(packageRoot, "dist", "core", moduleName))
      ).toBe(true);
    }
    expect(existsSync(path.join(packageRoot, "dist", "core", "lisa.js"))).toBe(
      false
    );
    const result = spawnSync(
      BUN_EXECUTABLE,
      [NO_INSTALL, path.join(packageRoot, SOURCE_CHECKER)],
      {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: ioLatencyBudgetMs(10_000),
      }
    );

    // The assertion below reads the child's stdout, so a killed child makes it
    // lie: 12 of 12 concurrent runs reported "expected '' to contain 'learnings
    // budget passed'" when the cause was this child's own fixed 10s budget.
    assertChildCompleted(result, "packed check-learnings-budget.ts");
    expect(`${result.stdout}${result.stderr}`).toContain(PASSED_VERDICT);
    expect(result.status).toBe(0);

    const overflow = spawnSync(
      BUN_EXECUTABLE,
      [NO_INSTALL, path.join(packageRoot, SOURCE_CHECKER), OVERFLOW_FLAG],
      {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: ioLatencyBudgetMs(10_000),
      }
    );
    assertChildCompleted(overflow, "packed overflow check");
    expect(overflow.stdout).toContain("no learnings overflow file");
    expect(overflow.stderr).toBe("");
    expect(overflow.status).toBe(0);
  });
});

/** Copy the dependency-free source checker closure into an isolated tree. */
function stageSourceChecker(root: string): void {
  for (const relative of [
    SOURCE_CHECKER,
    "src/core/learnings-budget-check.ts",
    "src/core/learnings-contract.ts",
    "src/core/configured-learnings-path.ts",
    "src/core/learnings-document.ts",
    "src/core/learnings-entry.ts",
    "src/core/learnings-location.ts",
    "src/core/learnings-overflow-path.ts",
    "src/core/safe-relative-markdown-path.ts",
    "all/create-only/.lisa/PROJECT_LEARNINGS.md",
  ]) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(REPO_ROOT, relative), target);
  }
}

/** Run a staged source checker without package installation. */
function runStagedSourceChecker(
  root: string,
  ...arguments_: readonly string[]
): ReturnType<typeof spawnSync> {
  const result = spawnSync(
    BUN_EXECUTABLE,
    [NO_INSTALL, path.join(root, SOURCE_CHECKER), ...arguments_],
    { cwd: root, encoding: "utf8", timeout: ioLatencyBudgetMs(10_000) }
  );
  assertChildCompleted(result, "staged source check-learnings-budget.ts");
  return result;
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
 * Build one schema-valid entry sized like a real captured learning (~466 B):
 * a near-cap single-line rule, a causal `why`, and two provenance refs. Twenty
 * of these total ~9.3 KB — the #1959 repro band above the retired flat cap and
 * below the derived budget.
 * @param index - Position used to keep ids and one provenance ref unique
 * @returns Realistic learning entry for the full-ledger fixture
 */
function realisticEntry(index: number): LearningEntry {
  const suffix = String(index).padStart(2, "0");
  return {
    id: `learning-realistic-${suffix}`,
    fingerprint: `learning-realistic-fingerprint-${suffix}`,
    rule:
      "prefer a derived learnings byte budget over a flat hardcoded cap so the " +
      "entry count and the byte ceiling can never contradict one another",
    why:
      "the two independently hardcoded caps bound the ledger near eight entries, " +
      "stranding valid captures far under the twenty-entry ceiling",
    provenance: ["CodySwannGT/lisa#1959", `CodySwannGT/lisa#${1500 + index}`],
    first_learned: "2026-07-01",
    last_confirmed: "2026-07-23",
    confidence: "high",
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
