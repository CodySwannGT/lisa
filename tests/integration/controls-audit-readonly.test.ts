/**
 * The audit leaves a repository as it found it, apart from its report, and
 * reports each part of the repository separately.
 *
 * An agent carries out the audit, so no suite can run all of it. This one runs
 * the deterministic part for real: every shell command the audit skill writes
 * down, exactly as written and in order, using the built CLI, inside fixture
 * repositories where Lisa was never applied. A stand-in does the agent's one
 * write, `.lisa/audit/report.json`, from the requirements the catalogue command
 * printed, and nothing else (CodySwannGT/lisa#4979).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { auditSkillExampleReports } from "../helpers/audit-skill.js";
import {
  buildFMixed,
  buildFNone,
  runControlAuditGit,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  sampleFinding,
  writeAuditReport,
  type SampleFinding,
  type SampleReport,
} from "../helpers/control-audit-report.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  CATALOGUE_BLOCK,
  REPORT_CHECK_BLOCK,
  changedLines,
  installLisaCommand,
  picturePath,
  runAuditSkillCommands,
  stepRunning,
  type PrintedCriterion,
  type SkillStep,
} from "./support/audit-skill-run.js";

useIoLatencyBudget();

const STATUS = ["status", "--porcelain", "--ignored"];
const EVERY_FILE = [...STATUS, "--untracked-files=all"];
const REPORT_JSON = ".lisa/audit/report.json";
const REPORT_MD = ".lisa/audit/report.md";
const CATALOGUE = CATALOGUE_BLOCK;
const REPORT_CHECK = REPORT_CHECK_BLOCK;
const COMPARE = "diff ";
const REPORT_FILES_ADDED = [`> ?? ${REPORT_JSON}`, `> ?? ${REPORT_MD}`];
const MIXED_PARTS = [".", "api", "web"];

/** The whole reports the skill shows the agent as examples. */
const EXAMPLES = auditSkillExampleReports().filter(
  (example): example is SampleReport =>
    typeof example === "object" &&
    example !== null &&
    Array.isArray((example as SampleReport).scopes) &&
    Array.isArray((example as SampleReport).findings)
);

const fixtures: ControlAuditFixture[] = [];
const lisa = { folder: "", remove: (): void => undefined };

/**
 * Keep a fixture so it is removed after the case.
 * @param built - The fixture
 * @returns Its repository root
 */
function repositoryOf(built: ControlAuditFixture): string {
  fixtures.push(built);
  return built.repoPath;
}

/**
 * The report an agent would write: one finding for every requirement that was
 * printed, in every part.
 * @param criteria - The requirements `lisa controls catalogue` printed
 * @param scopes - The parts of the repository
 * @param known - Findings to use in place of the plain ones
 * @returns The report
 */
function reportFor(
  criteria: readonly PrintedCriterion[],
  scopes: readonly string[],
  known: readonly SampleFinding[] = []
): SampleReport {
  return {
    schema_version: 1,
    scopes,
    findings: scopes.flatMap(scope =>
      criteria.map(
        criterion =>
          known.find(
            finding =>
              finding.criterion === criterion.id && finding.scope === scope
          ) ?? sampleFinding(String(criterion.id), scope)
      )
    ),
  };
}

/**
 * Run the skill's commands with a stand-in that writes a complete report.
 * @param repoPath - The repository being audited
 * @param scopes - The parts the stand-in reports on
 * @returns The steps that ran
 */
function audit(
  repoPath: string,
  scopes: readonly string[]
): readonly SkillStep[] {
  return runAuditSkillCommands(repoPath, lisa.folder, criteria => {
    writeAuditReport(repoPath, reportFor(criteria, scopes));
  });
}

beforeEach(() => {
  Object.assign(lisa, installLisaCommand());
});

afterEach(() => {
  lisa.remove();
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("the audit on F-none, where Lisa was never applied", () => {
  it("changes git status only by the report path", () => {
    const repoPath = repositoryOf(buildFNone());
    const before = runControlAuditGit(repoPath, STATUS);

    const steps = audit(repoPath, ["."]);

    expect(stepRunning(steps, REPORT_CHECK).stdout).toMatch(
      /^report-check: PASS\. 77 findings across 1 part/u
    );
    expect(before).toBe("");
    expect(runControlAuditGit(repoPath, STATUS)).toBe("?? .lisa/");
    expect(runControlAuditGit(repoPath, EVERY_FILE).split("\n")).toEqual([
      `?? ${REPORT_JSON}`,
      `?? ${REPORT_MD}`,
    ]);
  });

  it("gets its requirements without writing anything or needing spec/", () => {
    const repoPath = repositoryOf(buildFNone());
    const seen: string[] = [];

    const steps = runAuditSkillCommands(repoPath, lisa.folder, criteria => {
      seen.push(runControlAuditGit(repoPath, EVERY_FILE));
      writeAuditReport(repoPath, reportFor(criteria, ["."]));
    });

    expect(seen).toEqual([""]);
    expect(stepRunning(steps, "lisa --help").stdout).toMatch(
      /^ {2}controls /mu
    );
    expect(stepRunning(steps, CATALOGUE).status).toBe(0);
    expect(stepRunning(steps, CATALOGUE).stderr).toBe("");
    expect(existsSync(path.join(repoPath, "spec"))).toBe(false);
    expect(existsSync(path.join(repoPath, ".lisa.config.json"))).toBe(false);
    expect(existsSync(path.join(repoPath, "package.json"))).toBe(false);
  });

  it("has its own comparison show the report path and nothing else", () => {
    const repoPath = repositoryOf(buildFNone());

    const steps = audit(repoPath, ["."]);
    const compare = stepRunning(steps, COMPARE);
    const pictures = ["before", "after"].map(picture =>
      picturePath(steps, picture)
    );

    expect(compare.status).toBe(1);
    expect(changedLines(compare.stdout)).toEqual([
      "> ?? .lisa/",
      ...REPORT_FILES_ADDED,
    ]);
    expect(pictures.filter(picture => picture === "")).toEqual([]);
    expect(pictures.filter(picture => picture.startsWith(repoPath))).toEqual(
      []
    );
    expect(pictures.filter(picture => existsSync(picture))).toEqual([]);
  });

  it("names only .lisa/audit when the repository already tracks .lisa", () => {
    const repoPath = repositoryOf(
      buildFNone({ extraFiles: { ".lisa/notes.txt": "kept\n" } })
    );

    const steps = audit(repoPath, ["."]);

    expect(runControlAuditGit(repoPath, STATUS)).toBe("?? .lisa/audit/");
    expect(changedLines(stepRunning(steps, COMPARE).stdout)).toEqual([
      "> ?? .lisa/audit/",
      ...REPORT_FILES_ADDED,
    ]);
  });

  it.each([
    { where: "beside the repository's own files", stray: "audit-notes.txt" },
    { where: "under .lisa but outside the report", stray: ".lisa/stray.txt" },
  ])("has its own comparison catch a file written $where", ({ stray }) => {
    const repoPath = repositoryOf(buildFNone());

    const steps = runAuditSkillCommands(repoPath, lisa.folder, criteria => {
      writeAuditReport(repoPath, reportFor(criteria, ["."]));
      writeFileSync(path.join(repoPath, stray), "scratch\n");
    });

    expect(
      changedLines(stepRunning(steps, COMPARE).stdout).filter(
        line => !["> ?? .lisa/", ...REPORT_FILES_ADDED].includes(line)
      )
    ).toEqual([`> ?? ${stray}`]);
  });

  it("stops at the check, with no readable report, when a part is left out", () => {
    const repoPath = repositoryOf(buildFNone());

    const steps = runAuditSkillCommands(repoPath, lisa.folder, criteria => {
      writeAuditReport(repoPath, {
        ...reportFor(criteria, ["."]),
        scopes: [".", "src"],
      });
    });
    const check = stepRunning(steps, REPORT_CHECK);

    expect(check.status).toBe(1);
    expect(check.stdout).toBe("");
    expect(check.stderr).toMatch(/report-check: FAIL\. 1 problem in /u);
    expect(runControlAuditGit(repoPath, EVERY_FILE)).toBe(`?? ${REPORT_JSON}`);
  });
});

describe("the audit on F-mixed, which has two parts", () => {
  it("reports api, web and the whole repository in separate sections", () => {
    const repoPath = repositoryOf(buildFMixed());

    const steps = audit(repoPath, MIXED_PARTS);
    const headings = readFileSync(path.join(repoPath, REPORT_MD), "utf8")
      .split("\n")
      .filter(line => line.startsWith("## "));

    expect(stepRunning(steps, REPORT_CHECK).stdout).toMatch(
      /^report-check: PASS\. 231 findings across 3 parts/u
    );
    expect(headings).toEqual([
      "## Summary",
      "## Whole repository",
      "## Folder `api`",
      "## Folder `web`",
    ]);
    expect(runControlAuditGit(repoPath, EVERY_FILE).split("\n")).toEqual([
      `?? ${REPORT_JSON}`,
      `?? ${REPORT_MD}`,
    ]);
  });

  it("is shown at least one whole report as an example by the skill", () => {
    expect(EXAMPLES.length).toBeGreaterThan(0);
  });

  it.each(EXAMPLES)(
    "accepts the findings of the skill's example report %#",
    example => {
      const repoPath = repositoryOf(buildFMixed());

      const steps = runAuditSkillCommands(repoPath, lisa.folder, criteria => {
        writeAuditReport(repoPath, {
          ...example,
          ...reportFor(criteria, example.scopes.map(String), example.findings),
        });
      });
      const check = stepRunning(steps, REPORT_CHECK);
      const readable = readFileSync(path.join(repoPath, REPORT_MD), "utf8");

      expect(example.findings.length).toBeGreaterThan(0);
      expect(check.stderr).toBe("");
      expect(check.status).toBe(0);
      expect(
        example.findings.filter(
          finding => !readable.includes(String(finding.what))
        )
      ).toEqual([]);
    }
  );
});
