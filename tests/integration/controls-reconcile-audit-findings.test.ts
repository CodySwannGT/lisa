/**
 * The findings `lisa controls reconcile` offers in the audit report's shape
 * (CodySwannGT/lisa#5000).
 *
 * The command never writes the audit report. It prints findings that are
 * already in the report's finding shape, so the step that owns the report
 * can take them up. That promise is only worth something if the report's own
 * check accepts them, so every case here puts the offered findings into a
 * complete report, in the places they name, and runs
 * `lisa controls report-check` on it.
 * @module tests/integration/controls-reconcile-audit-findings
 */
import { appendFileSync, rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AuditFinding } from "../../src/controls/audit-report.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../src/controls/catalogue.js";
import { runRegister } from "../../src/controls/commands/register.js";
import { CONTROL_REGISTER_CRITERION } from "../../src/controls/reconcile-types.js";
import {
  completeAuditReport,
  writeAuditReport,
} from "../helpers/control-audit-report.js";
import { buildDeclaredFixture } from "../helpers/control-register.js";
import {
  evidencedPart,
  LINT,
  reconcile,
  resultOf,
  wiredRepository,
} from "../support/reconcile-run.js";
import { check } from "../unit/controls/support/report-check-run.js";

const SCAN = "npm audit --omit=dev";
const STYLE = "SI7";
const REGISTER = ".lisa/controls/register.json";
const DECLARATION = ".lisa.config.json";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build a wired repository, then delete its commit carrier and add a command
 * to its push hook.
 * @returns The repository's root
 */
async function broken(): Promise<string> {
  const repository = await wiredRepository();
  const root = repository.fixture.repoPath;
  cleanups.push(repository.cleanup);
  rmSync(path.join(root, ".lisa/hooks/pre-commit"));
  appendFileSync(path.join(root, ".lisa/hooks/pre-push"), `${SCAN}\n`);
  return root;
}

/**
 * Put offered findings into a complete report, each in the place it names,
 * and run the report's own check on it.
 * @param root - The repository
 * @param offered - The findings the command offered
 * @param scopes - The parts the report covers
 * @returns What the check printed for a person, and its exit code
 */
async function checked(
  root: string,
  offered: readonly AuditFinding[],
  scopes: readonly string[] = ["."]
): Promise<{ readonly code: number; readonly stderr: readonly string[] }> {
  const report = completeAuditReport(scopes);
  const placed = (finding: Readonly<Record<string, unknown>>): boolean =>
    offered.some(
      each =>
        each.criterion === finding.criterion && each.scope === finding.scope
    );
  expect(report.findings.filter(placed)).toHaveLength(offered.length);
  writeAuditReport(root, {
    ...report,
    findings: [
      ...report.findings.filter(finding => !placed(finding)),
      ...offered,
    ],
  });
  return check(root);
}

describe("the findings reconcile offers the audit report", () => {
  it("are none when the register and what is installed are in step", async () => {
    const repository = await wiredRepository();
    cleanups.push(repository.cleanup);

    const run = await reconcile(repository.fixture.repoPath);

    expect(resultOf(run).audit_findings).toEqual([]);
  });

  it("name the register requirement and each requirement the unwired rule serves", async () => {
    const offered = resultOf(await reconcile(await broken())).audit_findings;

    expect(
      offered.map(finding => [finding.criterion, finding.scope, finding.state])
    ).toEqual([
      [CONTROL_REGISTER_CRITERION, ".", "exists-not-enforced"],
      [STYLE, ".", "exists-not-enforced"],
    ]);
    expect(offered[0]?.mechanisms).toEqual([
      {
        command: null,
        locators: [{ line: 1, path: DECLARATION }],
        moment: "none",
        tool: "lisa controls register",
      },
      {
        command: SCAN,
        locators: [{ line: 17, path: ".lisa/hooks/pre-push" }],
        moment: "push",
        tool: "npm",
      },
    ]);
    expect(offered[1]?.mechanisms).toEqual([
      {
        command: null,
        locators: [{ line: 3, path: DECLARATION }],
        moment: "none",
        tool: "ruff",
      },
    ]);
  });

  it("are accepted by the report's own check, in the places they name", async () => {
    const root = await broken();
    const offered = resultOf(await reconcile(root)).audit_findings;

    const { code, stderr } = await checked(root, offered);

    expect(stderr).toEqual([]);
    expect(code).toBe(0);
  });

  it("point at the rule's entry once the register is committed", async () => {
    const root = await broken();
    const quiet = { stderr: () => undefined, stdout: () => undefined };
    expect(await runRegister(root, {}, quiet)).toBe(0);

    const run = await reconcile(root);
    const style = resultOf(run).audit_findings.find(
      finding => finding.criterion === STYLE
    );

    expect(resultOf(run).register.committed).toBe("current");
    expect(style?.mechanisms[0]?.locators[0]?.path).toBe(REGISTER);
    expect((await checked(root, resultOf(run).audit_findings)).code).toBe(0);
  });

  it("say where a rule still runs when only one of its points is gone", async () => {
    const repository = await wiredRepository({
      "code-style": {
        commit: "required",
        "pull-request": {
          executor: { path: ".gitlab-ci.yml", platform: "gitlab" },
          level: "required",
        },
        criteria: [STYLE],
        parts: [evidencedPart(LINT)],
      },
    });
    cleanups.push(repository.cleanup);

    const run = await reconcile(repository.fixture.repoPath);
    const style = resultOf(run).audit_findings.find(
      finding => finding.criterion === STYLE
    );

    expect(style?.mechanisms).toEqual([
      {
        command: LINT.join(" "),
        locators: [{ line: 3, path: DECLARATION }],
        moment: "commit",
        tool: "ruff",
      },
    ]);
  });

  it("place a requirement answered per part under the rule's own folder", async () => {
    const built = buildDeclaredFixture("F-mixed");
    cleanups.push(built.cleanup);

    const offered = resultOf(await reconcile(built.repoPath)).audit_findings;

    expect(
      offered
        .filter(finding => finding.criterion === STYLE)
        .map(finding => finding.scope)
    ).toEqual(["api", "web"]);
    expect(
      (await checked(built.repoPath, offered, [".", "api", "web"])).code
    ).toBe(0);
  });
});

describe("the requirement a control register answers", () => {
  it("is in scope and answered once for the repository", () => {
    expect(
      inScopeCriteria(loadCriterionCatalogue()).find(
        criterion => criterion.id === CONTROL_REGISTER_CRITERION
      )?.answered
    ).toBe("repository");
  });
});
