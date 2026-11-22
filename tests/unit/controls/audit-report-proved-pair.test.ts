/**
 * A finding says `proved` only from a record of the very thing it claims.
 *
 * The record a `proved` finding cites has to be for the finding's own
 * requirement, which was already checked, and also for its own folder, and
 * it has to be a whole proof. A control is proved by two planted changes: one
 * that breaks the rule and is refused, one that keeps it and is accepted. A
 * finding for one folder used to pass by citing the accepted half recorded
 * for another folder; these cases pin that it no longer does, and that a
 * finding in any other state cites nothing (CodySwannGT/lisa#4978).
 */
import { describe, expect, it } from "vitest";

import {
  formatAuditReportViolation,
  validateAuditReport,
  type AuditReportViolation,
} from "../../../src/controls/audit-report.js";
import type { EvidenceRecordRef } from "../../../src/controls/evidence.js";
import {
  amendFinding,
  completeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  API,
  AT_FIRST,
  CRITERIA,
  EXISTS_NOT_ENFORCED,
  FIRST,
  FRESH,
  LINTER,
  PART_FIRST,
  RULE,
  WHOLE,
  context,
  withFirst,
} from "./audit-report-facts.js";

const WEB = "web";
const WEB_CONFIG = "web/eslint.config.js";
const VIOLATION = "violation";
const CLEAN = "clean";

/**
 * One half of a control's paired proof, as the evidence file holds it.
 * @param scope - The folder the control covers
 * @param half - Which half
 * @param change - Fields that differ
 * @returns The record
 */
function halfRecord(
  scope: string,
  half: string,
  change: Partial<EvidenceRecordRef> = {}
): EvidenceRecordRef {
  return {
    id: `code-style@${scope}/commit/${half}/${PART_FIRST}`,
    criterion: PART_FIRST,
    completed_at: "2026-11-17T11:00:00.000Z",
    freshness_seconds: 86_400,
    entry_id: `code-style@${scope}`,
    scope,
    rung: "exercised",
    half,
    moment: "commit",
    ...change,
  };
}

/**
 * A record of a merge setting read from the hosting platform for the control
 * that covers `web`: something looked at, with no halves, where nothing was
 * tried.
 * @returns The record
 */
function settingRecord(): EvidenceRecordRef {
  return halfRecord(WEB, CLEAN, {
    id: `code-style@${WEB}/pull-request/observed/${PART_FIRST}`,
    rung: "observed",
    half: null,
    moment: "pull-request",
  });
}

/**
 * Both halves of a control's proof.
 * @param scope - The folder the control covers
 * @returns The two records, the refused change first
 */
function pair(scope: string): readonly EvidenceRecordRef[] {
  return [halfRecord(scope, VIOLATION), halfRecord(scope, CLEAN)];
}

/**
 * A report for a repository with two parts, in which the first per-part
 * requirement is said to be proved in `web` from one record.
 * @param evidenceId - The record the finding cites
 * @returns The report
 */
function provedInWeb(evidenceId: string): SampleReport {
  return amendFinding(
    completeAuditReport([WHOLE, API, WEB]),
    { criterion: PART_FIRST, scope: WEB },
    {
      state: "proved",
      evidence_id: evidenceId,
      mechanisms: [{ ...LINTER, locators: [{ path: WEB_CONFIG, line: 1 }] }],
    }
  );
}

/**
 * Check a report against an evidence file.
 * @param report - The report
 * @param evidence - The usable records of the evidence file
 * @returns The violations found
 */
function checked(
  report: SampleReport,
  evidence: readonly EvidenceRecordRef[]
): readonly AuditReportViolation[] {
  return validateAuditReport(
    report,
    context({
      evidence,
      repository: {
        lineCount: file =>
          file === WEB_CONFIG || file === "ruff.toml" ? 5 : null,
        isFolder: folder => [WHOLE, API, WEB].includes(folder),
      },
    })
  ).violations;
}

/**
 * The one violation a report is expected to have, as the check prints it.
 * @param violations - What the check found
 * @returns The line
 */
function onlyLine(violations: readonly AuditReportViolation[]): string {
  expect(violations).toHaveLength(1);
  expect(violations[0]).toMatchObject({
    rule: RULE.provedEvidence,
    field: "evidence_id",
  });
  return violations[0] ? formatAuditReportViolation(violations[0]) : "";
}

describe("a proved finding for one folder", () => {
  it("passes when both halves of the proof are on record for that folder", () => {
    const records = pair(WEB);

    expect(checked(provedInWeb(records[0]?.id ?? ""), records)).toEqual([]);
    expect(checked(provedInWeb(records[1]?.id ?? ""), records)).toEqual([]);
  });

  it("is refused when it cites a record made for another folder", () => {
    const cited = halfRecord(API, CLEAN);

    expect(onlyLine(checked(provedInWeb(cited.id), pair(API)))).toBe(
      `Evidence record "${cited.id}" is about the folder api, so it cannot prove the requirement for the folder web. Cite a record for this part, or choose another state. (requirement ${PART_FIRST}, folder web)`
    );
  });

  it("is refused when it cites a record that does not say what folder it is about", () => {
    const cited = halfRecord(WEB, CLEAN, { scope: null });

    expect(onlyLine(checked(provedInWeb(cited.id), [cited]))).toContain(
      "does not say which part of the repository it is about"
    );
  });

  it("passes on a proof of a control that covers the whole repository", () => {
    const records = pair(WHOLE);

    expect(checked(provedInWeb(records[1]?.id ?? ""), records)).toEqual([]);
  });
});

describe("a proved finding for the whole repository", () => {
  it("is refused when it cites a record about one folder", () => {
    const cited = halfRecord(API, CLEAN, { criterion: FIRST });
    const report = withFirst({
      state: "proved",
      evidence_id: cited.id,
      mechanisms: [LINTER],
    });

    expect(
      onlyLine(
        checked(report, [
          cited,
          halfRecord(API, VIOLATION, { criterion: FIRST }),
        ])
      )
    ).toContain(
      "is about the folder api, so it cannot prove the requirement for the whole repository"
    );
  });
});

describe("a proved finding that cites one half of a proof", () => {
  const clean = halfRecord(WEB, CLEAN);

  it.each([
    { name: "the other half is not on record", others: [] },
    {
      name: "the other half is too old to rely on",
      others: [
        halfRecord(WEB, VIOLATION, {
          completed_at: "2026-11-01T00:00:00.000Z",
        }),
      ],
    },
    {
      name: "the other half was run at another moment",
      others: [halfRecord(WEB, VIOLATION, { moment: "push" })],
    },
    {
      name: "the other half is of another control",
      others: [halfRecord(WEB, VIOLATION, { entry_id: "type-check@web" })],
    },
    {
      name: "the other half is of another folder's control",
      others: [halfRecord(API, VIOLATION)],
    },
    {
      name: "the other half is for another requirement",
      others: [halfRecord(WEB, VIOLATION, { criterion: FIRST })],
    },
    {
      name: "only the same half is on record twice",
      others: [halfRecord(WEB, CLEAN, { id: "a-second-clean-half" })],
    },
  ])("is refused when $name", ({ others }) => {
    expect(onlyLine(checked(provedInWeb(clean.id), [clean, ...others]))).toBe(
      `Evidence record "${clean.id}" is one half of a proof, and the other half (the change that breaks the rule and has to be refused) is not on record as held and current. A control is proved only by both halves. Run the attest step again, or choose another state. (requirement ${PART_FIRST}, folder web)`
    );
  });

  it("names the accepted change when the refused one is what it cites", () => {
    const violation = halfRecord(WEB, VIOLATION);

    expect(onlyLine(checked(provedInWeb(violation.id), [violation]))).toContain(
      "the other half (the change that keeps the rule and has to be accepted)"
    );
  });

  it("is refused when the record does not say which half it is", () => {
    const cited = halfRecord(WEB, CLEAN, { half: null });

    expect(
      onlyLine(checked(provedInWeb(cited.id), [cited, ...pair(WEB)]))
    ).toContain("does not say which half of which control's proof it is");
  });
});

describe("a proved finding that cites a record which stands on its own", () => {
  it("passes on a setting read from the hosting platform, which has no halves", () => {
    const report = withFirst({
      state: "proved",
      evidence_id: FRESH.id,
      mechanisms: [LINTER],
    });

    expect(checked(report, [FRESH])).toEqual([]);
  });

  it("has a requirement that only a tried change proves, and one a look is enough for", () => {
    expect(CRITERIA.find(each => each.id === PART_FIRST)).toMatchObject({
      kind: "gate",
      minimum_rung: "exercised",
    });
    expect(CRITERIA.find(each => each.id === FIRST)).toMatchObject({
      minimum_rung: "observed",
    });
  });

  it("is refused when the requirement needs a change to have been tried and the record only looked at a setting", () => {
    const looked = settingRecord();

    expect(onlyLine(checked(provedInWeb(looked.id), [looked]))).toBe(
      `Evidence record "${looked.id}" is observed (something was looked at where it is: a setting read from the system that holds it, or a file found where the audit pointed). This requirement is proved only by evidence that is exercised (a change was planted and the control's answer recorded). Cite a record of that strength for this requirement, or choose another state. (requirement ${PART_FIRST}, folder web)`
    );
  });

  it("is refused on the same record when both halves of the proof are on record beside it", () => {
    const looked = settingRecord();

    expect(
      onlyLine(checked(provedInWeb(looked.id), [looked, ...pair(WEB)]))
    ).toContain(
      "This requirement is proved only by evidence that is exercised"
    );
  });

  it("is refused when the record is weaker than a requirement that a look is enough for", () => {
    const said = { ...FRESH, id: "ev-said", rung: "asserted" };
    const report = withFirst({
      state: "proved",
      evidence_id: said.id,
      mechanisms: [LINTER],
    });

    expect(onlyLine(checked(report, [said]))).toBe(
      `Evidence record "${said.id}" is asserted (it was said, and nothing checked it). This requirement is proved only by evidence that is observed (something was looked at where it is: a setting read from the system that holds it, or a file found where the audit pointed). Cite a record of that strength for this requirement, or choose another state. (requirement ${FIRST}, whole repository)`
    );
  });

  it.each([
    { name: "does not say how strongly it is known", rung: null },
    { name: "names a strength that is not one of the three", rung: "seen" },
  ])("is refused when the record $name", ({ rung }) => {
    const vague = { ...FRESH, id: "ev-vague", rung };
    const report = withFirst({
      state: "proved",
      evidence_id: vague.id,
      mechanisms: [LINTER],
    });

    expect(onlyLine(checked(report, [vague]))).toBe(
      `Evidence record "${vague.id}" does not say how strongly it is known, so it cannot prove anything. Run the attest step again, or choose another state. (requirement ${FIRST}, whole repository)`
    );
  });

  it("passes on a stronger record than the requirement asks for", () => {
    const records = [
      halfRecord(WHOLE, VIOLATION, { criterion: FIRST }),
      halfRecord(WHOLE, CLEAN, { criterion: FIRST }),
    ];
    const report = withFirst({
      state: "proved",
      evidence_id: records[0]?.id ?? "",
      mechanisms: [LINTER],
    });

    expect(checked(report, records)).toEqual([]);
  });
});

describe("a finding that does not say proved", () => {
  it.each([
    EXISTS_NOT_ENFORCED,
    "missing",
    "not-applicable",
    "unknown",
    "question",
  ])("is refused when it cites an evidence record while %s", state => {
    const report = withFirst({
      state,
      evidence_id: FRESH.id,
      ...(state === EXISTS_NOT_ENFORCED ? { mechanisms: [LINTER] } : {}),
    });
    const violations = checked(report, [FRESH]).filter(
      violation => violation.rule === RULE.provedEvidence
    );

    expect(onlyLine(violations)).toBe(
      `This finding cites evidence record "${FRESH.id}" but does not say the requirement is proved. Only a proved finding cites a record: remove "evidence_id" from this one. (requirement ${AT_FIRST.criterion}, whole repository)`
    );
  });

  it("is accepted with no record cited", () => {
    expect(
      checked(withFirst({ state: EXISTS_NOT_ENFORCED, mechanisms: [LINTER] }), [
        FRESH,
      ])
    ).toEqual([]);
  });
});
