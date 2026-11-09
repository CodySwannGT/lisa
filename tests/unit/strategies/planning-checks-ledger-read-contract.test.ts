/**
 * Contract for loading the learned planning checks
 * (CodySwannGT/lisa#4643, item 6).
 *
 * `lisa-task-decomposition` step 0 — and the validators' S18 dry-run, which
 * loads the checks the same way — used to turn every read error into "no
 * ledger" and to project over the whole ledger before keeping only planning
 * checks, so a planning check the budget dropped was never named. The
 * corrected command treats only `ENOENT` as "no ledger", warns once naming any
 * other error, projects over the planning checks alone, and names the ones it
 * omitted. These tests pin the text in every copy and run the source command
 * against a missing, an unreadable and a valid ledger.
 * @module tests/unit/strategies/planning-checks-ledger-read-contract
 */
import { execFileSync } from "node:child_process";
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
import type { LearningEntry } from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-document.js";

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

const VALIDATORS = [
  "lisa-jira-validate-ticket",
  "lisa-github-validate-issue",
  "lisa-linear-validate-issue",
] as const;

/** Every checked-in copy of the definition-of-ready rule. */
const READY_RULES = [
  "plugins/src/base/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-copilot/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-devin/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-cursor/rules/work-item-definition-of-ready-reference.mdc",
] as const;

const UNREADABLE =
  "a ledger it cannot read prints one warning naming the error";
const OMITTED = "names each planning check the projection omitted, by id";

/**
 * Read a repo-relative file.
 * @param relativePath - Path from the repository root
 * @returns File contents
 */
const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * The step 0 `node -e` program from a decomposition skill copy.
 * @param skill - The skill text
 * @returns The JavaScript passed to `node -e`
 */
const stepZeroProgram = (skill: string): string =>
  /node -e '([\s\S]*?)' \|\| true/.exec(skill)?.[1] ?? "";

describe.each(SKILL_ROOTS)("learned planning checks load (%s)", root => {
  const skill = (name: string): string => read(`${root}/${name}/SKILL.md`);
  const decomposition = skill("lisa-task-decomposition");
  const program = stepZeroProgram(decomposition);

  it("treats only ENOENT as no ledger", () => {
    expect(program).toContain('error.code === "ENOENT"');
    expect(program).not.toContain(".catch(() => null)");
  });

  it("projects over the planning checks alone and names the omitted ones", () => {
    const filter = program.indexOf(
      ".filter(e => /^Planning \\((prd|decomposition|ready-gate|filing)\\):/.test(e.rule))"
    );
    expect(filter).toBeGreaterThan(-1);
    expect(filter).toBeLessThan(program.indexOf("m.projectLearnings("));
    expect(program).toContain("JSON.stringify({ checks, omitted })");
    expect(program).not.toContain("omittedCount");
  });

  it("explains the three outcomes in the step 0 prose", () => {
    expect(decomposition).toContain(
      "No output means there is no ledger yet (`ENOENT`): carry on."
    );
    expect(decomposition).toContain(
      "A ledger that exists but cannot be read, or is malformed, prints one warning naming the error and yields nothing: carry on without it."
    );
    expect(decomposition).toContain("`omitted` lists, by id,");
    expect(decomposition).not.toContain(
      "No output means there is no ledger yet: carry on."
    );
  });

  it.each(VALIDATORS)("%s S18 uses the corrected command", validator => {
    const s18 = skill(validator).split("S18 — Stateless-pickup dry-run")[1];
    expect(s18).toContain(UNREADABLE);
    expect(s18).toContain(OMITTED);
  });
});

describe.each(READY_RULES)("definition of ready S18 (%s)", rulePath => {
  it("points at the corrected step 0 command", () => {
    const rule = read(rulePath).replace(/\s+/g, " ");
    expect(rule).toContain(UNREADABLE);
    expect(rule).toContain(OMITTED);
  });
});

describe("the step 0 command, executed (source)", () => {
  const program = stepZeroProgram(
    read("plugins/src/base/skills/lisa-task-decomposition/SKILL.md")
  ).replace(
    'import("@codyswann/lisa/learnings")',
    `import(${JSON.stringify(path.resolve("src/core/learnings.ts"))})`
  );
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
   * Run the program from a project root, as step 0 says to.
   * @param cwd - Project root
   * @returns Captured stdout and stderr
   */
  const run = (cwd: string): { stdout: string; stderr: string } => {
    const outFile = path.join(cwd, "out.txt");
    const errFile = path.join(cwd, "err.txt");
    execFileSync(
      "/bin/bash",
      ["-c", 'bun --eval "$PROGRAM" > "$OUT" 2> "$ERR"'],
      {
        cwd,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? cwd,
          PROGRAM: program,
          OUT: outFile,
          ERR: errFile,
        },
      }
    );
    return {
      stdout: readFileSync(outFile, "utf8"),
      stderr: readFileSync(errFile, "utf8"),
    };
  };

  /**
   * One valid ledger entry for a rule.
   * @param rule - The learning rule
   * @returns The entry
   */
  const entry = (rule: string): LearningEntry => {
    const fingerprint = learningFingerprint(rule);
    return {
      id: fingerprint,
      fingerprint,
      rule,
      why: "w",
      provenance: ["owner/repo#1"],
      first_learned: "2026-01-01",
      last_confirmed: "2026-01-01",
      confidence: "low",
    };
  };

  it("is silent when there is no ledger", () => {
    expect(program).not.toBe("");
    expect(run(project())).toEqual({ stdout: "", stderr: "" });
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "warns, naming the error, when the ledger exists but cannot be read",
    () => {
      const dir = project("unreadable");
      chmodSync(path.join(dir, ".lisa/PROJECT_LEARNINGS.md"), 0o000);
      const { stdout, stderr } = run(dir);
      expect(stdout).toBe("");
      expect(stderr).toContain("learned planning checks unavailable");
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
      checks: [{ id: planning.id, rule: planning.rule, confidence: "low" }],
      omitted: [],
    });
  });
});
