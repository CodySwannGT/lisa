/**
 * `lisa controls gaps`, run as the built command inside a repository Lisa was
 * never applied to.
 *
 * The unit suites run the command from source. This one runs the built
 * artifact with the fixture repository as its working directory, which is how
 * the enforce step calls it. It covers the two things the ticket flow rests
 * on: the markers are the same on every run, so a second run finds the first
 * run's tickets; and a repository with no tracker gets every missing
 * requirement back as blocked, with nothing filed (CodySwannGT/lisa#4992).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildFNone,
  controlAuditGitEnv,
  runControlAuditGit,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  completeAuditReport,
  dropFinding,
  reportMissing,
  writeAuditReport,
} from "../helpers/control-audit-report.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const REPORT_JSON = ".lisa/audit/report.json";

const CRITERIA = completeAuditReport().findings.map(finding =>
  String(finding.criterion)
);
const TWO_MISSING = [
  { criterion: String(CRITERIA[0]), scope: "." },
  { criterion: String(CRITERIA[1]), scope: "." },
] as const;

const fixtures: ControlAuditFixture[] = [];

/** The part of the output these cases read. */
interface Printed {
  readonly tracker: {
    readonly configured: boolean;
    readonly problem: string | null;
  };
  readonly gaps: readonly {
    readonly criterion: string;
    readonly marker: string;
    readonly outcome: string | null;
  }[];
}

/**
 * Build F-none with a report in it and, when given, a tracker setting.
 * @param report - The report the audit left behind
 * @param tracker - The `tracker` value of `.lisa.config.json`, when there is one
 * @returns The repository root
 */
function repositoryWith(report: unknown, tracker?: string): string {
  const built = buildFNone();
  fixtures.push(built);
  writeAuditReport(built.repoPath, report);
  if (tracker !== undefined) {
    writeFileSync(
      path.join(built.repoPath, ".lisa.config.json"),
      JSON.stringify({ tracker })
    );
  }
  return built.repoPath;
}

/**
 * Run the built command from inside a repository, with no path argument.
 * @param repoPath - The repository to stand in
 * @returns Exit status and both streams
 */
function gaps(repoPath: string): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const child = boundedSpawnSync({
    label: "lisa controls gaps (built CLI in F-none)",
    command: process.execPath,
    args: [DIST_CLI, "controls", "gaps"],
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

describe("built lisa controls gaps in a repository without Lisa", () => {
  it("prints the same two markers on a second run", () => {
    const repoPath = repositoryWith(reportMissing(TWO_MISSING), "github");

    const first = gaps(repoPath);
    const second = gaps(repoPath);
    const printed = JSON.parse(first.stdout) as Printed;

    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(printed.gaps.map(gap => gap.criterion)).toEqual(
      TWO_MISSING.map(address => address.criterion)
    );
    printed.gaps.forEach(gap => {
      expect(gap.marker).toMatch(
        /^\[lisa-control-gap\] criterion=\S+ scope=\. key=[0-9a-f]{12}$/u
      );
      expect(gap.outcome).toBeNull();
    });
  });

  it("prints the same output when the audit wrote its findings in another order", () => {
    const report = reportMissing(TWO_MISSING);
    const backwards = { ...report, findings: [...report.findings].reverse() };

    expect(gaps(repositoryWith(backwards, "github")).stdout).toBe(
      gaps(repositoryWith(report, "github")).stdout
    );
  });

  it("reports every missing requirement as blocked when no tracker is configured, and writes nothing", () => {
    const repoPath = repositoryWith(reportMissing(TWO_MISSING));

    const result = gaps(repoPath);
    const printed = JSON.parse(result.stdout) as Printed;

    expect(result.status).toBe(0);
    expect(printed.tracker.configured).toBe(false);
    expect(printed.tracker.problem).toContain("No tracker is configured");
    expect(printed.gaps.map(gap => gap.outcome)).toEqual([
      "blocked",
      "blocked",
    ]);
    expect(
      runControlAuditGit(repoPath, [
        "status",
        "--porcelain",
        "--ignored",
        "--untracked-files=all",
      ])
    ).toBe(`?? ${REPORT_JSON}`);
  });

  it("prints nothing on stdout for a report the check would refuse", () => {
    const result = gaps(
      repositoryWith(
        dropFinding(completeAuditReport(), TWO_MISSING[0]),
        "github"
      )
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n").at(-1)).toMatch(
      /^gaps: FAIL\. 1 problem in /u
    );
  });
});
