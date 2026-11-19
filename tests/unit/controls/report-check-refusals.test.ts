/**
 * What `lisa controls report-check` does with a report it refuses.
 *
 * A refusal has to be as usable as a pass: one line per problem, a count, and
 * no `report.md` left behind that could be mistaken for a checked report. The
 * command also never reads or writes outside the repository it was pointed at
 * (CodySwannGT/lisa#4978).
 */
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
} from "../../../src/controls/audit-report.js";
import {
  buildFEmpty,
  buildFMixed,
  buildFNone,
} from "../../helpers/control-audit-fixtures.js";
import {
  completeAuditReport,
  dropFinding,
  sampleFinding,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import {
  CRITERIA,
  FIRST,
  PART_FIRST,
  withFirst,
} from "./audit-report-facts.js";
import {
  check,
  checkOnFNone,
  keep,
  removeFixtures,
  type Run,
} from "./support/report-check-run.js";

afterEach(removeFixtures);

/** The parts of F-mixed: the whole repository and its two folders. */
const MIXED_PARTS = [".", "api", "web"];

/**
 * The plain question the catalogue asks for a requirement.
 * @param id - Criterion id
 * @returns Its question
 */
function questionOf(id: string): string {
  return CRITERIA.find(criterion => criterion.id === id)?.question ?? "";
}

/**
 * Write a report into F-mixed, which has the parts api and web, and check it.
 * @param report - The report to check
 * @returns The run
 */
async function checkOnFMixed(report: unknown): Promise<Run> {
  const { repoPath } = keep(buildFMixed());
  writeAuditReport(repoPath, report);
  return check(repoPath);
}

describe("a report for a repository with the parts api and web", () => {
  it("is refused when a repository-wide requirement has a finding in the api part, naming the requirement and the part", async () => {
    const complete = completeAuditReport(MIXED_PARTS);

    const run = await checkOnFMixed({
      ...complete,
      findings: [...complete.findings, sampleFinding(FIRST, "api")],
    });

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toHaveLength(2);
    expect(run.stderr[0]).toContain(`"${questionOf(FIRST)}"`);
    expect(run.stderr[0]).toContain(
      "is answered once, for the whole repository, but this finding files it under the folder api"
    );
    expect(run.stderr[0]).toMatch(
      new RegExp(String.raw`\(requirement ${FIRST}, folder api\)$`, "u")
    );
    expect(run.stderr[1]).toMatch(/^report-check: FAIL\. 1 problem in /u);
  });

  it("is refused when a per-part requirement has a finding for api and none for web, naming the requirement and the web part", async () => {
    const run = await checkOnFMixed(
      dropFinding(completeAuditReport(MIXED_PARTS), {
        criterion: PART_FIRST,
        scope: "web",
      })
    );

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toHaveLength(2);
    expect(run.stderr[0]).toContain(
      `No finding answers "${questionOf(PART_FIRST)}" for the folder web.`
    );
    expect(run.stderr[0]).toContain(
      "answered once for each folder the report lists"
    );
    expect(run.stderr[0]).toMatch(
      new RegExp(String.raw`\(requirement ${PART_FIRST}, folder web\)$`, "u")
    );
  });
});

describe("a refused report", () => {
  it("prints one line per violation, then how many there were", async () => {
    const run = await checkOnFNone(withFirst({ what: "", why: "", next: "" }));

    expect(run.code).toBe(1);
    expect(run.stderr).toHaveLength(4);
    expect(run.stderr[3]).toBe(
      `report-check: FAIL. 3 problems in ${AUDIT_REPORT_JSON_PATH}; ${AUDIT_REPORT_MARKDOWN_PATH} was not written`
    );
    run.stderr.forEach(line => {
      expect(line).not.toContain("\n");
    });
  });

  it("does not write report.md", async () => {
    const run = await checkOnFNone(withFirst({ why: "" }));

    expect(
      existsSync(path.join(run.repoPath, AUDIT_REPORT_MARKDOWN_PATH))
    ).toBe(false);
  });

  it("says so when there is no report to check", async () => {
    const { repoPath } = keep(buildFNone());

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr).toHaveLength(2);
    expect(run.stderr[0]).toContain(AUDIT_REPORT_JSON_PATH);
    expect(run.stderr[0]).toContain("Run the audit");
  });

  it("says so when the report is not valid JSON", async () => {
    const { repoPath } = keep(buildFNone());
    const file = path.join(repoPath, AUDIT_REPORT_JSON_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("not valid JSON");
  });

  it("says so when the path is not a folder", async () => {
    const { repoPath } = keep(buildFNone());

    const run = await check(path.join(repoPath, "no-such-folder"));

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("not a folder");
  });

  it("reads and writes nothing when the report folder is a link out of the repository", async () => {
    const { repoPath } = keep(buildFNone());
    const outside = keep(buildFEmpty());
    writeAuditReport(outside.repoPath, completeAuditReport());
    mkdirSync(path.join(repoPath, ".lisa"));
    symlinkSync(
      path.join(outside.repoPath, ".lisa", "audit"),
      path.join(repoPath, ".lisa", "audit")
    );

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("outside the repository");
    expect(
      existsSync(path.join(outside.repoPath, AUDIT_REPORT_MARKDOWN_PATH))
    ).toBe(false);
  });

  it("never writes report.md through a link that leaves the repository", async () => {
    const { repoPath } = keep(buildFNone());
    const outside = keep(buildFEmpty());
    const target = path.join(outside.repoPath, "elsewhere.md");
    writeAuditReport(repoPath, completeAuditReport());
    symlinkSync(target, path.join(repoPath, AUDIT_REPORT_MARKDOWN_PATH));

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(existsSync(target)).toBe(false);
    expect(run.stderr[0]).toContain(AUDIT_REPORT_MARKDOWN_PATH);
  });
});
