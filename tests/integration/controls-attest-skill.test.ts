/**
 * The attest skill's own commands, run for real with the built CLI inside
 * fixture repositories where Lisa was never applied (CodySwannGT/lisa#5001).
 *
 * An agent carries out the attest step, so no suite can run all of it. This
 * one runs the deterministic part: every shell command the skill writes
 * down, exactly as written and in the skill's order, with a stand-in that
 * does only what the skill tells the agent to do.
 *
 * Two things are under test. Before the enforce step: on a repository with a
 * linter and nothing that runs it, the lint requirement ends up in the audit
 * report as `exists-not-enforced`, with the change that went through as its
 * evidence. After it: the only verdict that can be presented is the one read
 * from the verdict file after its check has passed, so a verdict edited by
 * hand is never presented.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuditFinding } from "../../src/controls/audit-report-types.js";
import type { BeforeEnforceRun } from "../../src/controls/before-enforce-types.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../src/controls/verdict-types.js";
import { foundAt, reportWith } from "../helpers/control-audit-findings.js";
import { writeAuditReport } from "../helpers/control-audit-report.js";
import {
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  FAILURE_TEXT,
  PROOFS,
} from "../helpers/control-proofs.js";
import { evidenceAt, type GatesBlock } from "../helpers/control-register.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  commitInstalled,
  installCarriers,
} from "../support/carrier-install.js";
import { ATTEST_RESULT_FILES } from "../support/repository-state.js";
import { installLisaCommand } from "./support/audit-skill-run.js";
import {
  attestStep,
  BEFORE_ENFORCE_BLOCK,
  CHANGED_BLOCK,
  CHECK_BLOCK,
  PROOFS_BLOCK,
  RECONCILE_BLOCK,
  REPORT_CHECK_BLOCK,
  runAttestSkill,
  runBeforeEnforceSkill,
} from "./support/attest-skill-run.js";

useIoLatencyBudget();

const STYLE = "SI7";
const REPORT = ".lisa/audit/report.json";
const LINTER = checks(F_NONE_SOURCE);

/**
 * F-none's linter, declared to run when code is committed, with both of its
 * test changes. What supports it is the linter's own settings file, which is
 * where the audit found it.
 */
const LINTER_DECLARED: GatesBlock = {
  "code-style": {
    commit: "required",
    criteria: [STYLE],
    parts: [
      {
        scope: ".",
        command: LINTER,
        evidence: evidenceAt("ruff.toml"),
        proof: {
          violation: `${PROOFS}/lint.violation.patch`,
          clean: `${PROOFS}/lint.clean.patch`,
          failure_shape: [FAILURE_TEXT],
        },
      },
    ],
  },
};

const cleanups: (() => void)[] = [];
const lisa = { folder: "" };

/**
 * Build F-none with its linter declared and nothing installed: no hook, no
 * gate runner, no hook folder set.
 * @returns The repository's path
 */
function linterAndNoGate(): string {
  const built = buildProofFixture(LINTER_DECLARED);
  cleanups.push(built.cleanup);
  return built.repoPath;
}

/**
 * Read a JSON file of a repository.
 * @param repoPath - The repository
 * @param file - The file, from the repository root
 * @returns The parsed file
 */
function jsonOf<Shape>(repoPath: string, file: string): Shape {
  return JSON.parse(readFileSync(path.join(repoPath, file), "utf8")) as Shape;
}

beforeEach(() => {
  const installed = installLisaCommand();
  lisa.folder = installed.folder;
  cleanups.push(installed.remove);
});

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
});

describe("the attest skill before the enforce step, on a repository with a linter and no gate", () => {
  it("leaves the lint requirement in the audit report as exists-not-enforced, with the accepted change as evidence", () => {
    const repoPath = linterAndNoGate();
    writeAuditReport(
      repoPath,
      reportWith(["."], [foundAt(STYLE, ".", "ruff.toml")])
    );

    const steps = runBeforeEnforceSkill(repoPath, lisa.folder);
    const run = JSON.parse(
      attestStep(steps, BEFORE_ENFORCE_BLOCK).stdout
    ) as BeforeEnforceRun;
    const finding = jsonOf<{ readonly findings: readonly AuditFinding[] }>(
      repoPath,
      REPORT
    ).findings.find(each => each.criterion === STYLE && each.scope === ".");

    expect(steps.filter(step => step.status !== 0)).toEqual([]);
    expect(run.entries).toMatchObject([
      {
        entry_id: "code-style@.",
        result: "not-enforced",
        canary: { exit_status: 0, outcome: "accepted", moment: "commit" },
        tool: { exit_status: 1, outcome: "rejected" },
      },
    ]);
    expect(run.copy).toMatchObject({
      carriers_installed: false,
      hooks_path: null,
      hooks: [],
    });
    expect(attestStep(steps, REPORT_CHECK_BLOCK).stdout).toMatch(
      /^report-check: PASS\./u
    );
    expect(finding).toMatchObject({ state: "exists-not-enforced" });
    expect(finding?.what).toContain(
      "nothing stopped it: git commit exited 0 and the change went through"
    );
    // The offered pointers come first; what the audit itself found is kept.
    expect(
      finding?.mechanisms.flatMap(mechanism => mechanism.locators)
    ).toEqual([
      { path: ".lisa.config.json", line: 3 },
      { path: "ruff.toml", line: 1 },
      { path: "ruff.toml", line: 1 },
    ]);
  });

  it("changes nothing but the audit report, and writes no evidence, register or verdict", () => {
    const repoPath = linterAndNoGate();
    writeAuditReport(
      repoPath,
      reportWith(["."], [foundAt(STYLE, ".", "ruff.toml")])
    );

    const steps = runBeforeEnforceSkill(repoPath, lisa.folder);

    expect(attestStep(steps, CHANGED_BLOCK, 0).stdout.trim()).toBe(
      `?? ${REPORT}`
    );
    expect(attestStep(steps, CHANGED_BLOCK).stdout.trim().split("\n")).toEqual([
      `?? ${REPORT}`,
      "?? .lisa/audit/report.md",
    ]);
    expect(
      ATTEST_RESULT_FILES.filter(file => existsSync(path.join(repoPath, file)))
    ).toEqual([]);
  });
});

describe("the attest skill after the enforce step", () => {
  it("presents the verdict the file holds once its check has passed, and leaves the three result files uncommitted", async () => {
    const repoPath = linterAndNoGate();
    await installCarriers(repoPath);
    commitInstalled(repoPath);

    const { steps, presented } = runAttestSkill(repoPath, lisa.folder);
    const style = presented?.criteria.find(each => each.criterion === STYLE);

    expect(attestStep(steps, PROOFS_BLOCK).status).toBe(0);
    expect(attestStep(steps, RECONCILE_BLOCK).status).toBe(0);
    expect(attestStep(steps, CHECK_BLOCK).status).toBe(0);
    expect(presented).toEqual(jsonOf<Verdict>(repoPath, VERDICT_PATH));
    // Every declared check passed its proof (exit 0), and Level 1 is still
    // not met: the exit code of the proofs is not the Level 1 result.
    expect(presented?.result).toBe("non-conforming");
    expect(style).toMatchObject({ verdict: "conforming", rung: "exercised" });
    expect(presented?.current_until).not.toBeNull();
    expect(attestStep(steps, CHANGED_BLOCK, 0).stdout.trim()).toBe("");
    expect(attestStep(steps, CHANGED_BLOCK).stdout.trim().split("\n")).toEqual(
      ATTEST_RESULT_FILES.map(file => `?? ${file}`)
    );
  });

  it("never passes an option that reaches outside the repository when the operator did not say yes", () => {
    const { steps } = runAttestSkill(linterAndNoGate(), lisa.folder);

    expect(
      steps
        .map(step => step.block)
        .filter(block => /--pull-request|--acknowledge/u.test(block))
    ).toEqual([]);
  });

  it("does not present a verdict that was edited by hand: the check refuses it, and the proofs are run again", () => {
    const repoPath = linterAndNoGate();
    const edited = { times: 0 };

    const { steps, presented } = runAttestSkill(repoPath, lisa.folder, {
      afterProofs: () => {
        if (edited.times > 0) return;
        edited.times += 1;
        const file = path.join(repoPath, VERDICT_PATH);
        writeFileSync(
          file,
          readFileSync(file, "utf8").replace(
            '"result": "non-conforming"',
            '"result": "conforming"'
          )
        );
      },
    });

    expect(attestStep(steps, CHECK_BLOCK, 0).status).toBe(1);
    expect(attestStep(steps, CHECK_BLOCK).status).toBe(0);
    expect(presented?.result).toBe("non-conforming");
  });

  it("presents no verdict at all while the file keeps being edited", () => {
    const repoPath = linterAndNoGate();

    const { steps, presented } = runAttestSkill(repoPath, lisa.folder, {
      afterProofs: () => {
        const file = path.join(repoPath, VERDICT_PATH);
        writeFileSync(
          file,
          readFileSync(file, "utf8").replace(
            '"result": "non-conforming"',
            '"result": "conforming"'
          )
        );
      },
    });

    expect(presented).toBeNull();
    expect(jsonOf<Verdict>(repoPath, VERDICT_PATH).result).toBe("conforming");
    expect(attestStep(steps, CHECK_BLOCK).status).toBe(1);
    expect(steps.at(-1)?.block.trim()).toBe(CHECK_BLOCK);
  });
});
