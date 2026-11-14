/**
 * Contract for loading the learned planning checks
 * (CodySwannGT/lisa#4643, item 6).
 *
 * `lisa-task-decomposition` step 0 — and the validators' S18 dry-run, which
 * loads the checks the same way — used to turn every read error into "no
 * ledger" and to project over the whole ledger before keeping only planning
 * checks, so a planning check the budget dropped was never named. Step 0 now
 * runs the shipped `scripts/learnings-projection.mjs` with a planning-check
 * `--match`: it treats only `ENOENT` as "no ledger", warns once naming any
 * other error, projects over the matched entries alone, and names the ones it
 * omitted. These tests pin the step 0 command line in every copy and run the
 * source script against a missing, an unreadable and a valid ledger. The
 * surrounding guidance prose is not pinned (#4867).
 * @module tests/unit/strategies/planning-checks-ledger-read-contract
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { learningFingerprint } from "../../../src/core/learning-fingerprint.js";
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-document.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** Every skill root a runtime reads: the source plus each projection. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

/**
 * Read a repo-relative file.
 * @param relativePath - Path from the repository root
 * @returns File contents
 */
const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const PLANNING_MATCH = "^Planning \\((prd|decomposition|ready-gate|filing)\\):";
/** Path-agnostic: each runtime projection rewrites the plugin-root variable. */
const STEP_ZERO_COMMAND = `/scripts/learnings-projection.mjs" --match '${PLANNING_MATCH}'`;
const SCRIPT = path.resolve(
  "plugins/src/base/scripts/learnings-projection.mjs"
);

describe.each(SKILL_ROOTS)("learned planning checks load (%s)", root => {
  const skill = (name: string): string => read(`${root}/${name}/SKILL.md`);
  const decomposition = skill("lisa-task-decomposition");

  it("loads the planning checks through the shipped projection script", () => {
    expect(decomposition).toContain(STEP_ZERO_COMMAND);
    expect(decomposition).not.toMatch(/cat [^\n]*PROJECT_LEARNINGS/);
  });
});

describe("the step 0 command, executed (source)", () => {
  const realModule = path.resolve("src/core/learnings.ts");
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * A scratch project with an optional ledger.
   * @param ledger - Ledger contents, or undefined for none
   * @returns The project root
   */
  const project = (ledger?: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "planning-checks-"));
    dirs.push(dir);
    mkdirSync(path.join(dir, ".lisa"));
    if (ledger !== undefined) {
      writeFileSync(path.join(dir, ".lisa/PROJECT_LEARNINGS.md"), ledger);
    }
    return dir;
  };

  /**
   * Run the script from a project root, as step 0 says to.
   * @param cwd - Project root
   * @param modulePath - Learnings module to load; defaults to the source module
   * @returns Captured stdout and stderr
   */
  const run = (
    cwd: string,
    modulePath: string = realModule
  ): { stdout: string; stderr: string } => {
    const outFile = path.join(cwd, "out.txt");
    const errFile = path.join(cwd, "err.txt");
    boundedExecFileSync({
      label: "task-decomposition step 0 ledger read",
      command: "/bin/bash",
      args: ["-c", 'bun "$SCRIPT" --match "$MATCH" > "$OUT" 2> "$ERR"'],
      cwd,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? cwd,
        SCRIPT,
        MATCH: PLANNING_MATCH,
        LISA_LEARNINGS_MODULE: modulePath,
        OUT: outFile,
        ERR: errFile,
      },
    });
    return {
      stdout: readFileSync(outFile, "utf8"),
      stderr: readFileSync(errFile, "utf8"),
    };
  };

  /**
   * One valid ledger entry for a rule.
   * @param rule - The learning rule
   * @param confidence - Its confidence; defaults to low
   * @returns The entry
   */
  const entry = (
    rule: string,
    confidence: LearningEntry["confidence"] = "low"
  ): LearningEntry => {
    const fingerprint = learningFingerprint(rule);
    return {
      id: fingerprint,
      fingerprint,
      rule,
      why: "w",
      provenance: ["owner/repo#1"],
      first_learned: "2026-01-01",
      last_confirmed: "2026-01-01",
      confidence,
    };
  };

  it("is silent when there is no ledger", () => {
    expect(run(project())).toEqual({ stdout: "", stderr: "" });
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "warns, naming the error, when the ledger exists but cannot be read",
    () => {
      const dir = project("unreadable");
      chmodSync(path.join(dir, ".lisa/PROJECT_LEARNINGS.md"), 0o000);
      const { stdout, stderr } = run(dir);
      expect(stdout).toBe("");
      expect(stderr).toContain("project learnings unavailable");
      expect(stderr).toContain("EACCES");
    }
  );

  it("returns only the planning checks, with an omitted list", () => {
    const planning = entry(
      "Planning (decomposition): name the migration owner."
    );
    const other = entry("Run the formatter before committing.");
    const { stdout, stderr } = run(
      project(renderLearningsFile([planning, other]))
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      entries: [
        { id: planning.id, rule: planning.rule, why: "w", confidence: "low" },
      ],
      omitted: [],
    });
  });

  it("warns rather than reading as no ledger when the ledger is over budget", () => {
    // The ledger's own parser enforces the projection's budget, so a ledger
    // with more entries than maxEntries is malformed, not empty.
    const over = Array.from(
      { length: LEARNINGS_CONTRACT.maxEntries + 1 },
      (_, index) => JSON.stringify(entry(`Planning (prd): check ${index}.`))
    ).join("\n");
    const { stdout, stderr } = run(
      project(`# Project Learnings\n\n\`\`\`jsonl\n${over}\n\`\`\`\n`)
    );
    expect(stdout).toBe("");
    expect(stderr).toContain("project learnings unavailable");
  });

  it("names the dropped planning checks, and other learnings never displace one", () => {
    // A parseable ledger cannot overflow the projection today: the parser
    // enforces the same budget. To exercise the omitted path the real module
    // is wrapped with a reader that skips only that budget check, so the
    // real projection and the real step 0 program decide what is dropped.
    const extra = 5;
    const kept = Array.from({ length: LEARNINGS_CONTRACT.maxEntries }, (_, i) =>
      entry(`Planning (decomposition): kept check ${i}.`, "medium")
    );
    const dropped = Array.from({ length: extra }, (_, i) =>
      entry(`Planning (ready-gate): dropped check ${i}.`, "low")
    );
    const others = Array.from({ length: extra }, (_, i) =>
      entry(`Run the formatter before commit ${i}.`, "high")
    );
    const dir = project(
      [...others, ...dropped, ...kept].map(e => JSON.stringify(e)).join("\n")
    );
    const wrapper = path.join(dir, "learnings-unbounded-reader.ts");
    const real = JSON.stringify(path.resolve("src/core/learnings.ts"));
    writeFileSync(
      wrapper,
      [
        `export * from ${real};`,
        "export const parseLearningsFile = raw =>",
        '  raw.split("\\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));',
      ].join("\n")
    );
    const { stdout, stderr } = run(dir, wrapper);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as {
      entries: { id: string; rule: string }[];
      omitted: string[];
    };
    expect(result.omitted).toHaveLength(extra);
    expect(new Set(result.omitted)).toEqual(new Set(dropped.map(e => e.id)));
    expect(result.entries).toHaveLength(kept.length);
    expect(new Set(result.entries.map(c => c.id))).toEqual(
      new Set(kept.map(e => e.id))
    );
    expect(result.entries.every(c => c.rule.startsWith("Planning ("))).toBe(
      true
    );
  });
});
