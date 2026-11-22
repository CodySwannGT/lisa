/**
 * A pointer has to lead to something the repository itself holds.
 *
 * A finding shows that a control is in place by pointing at a file and a
 * line. The audit's own report, the records Lisa's commands write and git's
 * own data are there whatever the repository does, so a line in one of them
 * shows nothing. A pointer at `.lisa/audit/report.json` line 1 or at
 * `.git/config` line 1 used to pass the check, and the attest step then
 * recorded the requirement as observed and held. These cases pin that both
 * steps turn such a pointer away, and the two places a pointer may still
 * lead: the control register, which is the list of rules a requirement asks
 * for, and a hook installed in `.git/hooks`, which is a check that really
 * runs (CodySwannGT/lisa#4978).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  formatAuditReportViolation,
  validateAuditReport,
} from "../../../src/controls/audit-report.js";
import type { AuditFinding } from "../../../src/controls/audit-report-types.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import { findingRecords } from "../../../src/controls/evidence-findings.js";
import { DEFAULT_FRESHNESS_SECONDS } from "../../../src/controls/evidence-types.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import {
  createRepositoryReader,
  recordKeepingPlace,
} from "../../../src/controls/repository-reader.js";
import { VERDICT_PATH } from "../../../src/controls/verdict-types.js";
import { buildFNone } from "../../helpers/control-audit-fixtures.js";
import {
  amendFinding,
  completeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  AT_FIRST,
  CRITERIA,
  EXISTS_NOT_ENFORCED,
  FIRST,
  LINTER,
  NOW,
  RULE,
  context,
} from "./audit-report-facts.js";
import { check, keep, removeFixtures } from "./support/report-check-run.js";
import { SAMPLE_CHECKS } from "./support/evidence-samples.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

afterEach(removeFixtures);

const GIT_CONFIG = ".git/config";
const INSTALLED_HOOK = ".git/hooks/pre-commit";
const SAMPLE_HOOK = ".git/hooks/pre-commit.sample";
const PROOF_PATCH = ".lisa/controls/proofs/lint.clean.patch";
const LINK_TO_GIT = "docs/settings";
const LINK_TO_REPORT = "docs/earlier-report.json";

/** A file of the repository that a pointer may name. */
const README = "docs/readme.md";

/**
 * The long s (U+017F), which a file system that ignores case reads as "s".
 * Written by its number so that it cannot be mistaken for an "f" here.
 */
const LONG_S = String.fromCodePoint(0x17f);

/** Every place a pointer may not lead, as a report might write it. */
const REFUSED = [
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  EVIDENCE_PATH,
  VERDICT_PATH,
  PROOF_PATCH,
  GIT_CONFIG,
  ".git/HEAD",
  SAMPLE_HOOK,
  ".git/hooks/nested/pre-commit",
  "api/.git/config",
  `./${GIT_CONFIG}`,
  `docs/../${GIT_CONFIG}`,
  ".GIT/config",
  ".Lisa/Audit/report.json",
  ".git",
] as const;

/** The places inside those folders a pointer may lead, and ordinary files. */
const ALLOWED = [
  CONTROL_REGISTER_PATH,
  INSTALLED_HOOK,
  ".lisa.config.json",
  ".lisa/hooks/pre-push",
  ".github/workflows/ci.yml",
  ".gitignore",
  "docs/git/config",
  "ruff.toml",
] as const;

/**
 * The complete report with its first finding pointing at one file.
 * @param file - The file it points at
 * @returns The report
 */
function pointingAt(file: string): SampleReport {
  return amendFinding(completeAuditReport(), AT_FIRST, {
    state: EXISTS_NOT_ENFORCED,
    what: "This is written down.",
    mechanisms: [{ ...LINTER, locators: [{ path: file, line: 1 }] }],
  });
}

/**
 * Check a report against a repository in which every file exists, so that a
 * refusal cannot be for a file that is missing.
 * @param report - The report
 * @returns The lines the check would print
 */
function linesFor(report: SampleReport): readonly string[] {
  return validateAuditReport(
    report,
    context({
      repository: { lineCount: () => 3, isFolder: () => true },
    })
  ).violations.map(violation => {
    expect(violation.rule).toBe(RULE.locators);
    return formatAuditReportViolation(violation);
  });
}

/**
 * Build F-none with every kind of file a pointer might be aimed at.
 * @returns The repository root
 */
function repository(): string {
  const { repoPath } = keep(buildFNone());
  const files: Readonly<Record<string, string>> = {
    [AUDIT_REPORT_MARKDOWN_PATH]: "# Audit report\n",
    [EVIDENCE_PATH]: '{ "records": [] }\n',
    [VERDICT_PATH]: "{}\n",
    [CONTROL_REGISTER_PATH]: '{\n  "entries": []\n}\n',
    [PROOF_PATCH]: "--- a\n+++ b\n",
    [INSTALLED_HOOK]: "#!/bin/sh\nruff check .\n",
    [SAMPLE_HOOK]: "#!/bin/sh\n",
    [README]: "one\n",
  };
  Object.entries(files).forEach(([relative, content]) => {
    const file = path.join(repoPath, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  });
  createSymlink(
    path.join(repoPath, GIT_CONFIG),
    path.join(repoPath, LINK_TO_GIT)
  );
  createSymlink(
    path.join(repoPath, AUDIT_REPORT_MARKDOWN_PATH),
    path.join(repoPath, LINK_TO_REPORT)
  );
  return repoPath;
}

describe("the places a pointer may not lead", () => {
  it.each(REFUSED)("include %s", file => {
    expect(recordKeepingPlace(file)).not.toBeNull();
  });

  it.each(ALLOWED)("do not include %s", file => {
    expect(recordKeepingPlace(file)).toBeNull();
  });

  it("keep the control register as the one record of Lisa's a pointer may name", () => {
    expect(CONTROL_REGISTER_PATH).toBe(".lisa/controls/register.json");
    expect(
      recordKeepingPlace(".lisa/controls/register.json.bak")
    ).not.toBeNull();
    expect(recordKeepingPlace(".lisa/controls")).not.toBeNull();
  });
});

describe("the report check", () => {
  it("refuses a pointer at the audit's own report, and says why", () => {
    expect(linesFor(pointingAt(AUDIT_REPORT_JSON_PATH))).toEqual([
      `The pointer ${AUDIT_REPORT_JSON_PATH} line 1 leads into the audit's own report folder (.lisa/audit), which the audit itself writes. A file there cannot show that a control is in place. Point at the file of the repository that does, or choose another state. (requirement ${FIRST}, whole repository)`,
    ]);
  });

  it("refuses a pointer at git's own data, and names the one exception", () => {
    expect(linesFor(pointingAt(GIT_CONFIG))).toEqual([
      `The pointer ${GIT_CONFIG} line 1 leads into git's own folder (.git), which every repository has; the one thing there a pointer may name is a hook installed in .git/hooks/. A file there cannot show that a control is in place. Point at the file of the repository that does, or choose another state. (requirement ${FIRST}, whole repository)`,
    ]);
  });

  it("refuses a pointer at the records Lisa's commands write, and names the one exception", () => {
    expect(linesFor(pointingAt(EVIDENCE_PATH))).toEqual([
      `The pointer ${EVIDENCE_PATH} line 1 leads into Lisa's own records (.lisa/controls), which its commands write; the one file there a pointer may name is the control register, ${CONTROL_REGISTER_PATH}. A file there cannot show that a control is in place. Point at the file of the repository that does, or choose another state. (requirement ${FIRST}, whole repository)`,
    ]);
  });

  it.each(REFUSED)("refuses a pointer at %s", file => {
    expect(linesFor(pointingAt(file))).toHaveLength(1);
  });

  it.each(ALLOWED)("accepts a pointer at %s", file => {
    expect(linesFor(pointingAt(file))).toEqual([]);
  });

  it("refuses the report of a real repository that points at its own record", async () => {
    const repoPath = repository();
    writeFileSync(
      path.join(repoPath, AUDIT_REPORT_JSON_PATH),
      `${JSON.stringify(pointingAt(AUDIT_REPORT_JSON_PATH), null, 2)}\n`
    );

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toContain(
      `The pointer ${AUDIT_REPORT_JSON_PATH} line 1 leads into the audit's own report folder`
    );
  });
});

describe("reading the repository", () => {
  it.each([
    AUDIT_REPORT_MARKDOWN_PATH,
    EVIDENCE_PATH,
    VERDICT_PATH,
    PROOF_PATCH,
    GIT_CONFIG,
    SAMPLE_HOOK,
    ".GIT/config",
  ])("finds no line at %s, though the file is there", file => {
    expect(createRepositoryReader(repository()).lineCount(file)).toBeNull();
  });

  it.each([LINK_TO_GIT, LINK_TO_REPORT])(
    "finds no line through the link %s, which leads into such a place",
    link => {
      expect(createRepositoryReader(repository()).lineCount(link)).toBeNull();
    }
  );

  it("still counts the lines of the control register and of an installed hook", () => {
    const reader = createRepositoryReader(repository());

    expect(reader.lineCount(CONTROL_REGISTER_PATH)).toBe(3);
    expect(reader.lineCount(INSTALLED_HOOK)).toBe(2);
    expect(reader.lineCount(README)).toBe(1);
  });

  it.each([
    ".LISA/AUDIT/report.md",
    ".Lisa/Controls/evidence.json",
    ".git/HOOKS/pre-commit.SAMPLE",
  ])(
    "finds no line at %s, which differs from such a place only by case",
    file => {
      expect(createRepositoryReader(repository()).lineCount(file)).toBeNull();
    }
  );

  it("finds no line at a spelling the file system folds onto such a place", () => {
    // U+017F, the long s. A file system that ignores case folds it onto "s",
    // and lower-casing the text does not, so comparing the path as written
    // lets `.liſa/audit` through. Only the spelling the file system itself
    // holds tells the two apart. Where the file system does not fold the
    // letter the spelling names no file, and the answer is the same.
    const root = repository();
    const reader = createRepositoryReader(root);
    const folded = existsSync(path.join(root, `doc${LONG_S}/readme.md`));

    expect(reader.lineCount(`.li${LONG_S}a/audit/report.md`)).toBeNull();
    expect(
      reader.lineCount(`.li${LONG_S}a/control${LONG_S}/evidence.json`)
    ).toBeNull();
    expect(reader.lineCount(`.git/hooks/pre-commit.${LONG_S}ample`)).toBeNull();
    // The same letter in a path a pointer may name is followed wherever the
    // file system folds it, so the refusals above are not for a missing file.
    expect(reader.lineCount(`doc${LONG_S}/readme.md`)).toBe(folded ? 1 : null);
    expect(reader.isFolder(`doc${LONG_S}`)).toBe(folded);
  });

  it("answers the same when the repository is named in another letter case", () => {
    const root = repository();
    const shouted = path.join(
      path.dirname(root),
      path.basename(root).toUpperCase()
    );
    const reader = createRepositoryReader(existsSync(shouted) ? shouted : root);

    expect(reader.lineCount(README)).toBe(1);
    expect(reader.lineCount(AUDIT_REPORT_MARKDOWN_PATH)).toBeNull();
    expect(reader.isFolder("docs")).toBe(true);
  });
});

describe("the attest step", () => {
  /**
   * What the attest step writes down for a finding that points at one file.
   * @param repoPath - The repository root
   * @param file - The file the finding points at
   * @returns The record's rung, result and reason
   */
  function recorded(repoPath: string, file: string): unknown {
    const report = pointingAt(file);
    const [record] = findingRecords({
      report: {
        findings: report.findings as unknown as readonly AuditFinding[],
        answers: [],
      },
      inlineAnswers: { rendered: false, problems: [], entries: [] },
      criteria: CRITERIA,
      repository: createRepositoryReader(repoPath),
      stamp: {
        commit: null,
        freshnessSeconds: DEFAULT_FRESHNESS_SECONDS,
        checksDigest: SAMPLE_CHECKS.digest,
      },
      readAt: NOW,
    }).filter(each => each.criterion === FIRST);
    return {
      rung: record?.rung,
      result: record?.result,
      reason: record?.reason,
    };
  }

  it("has a requirement that a located file can meet to try this on", () => {
    expect(CRITERIA.find(criterion => criterion.id === FIRST)).toMatchObject({
      kind: "artifact",
      minimum_rung: "observed",
    });
  });

  it.each([AUDIT_REPORT_MARKDOWN_PATH, EVIDENCE_PATH, GIT_CONFIG, LINK_TO_GIT])(
    "does not record a requirement as held on a pointer at %s",
    file => {
      expect(recorded(repository(), file)).toEqual({
        rung: "asserted",
        result: "unknown",
        reason: "artifact-not-found",
      });
    }
  );

  it("records it as observed and held on a pointer at a file of the repository", () => {
    expect(recorded(repository(), README)).toEqual({
      rung: "observed",
      result: "held",
      reason: "artifact-located",
    });
  });
});
