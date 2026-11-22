/**
 * `lisa controls report-check`, run as the built command inside a repository
 * Lisa was never applied to.
 *
 * The unit suites run the check from source. This one runs the built artifact
 * with the fixture repository as its working directory, which is how the audit
 * skill calls it: the criterion catalogue has to come from the package the
 * command was installed with, because the host repository has no `spec/`
 * folder, no `.lisa.config.json` and no `package.json` (CodySwannGT/lisa#4978).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildFNone,
  controlAuditGitEnv,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  amendFinding,
  completeAuditReport,
  writeAuditReport,
} from "../helpers/control-audit-report.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const REPORT_MD = path.join(".lisa", "audit", "report.md");

const fixtures: ControlAuditFixture[] = [];

/**
 * Build F-none with a report in it.
 * @param report - The report the audit left behind
 * @returns The repository root
 */
function repositoryWith(report: unknown): string {
  const built = buildFNone();
  fixtures.push(built);
  writeAuditReport(built.repoPath, report);
  return built.repoPath;
}

/**
 * Run the built command from inside a repository, with no path argument.
 * @param repoPath - The repository to stand in
 * @returns Exit status and both streams
 */
function reportCheck(repoPath: string): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const child = boundedSpawnSync({
    label: "lisa controls report-check (built CLI in F-none)",
    command: process.execPath,
    args: [DIST_CLI, "controls", "report-check"],
    cwd: repoPath,
    env: { ...controlAuditGitEnv(), LISA_SKIP_UPDATE_CHECK: "1" },
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("built lisa controls report-check in a repository without Lisa", () => {
  it("passes a complete report using the catalogue from its own package", () => {
    const repoPath = repositoryWith(completeAuditReport());

    const result = reportCheck(repoPath);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /^report-check: PASS\. \d+ findings across 1 part/u
    );
    expect(existsSync(path.join(repoPath, "spec"))).toBe(false);
    expect(existsSync(path.join(repoPath, ".lisa.config.json"))).toBe(false);
    const markdown = readFileSync(path.join(repoPath, REPORT_MD), "utf8");
    expect(markdown).toContain("## Whole repository");
    expect(markdown).toContain("**Evidence still needed:**");
    expect(markdown).toContain("The minimum evidence rung is observed.");
    expect(markdown).toContain("The minimum evidence rung is exercised.");
  });

  it("refuses a proved finding with no evidence record, one line per problem", () => {
    const report = completeAuditReport();
    const criterion = String(report.findings[0]?.criterion);
    const repoPath = repositoryWith(
      amendFinding(
        report,
        { criterion, scope: "." },
        {
          state: "proved",
          mechanisms: [
            {
              tool: "ruff",
              command: null,
              moment: "none",
              locators: [{ path: "ruff.toml", line: 1 }],
            },
          ],
        }
      )
    );

    const result = reportCheck(repoPath);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n")).toEqual([
      expect.stringContaining(`(requirement ${criterion}, whole repository)`),
      expect.stringMatching(/^report-check: FAIL\. 1 problem in /u),
    ]);
    expect(existsSync(path.join(repoPath, REPORT_MD))).toBe(false);
  });
});
