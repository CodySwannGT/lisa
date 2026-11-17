/**
 * `lisa controls gaps`: the requirements a repository has nothing for, each
 * with the marker its ticket carries.
 *
 * The ticket flow is driven by an agent, so everything it must not get wrong
 * comes from this command: which requirements are missing, the marker each
 * one's ticket is found by, and the order they are listed in. The same report
 * has to produce the same output however it is written down
 * (CodySwannGT/lisa#4992).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
} from "../../../src/controls/audit-report.js";
import {
  GAPS_SCHEMA_VERSION,
  listControlGaps,
} from "../../../src/controls/commands/gaps.js";
import {
  controlGapKey,
  controlGapMarker,
} from "../../../src/controls/control-gap-marker.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import {
  amendFinding,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import { CRITERIA, FIRST, SECOND } from "./audit-report-facts.js";
import {
  gaps,
  mixedRepository,
  printed,
  reportMissing,
} from "./support/gaps-run.js";
import { removeFixtures } from "./support/report-check-run.js";

afterEach(removeFixtures);

const TWO_MISSING = [
  { criterion: FIRST, scope: "." },
  { criterion: SECOND, scope: "." },
] as const;

/**
 * The same report written down in the opposite order.
 * @param report - The report to start from
 * @returns A report with its findings and its scopes reversed
 */
function reversed(report: SampleReport): SampleReport {
  return {
    ...report,
    scopes: [...report.scopes].reverse(),
    findings: [...report.findings].reverse(),
  };
}

describe("a report with two missing requirements", () => {
  it("lists exactly those two, and nothing that is in another state", async () => {
    const run = await gaps(
      mixedRepository(reportMissing(TWO_MISSING), "github")
    );
    const output = printed(run);

    expect(run.code).toBe(0);
    expect(run.stderr).toEqual([]);
    expect(output.gaps.map(gap => [gap.criterion, gap.scope])).toEqual([
      [FIRST, "."],
      [SECOND, "."],
    ]);
  });

  it("gives each one the marker its ticket is found by", async () => {
    const output = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING), "github"))
    );

    expect(output.gaps.map(gap => gap.marker)).toEqual([
      controlGapMarker(FIRST, "."),
      controlGapMarker(SECOND, "."),
    ]);
    expect(output.gaps.map(gap => gap.key)).toEqual([
      controlGapKey(FIRST, "."),
      controlGapKey(SECOND, "."),
    ]);
  });

  it("prints byte-identical output on a second run", async () => {
    const repoPath = mixedRepository(reportMissing(TWO_MISSING), "github");

    const first = await gaps(repoPath);
    const second = await gaps(repoPath);

    expect(second.stdout).toEqual(first.stdout);
    expect(first.stdout).toHaveLength(1);
  });

  it("names the requirement by its plain question and carries the finding's own words", async () => {
    const report = amendFinding(reportMissing(TWO_MISSING), TWO_MISSING[0], {
      what: "No load test exists.",
      why: "A slow release would reach users unnoticed.",
      next: "Pick a load testing tool and add a first scenario.",
    });

    const [gap] = printed(await gaps(mixedRepository(report, "github"))).gaps;

    expect(gap).toMatchObject({
      question: CRITERIA[0]?.question,
      part: "whole repository",
      what: "No load test exists.",
      why: "A slow release would reach users unnoticed.",
      next: "Pick a load testing tool and add a first scenario.",
    });
  });

  it("keeps the requirement's id out of everything an operator reads", async () => {
    const [gap] = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING), "github"))
    ).gaps;

    expect(
      [gap?.question, gap?.part, gap?.what, gap?.why, gap?.next].join(" ")
    ).not.toContain(FIRST);
  });

  it("says which report it read and which output version this is", async () => {
    const output = printed(
      await gaps(mixedRepository(reportMissing(TWO_MISSING), "github"))
    );

    expect(output.schema_version).toBe(GAPS_SCHEMA_VERSION);
    expect(output.report).toBe(AUDIT_REPORT_JSON_PATH);
  });
});

describe("the same report written in another order", () => {
  const SPREAD = [
    { criterion: SECOND, scope: "web" },
    { criterion: FIRST, scope: "web" },
    { criterion: SECOND, scope: "api" },
    { criterion: FIRST, scope: "." },
  ] as const;

  it("prints byte-identical output", async () => {
    const report = reportMissing(SPREAD);

    const asWritten = await gaps(mixedRepository(report, "github"));
    const backwards = await gaps(mixedRepository(reversed(report), "github"));

    expect(backwards.stdout).toEqual(asWritten.stdout);
  });

  it("lists by requirement in catalogue order, then by folder", async () => {
    const output = printed(
      await gaps(mixedRepository(reversed(reportMissing(SPREAD)), "github"))
    );

    expect(output.gaps.map(gap => [gap.criterion, gap.scope])).toEqual([
      [FIRST, "."],
      [FIRST, "web"],
      [SECOND, "api"],
      [SECOND, "web"],
    ]);
  });

  it("names a folder as a folder", async () => {
    const output = printed(
      await gaps(mixedRepository(reportMissing(SPREAD), "github"))
    );

    expect(output.gaps.map(gap => gap.part)).toEqual([
      "whole repository",
      "folder web",
      "folder api",
      "folder web",
    ]);
  });
});

describe("what the command leaves behind", () => {
  it("writes nothing: no rendered report, no other file", async () => {
    const repoPath = mixedRepository(reportMissing(TWO_MISSING));

    await gaps(repoPath);

    expect(existsSync(path.join(repoPath, AUDIT_REPORT_MARKDOWN_PATH))).toBe(
      false
    );
    expect(
      runControlAuditGit(repoPath, [
        "status",
        "--porcelain",
        "--ignored",
        "--untracked-files=all",
      ])
    ).toBe(`?? ${AUDIT_REPORT_JSON_PATH}`);
  });

  it("prints an empty list when nothing is missing", async () => {
    const run = await gaps(mixedRepository(reportMissing([]), "github"));

    expect(run.code).toBe(0);
    expect(printed(run).gaps).toEqual([]);
  });
});

describe("listControlGaps", () => {
  it("skips a missing finding whose requirement is not in the catalogue", () => {
    const report = {
      schema_version: 1,
      scopes: ["."],
      findings: [
        {
          criterion: "AC99.9",
          scope: ".",
          state: "missing",
          what: "Nothing.",
          why: "It matters.",
          next: "Add it.",
          mechanisms: [],
        },
      ],
    } as const;

    expect(listControlGaps(report, CRITERIA)).toEqual([]);
  });
});
