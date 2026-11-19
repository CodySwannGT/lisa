/**
 * `lisa controls report-check` against real repositories.
 *
 * The command is what stands between an agent-written audit and anyone who
 * relies on it. Every case runs on a fixture repository where Lisa was never
 * applied: no `.lisa.config.json`, no installed templates, and for F-none no
 * `package.json` either (CodySwannGT/lisa#4978).
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
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
  buildFPaved,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import {
  completeAuditReport,
  writeAuditReport,
  writeEvidenceRecords,
} from "../../helpers/control-audit-report.js";
import {
  CRITERIA,
  EXISTS_NOT_ENFORCED,
  FIRST,
  LINTER,
  PER_PART,
  PROVED,
  REPOSITORY_WIDE,
  withFirst,
} from "./audit-report-facts.js";
import {
  check,
  checkOnFNone,
  keep,
  removeFixtures,
} from "./support/report-check-run.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

afterEach(removeFixtures);

/**
 * A record the attest step wrote for the first requirement, for the whole
 * repository: a setting it read, which stands on its own.
 */
const OBSERVED_RECORD = {
  id: "ev-0001",
  criterion: FIRST,
  entry_id: "code-style@.",
  scope: ".",
  rung: "observed",
  moment: "pull-request",
  completed_at: "2026-11-17T11:00:00.000Z",
  freshness_seconds: 86_400,
} as const;

describe("a complete report passes", () => {
  it("exits 0 in a repository Lisa was never applied to", async () => {
    const run = await checkOnFNone(completeAuditReport());

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(existsSync(path.join(run.repoPath, ".lisa.config.json"))).toBe(
      false
    );
    expect(existsSync(path.join(run.repoPath, "package.json"))).toBe(false);
  });

  it("says what it checked and what it wrote", async () => {
    const run = await checkOnFNone(completeAuditReport());

    expect(run.stdout).toEqual([
      `report-check: PASS. ${CRITERIA.length} findings across 1 part, 0 filed as not applicable; wrote ${AUDIT_REPORT_MARKDOWN_PATH}`,
    ]);
  });

  it("renders report.md beside the report and touches nothing else", async () => {
    const run = await checkOnFNone(completeAuditReport());
    const markdown = readFileSync(
      path.join(run.repoPath, AUDIT_REPORT_MARKDOWN_PATH),
      "utf8"
    );

    expect(markdown).toContain("## Whole repository");
    expect(
      runControlAuditGit(run.repoPath, [
        "status",
        "--porcelain",
        "--ignored",
        "--untracked-files=all",
      ]).split("\n")
    ).toEqual([
      `?? ${AUDIT_REPORT_JSON_PATH}`,
      `?? ${AUDIT_REPORT_MARKDOWN_PATH}`,
    ]);
  });

  it.each([
    { name: "F-empty", build: buildFEmpty },
    { name: "F-paved", build: buildFPaved },
  ])(
    "classifies every in-scope criterion exactly once on $name",
    async ({ build }) => {
      const { repoPath } = keep(build());
      writeAuditReport(repoPath, completeAuditReport());

      const run = await check(repoPath);

      expect(run.code).toBe(0);
      expect(run.stdout[0]).toContain(`${CRITERIA.length} findings`);
    }
  );

  it("accepts one section per folder plus the repository-wide one", async () => {
    const { repoPath } = keep(buildFMixed());
    writeAuditReport(repoPath, completeAuditReport([".", "api", "web"]));

    const run = await check(repoPath);

    expect(run.code).toBe(0);
    expect(run.stdout[0]).toContain(
      `${REPOSITORY_WIDE.length + PER_PART.length * 2} findings across 3 parts`
    );
    expect(
      readFileSync(path.join(repoPath, AUDIT_REPORT_MARKDOWN_PATH), "utf8")
    ).toContain("## Folder `web`");
  });

  it("accepts a linter that is configured but not enforced, pointing at its line", async () => {
    const run = await checkOnFNone(
      withFirst({ state: EXISTS_NOT_ENFORCED, mechanisms: [LINTER] })
    );

    expect(run.code).toBe(0);
  });

  it("follows a link to the repository when that is the path it is given", async () => {
    const { repoPath } = keep(buildFNone());
    const link = `${repoPath}-link`;
    writeAuditReport(repoPath, completeAuditReport());
    createSymlink(repoPath, link);

    try {
      expect((await check(link)).code).toBe(0);
    } finally {
      rmSync(link, { force: true });
    }
  });

  it("resolves the path argument from the working directory", async () => {
    const { repoPath } = keep(buildFNone());
    writeAuditReport(repoPath, completeAuditReport());

    expect((await check(undefined, repoPath)).code).toBe(0);
    expect(
      (await check(path.basename(repoPath), path.dirname(repoPath))).code
    ).toBe(0);
  });
});

describe("presence is never accepted as proof", () => {
  it("refuses proved with no evidence record, naming the criterion", async () => {
    const run = await checkOnFNone(
      withFirst({ state: PROVED, mechanisms: [LINTER] })
    );

    expect(run.code).toBe(1);
    expect(run.stderr).toHaveLength(2);
    expect(run.stderr[0]).toContain("no evidence record");
    expect(run.stderr[0]).toContain(`(requirement ${FIRST}, whole repository)`);
    expect(run.stdout).toEqual([]);
  });

  it("refuses proved when the cited record is not in the evidence file", async () => {
    const run = await checkOnFNone(
      withFirst({
        state: PROVED,
        evidence_id: "ev-0001",
        mechanisms: [LINTER],
      })
    );

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("ev-0001");
    expect(run.stderr[0]).toContain(FIRST);
  });

  it("accepts proved once a fresh record for the criterion and the folder exists", async () => {
    const { repoPath } = keep(buildFNone());
    writeAuditReport(
      repoPath,
      withFirst({
        state: PROVED,
        evidence_id: "ev-0001",
        mechanisms: [LINTER],
      })
    );
    writeEvidenceRecords(repoPath, [OBSERVED_RECORD]);

    expect((await check(repoPath)).code).toBe(0);
  });

  it("refuses proved on one half of a proof, and accepts it once the other half is on record", async () => {
    const { repoPath } = keep(buildFNone());
    const half = (which: string): Record<string, unknown> => ({
      ...OBSERVED_RECORD,
      id: `code-style@./commit/${which}/${FIRST}`,
      rung: "exercised",
      half: which,
      moment: "commit",
      result: "held",
    });
    writeAuditReport(
      repoPath,
      withFirst({
        state: PROVED,
        evidence_id: half("clean").id,
        mechanisms: [LINTER],
      })
    );
    writeEvidenceRecords(repoPath, [half("clean")]);
    const alone = await check(repoPath);
    writeEvidenceRecords(repoPath, [half("clean"), half("violation")]);
    const paired = await check(repoPath);

    expect(alone.code).toBe(1);
    expect(alone.stderr[0]).toContain(
      "is one half of a proof, and the other half (the change that breaks the rule and has to be refused) is not on record"
    );
    expect(paired.stderr).toEqual([]);
    expect(paired.code).toBe(0);
  });

  it("refuses proved on a record that is about another folder", async () => {
    const { repoPath } = keep(buildFNone());
    writeAuditReport(
      repoPath,
      withFirst({
        state: PROVED,
        evidence_id: "ev-0001",
        mechanisms: [LINTER],
      })
    );
    writeEvidenceRecords(repoPath, [
      { ...OBSERVED_RECORD, entry_id: "code-style@api", scope: "api" },
    ]);

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain(
      `Evidence record "ev-0001" is about the folder api, so it cannot prove the requirement for the whole repository.`
    );
  });

  it("refuses proved once that record is past its lifetime", async () => {
    const { repoPath } = keep(buildFNone());
    writeAuditReport(
      repoPath,
      withFirst({
        state: PROVED,
        evidence_id: "ev-0001",
        mechanisms: [LINTER],
      })
    );
    writeEvidenceRecords(repoPath, [
      { ...OBSERVED_RECORD, completed_at: "2026-11-01T11:00:00.000Z" },
    ]);

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("too old");
  });

  it("refuses a pointer past the end of the file it names", async () => {
    const run = await checkOnFNone(
      withFirst({
        state: EXISTS_NOT_ENFORCED,
        mechanisms: [
          { ...LINTER, locators: [{ path: "ruff.toml", line: 99 }] },
        ],
      })
    );

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("ruff.toml line 99");
  });
});

describe("plain-language fields are enforced", () => {
  it.each([
    { name: "is empty", why: "" },
    { name: "contains a criterion id", why: "Because AC5.1 says so." },
  ])("refuses a why field that $name, naming the field", async ({ why }) => {
    const run = await checkOnFNone(withFirst({ why }));

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain('"why"');
    expect(run.stderr[0]).toContain(FIRST);
  });
});
