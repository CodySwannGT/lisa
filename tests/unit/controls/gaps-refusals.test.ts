/**
 * `lisa controls gaps` refuses a report nobody should act on.
 *
 * Tickets are filed from this command's output, so it reads only a report that
 * passes every rule `report-check` holds one to. When the report does not, it
 * prints nothing on stdout: a caller can never parse half a list
 * (CodySwannGT/lisa#4992).
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIT_REPORT_JSON_PATH } from "../../../src/controls/audit-report.js";
import {
  GAPS_COMMAND,
  registerGaps,
} from "../../../src/controls/commands/gaps.js";
import {
  amendFinding,
  completeAuditReport,
  dropFinding,
} from "../../helpers/control-audit-report.js";
import { FIRST } from "./audit-report-facts.js";
import { gaps, mixedRepository, reportMissing } from "./support/gaps-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const exitCodeBefore = process.exitCode;

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  removeFixtures();
  process.exitCode = exitCodeBefore;
});

const AT_FIRST = { criterion: FIRST, scope: "." } as const;
const FAIL_LINE =
  /^gaps: FAIL\. \d+ problems? in \.lisa\/audit\/report\.json; nothing was listed\. Run `lisa controls report-check`, fix the report, then run this again$/u;

describe("a report that cannot be relied on", () => {
  it("is refused when no audit has run", async () => {
    const repoPath = mixedRepository(reportMissing([AT_FIRST]), "github");
    rmSync(path.join(repoPath, AUDIT_REPORT_JSON_PATH));

    const run = await gaps(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toBe(
      `No audit report was found at ${AUDIT_REPORT_JSON_PATH}. Run the audit first, then run this check again.`
    );
    expect(run.stderr.at(-1)).toMatch(FAIL_LINE);
  });

  it("is refused when a requirement is left out of it", async () => {
    const run = await gaps(
      mixedRepository(
        dropFinding(completeAuditReport([".", "api", "web"]), AT_FIRST),
        "github"
      )
    );

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.at(-1)).toMatch(FAIL_LINE);
  });

  it("prints the same problem lines report-check prints", async () => {
    const run = await gaps(
      mixedRepository(
        amendFinding(reportMissing([AT_FIRST]), AT_FIRST, { why: "" }),
        "github"
      )
    );

    expect(run.code).toBe(1);
    expect(run.stderr).toHaveLength(2);
    expect(run.stderr[0]).toContain('The "why" field is empty.');
    expect(run.stderr[0]).toContain(`requirement ${FIRST}`);
  });

  it("is refused when it is not JSON", async () => {
    const run = await gaps(mixedRepository("placeholder", "github"));

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
  });

  it("is refused when the path is not a folder", async () => {
    const repoPath = mixedRepository(reportMissing([AT_FIRST]), "github");

    const run = await gaps(path.join(repoPath, "no-such-folder"));

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toContain("is not a folder");
  });
});

describe("registerGaps", () => {
  /**
   * Run `gaps` through a group it was registered on.
   * @param code - The exit code the command returns
   * @param args - What follows `gaps` on the command line
   * @returns The stub that stood in for the command
   */
  async function runRegistered(
    code: number,
    args: readonly string[]
  ): Promise<ReturnType<typeof vi.fn>> {
    const runGaps = vi.fn(async () => code);
    const group = new Command("controls").exitOverride();
    registerGaps(group, { runGaps });
    await group.parseAsync([GAPS_COMMAND, ...args], { from: "user" });
    return runGaps;
  }

  it("passes the path argument through", async () => {
    const runGaps = await runRegistered(0, ["some/repository"]);

    expect(runGaps).toHaveBeenCalledWith("some/repository");
    expect(process.exitCode).toBeUndefined();
  });

  it("defaults to the current directory", async () => {
    const runGaps = await runRegistered(0, []);

    expect(runGaps).toHaveBeenCalledWith(undefined);
  });

  it("sets the exit code without ending the process, so piped output is not cut short", async () => {
    await runRegistered(1, []);

    expect(process.exitCode).toBe(1);
  });
});
