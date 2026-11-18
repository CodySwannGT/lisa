/**
 * Enforce gives every Level 1 requirement exactly one outcome, lists the
 * required checks that fail on the default branch as it stands, and changes
 * nothing when it is run a second time.
 *
 * An agent carries out the enforce step, so no suite can run all of it. This
 * one runs the deterministic part for real: every shell command the enforce
 * skill writes down, exactly as written and in order, using the built CLI,
 * inside a fixture repository where Lisa was never applied and that has no
 * `package.json`. A stand-in does what only the agent does: it names the
 * coding agents and writes the ticket flow's results
 * (CodySwannGT/lisa#4994, R32, R35 and R38).
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../src/controls/catalogue.js";
import { ENFORCE_OUTCOMES } from "../../src/controls/enforce-types.js";
import {
  runControlAuditGit,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import { writeAuditReport } from "../helpers/control-audit-report.js";
import { configFile } from "../helpers/control-register.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { repositoryState } from "../support/repository-state.js";
import {
  CLEAN,
  LINT_COMMAND,
  LINT_FAILURE,
  VIOLATION,
  buildLintedRepository,
  lintGates,
} from "../unit/controls/support/enforce-repository.js";
import { FOUND_STYLE } from "../unit/controls/support/enforce-run.js";
import { installLisaCommand } from "./support/audit-skill-run.js";
import {
  CHANGED_BLOCK,
  AUDIT_BLOCK,
  DECLARATION_CHECK_BLOCK,
  INSTALL_BLOCK,
  REGISTER_BLOCK,
  REPORT_BLOCK,
  enforceStep,
  reportOf,
  runEnforceSkillCommands,
  type EnforceSkillRun,
} from "./support/enforce-skill-run.js";

useIoLatencyBudget();

const IN_SCOPE = inScopeCriteria(loadCriterionCatalogue());
const STYLE = "SI7";
const ENTRY = "code-style@.";
const CONFIG = ".lisa.config.json";

/** What the configure step declared: one check, at commit and after an edit. */
const DECLARED = lintGates({ "post-tool": "required" });

/** The coding agents the stand-in names: one that can refuse a write, one that cannot. */
const AGENTS = "claude,agy";

const fixtures: ControlAuditFixture[] = [];
const lisa = { folder: "", remove: (): void => undefined };

beforeEach(() => {
  Object.assign(lisa, installLisaCommand());
});

afterEach(() => {
  lisa.remove();
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

/**
 * Build F-none as the audit and configure steps leave it: a check declared
 * and an audit report written, neither committed.
 * @param linted - What the checked file holds on the default branch
 * @param audited - Whether the audit has been run
 * @returns The repository root
 */
function configured(linted: string, audited = true): string {
  const built = buildLintedRepository(linted, {});
  const { repoPath } = built;
  fixtures.push(built);
  runControlAuditGit(repoPath, ["rm", "--quiet", "--cached", CONFIG]);
  runControlAuditGit(repoPath, ["commit", "--quiet", "-m", "no declaration"]);
  writeFileSync(path.join(repoPath, CONFIG), configFile(DECLARED));
  if (audited) writeAuditReport(repoPath, FOUND_STYLE);
  return repoPath;
}

/**
 * Run the skill's commands with the stand-in agent.
 * @param repoPath - The repository
 * @returns The run
 */
function enforce(repoPath: string): EnforceSkillRun {
  return runEnforceSkillCommands(repoPath, lisa.folder, { agents: AGENTS });
}

describe("enforce on F-none: exactly one outcome per requirement", () => {
  it("reports as many outcomes as there are requirements, and none twice", () => {
    const run = enforce(configured(CLEAN));
    const report = reportOf(run);

    expect(enforceStep(run.steps, REPORT_BLOCK).status).toBe(0);
    expect(report.requirements).toBe(IN_SCOPE.length);
    expect(report.criteria.map(row => row.criterion)).toEqual(
      IN_SCOPE.map(criterion => criterion.id)
    );
    expect(
      ENFORCE_OUTCOMES.reduce((sum, outcome) => sum + report.counts[outcome], 0)
    ).toBe(IN_SCOPE.length);
  });

  it("is wired for the declared check, and waits on a tracker for everything that is missing", () => {
    const report = reportOf(enforce(configured(CLEAN)));
    const style = report.criteria.find(row => row.criterion === STYLE);

    expect(style?.outcome).toBe("wired");
    expect(report.entries.map(entry => [entry.id, entry.outcome])).toEqual([
      [ENTRY, "wired"],
    ]);
    expect(report.counts).toEqual({
      blocked: IN_SCOPE.length - 1,
      ticketed: 0,
      wired: 1,
      "nothing-to-enforce": 0,
    });
  });

  it("says which coding agent cannot be enforced on, and has the register record it", () => {
    const repoPath = configured(CLEAN);
    const report = reportOf(enforce(repoPath));
    const edit = report.entries[0]?.points.find(
      point => point.moment === "post-tool"
    );

    expect(edit?.state).toBe("wired");
    expect(edit?.reason).toContain("run on claude");
    expect(report.limits.join("\n")).toContain(
      "agy has no hook that can refuse a file write"
    );
  });

  it("really runs the declared check at commit afterwards", () => {
    const repoPath = configured(CLEAN);
    enforce(repoPath);
    writeFileSync(
      path.join(repoPath, "src", "fixture_none", "linted.txt"),
      VIOLATION
    );
    runControlAuditGit(repoPath, ["add", "src/fixture_none/linted.txt"]);

    expect(() =>
      runControlAuditGit(repoPath, ["commit", "--quiet", "-m", "break it"])
    ).toThrow();
  });
});

describe("enforce on F-none with existing lint violations", () => {
  it("lists the lint check as currently failing, with what its command printed", () => {
    const { currently_failing: failing } = reportOf(
      enforce(configured(VIOLATION))
    );

    expect(failing.measured).toBe(true);
    expect(failing.head).toMatchObject({ branch: "main" });
    expect(failing.gates).toEqual([
      expect.objectContaining({
        entry_id: ENTRY,
        gate: "code-style",
        command: [...LINT_COMMAND],
        exit_status: 1,
      }),
    ]);
    expect(failing.gates[0]?.output_excerpt).toContain(LINT_FAILURE);
  });

  it("lists nothing as failing when the default branch passes", () => {
    const { currently_failing: failing } = reportOf(enforce(configured(CLEAN)));

    expect(failing.measured).toBe(true);
    expect(failing.checked).toBe(1);
    expect(failing.gates).toEqual([]);
  });
});

describe("enforce run a second time with no change to the declaration", () => {
  it("reports zero changes and leaves the working tree as the first run left it", () => {
    const repoPath = configured(VIOLATION);
    const first = enforce(repoPath);
    const { index: _refreshed, ...afterFirst } = repositoryState(repoPath);

    const second = enforce(repoPath);
    const { index: _again, ...afterSecond } = repositoryState(repoPath);

    expect(reportOf(first).changes.length).toBeGreaterThan(0);
    expect(reportOf(second).changes).toEqual([]);
    expect(enforceStep(second.steps, REGISTER_BLOCK).stdout).toContain(
      "is already up to date"
    );
    expect(afterSecond).toEqual(afterFirst);
    expect(enforceStep(second.steps, CHANGED_BLOCK).stdout).toBe(
      enforceStep(first.steps, CHANGED_BLOCK).stdout
    );
  });

  it("gives every requirement the same outcome as the first run", () => {
    const repoPath = configured(VIOLATION);
    const first = reportOf(enforce(repoPath));

    const second = reportOf(enforce(repoPath));

    expect(second.criteria.map(row => [row.criterion, row.outcome])).toEqual(
      first.criteria.map(row => [row.criterion, row.outcome])
    );
    expect(second.currently_failing.gates.map(gate => gate.entry_id)).toEqual(
      first.currently_failing.gates.map(gate => gate.entry_id)
    );
  });
});

describe("what an enforce run leaves outside the repository", () => {
  it("removes the folder its results were saved in", () => {
    const run = enforce(configured(CLEAN));

    expect(run.results).not.toBe("");
    expect(run.cleared).toBe(true);
  });

  it("keeps that folder outside the repository", () => {
    const repoPath = configured(CLEAN);
    const run = enforce(repoPath);

    expect(run.results.startsWith(`${repoPath}${path.sep}`)).toBe(false);
  });
});

describe("enforce before the audit has been run", () => {
  it("stops at the first check and installs nothing", () => {
    const repoPath = configured(CLEAN, false);

    const run = enforce(repoPath);

    expect(enforceStep(run.steps, AUDIT_BLOCK).status).toBe(1);
    expect(run.steps.at(-1)?.block).toContain(AUDIT_BLOCK);
    expect(
      run.steps.some(step => step.block.includes(DECLARATION_CHECK_BLOCK))
    ).toBe(false);
    expect(run.steps.some(step => step.block.includes(INSTALL_BLOCK))).toBe(
      false
    );
    expect(existsSync(path.join(repoPath, "scripts"))).toBe(false);
    expect(runControlAuditGit(repoPath, ["status", "--porcelain"]).trim()).toBe(
      `?? ${CONFIG}`
    );
  });
});
