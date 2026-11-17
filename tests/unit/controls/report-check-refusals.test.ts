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
  buildFNone,
} from "../../helpers/control-audit-fixtures.js";
import {
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import { withFirst } from "./audit-report-facts.js";
import {
  check,
  checkOnFNone,
  keep,
  removeFixtures,
} from "./support/report-check-run.js";

afterEach(removeFixtures);

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
