/**
 * What an audit finding is written down as, by what kind of thing answers
 * its requirement (CodySwannGT/lisa#4998).
 *
 * A record that exists counts once the attest step has itself found the
 * file and line the audit pointed at. Something only a person can vouch for
 * counts once a person's answer is on record. A check is never shown by a
 * finding. In every case the record says how strongly it is known, so a
 * reader can tell an agent's reading from a person's word from a proof.
 */
import { describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_MARKDOWN_PATH,
  type AuditFinding,
  type AuditReport,
  type InlineAnswers,
} from "../../../src/controls/audit-report-types.js";
import type { InScopeCriterion } from "../../../src/controls/catalogue.js";
import { parseEvidenceDocument } from "../../../src/controls/evidence-document.js";
import { findingRecords } from "../../../src/controls/evidence-findings.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  type EvidenceRecord,
} from "../../../src/controls/evidence-types.js";
import type { RepositoryReader } from "../../../src/controls/repository-reader.js";
import {
  evidenceOf,
  RECORDED_AT,
  requirement,
  SAMPLE_CHECKS,
  SAMPLE_COMMIT,
} from "./support/evidence-samples.js";

const FOUND = "exists-not-enforced";
const ARTIFACT = "AC1.1";
const ATTESTED = "AC1.4";
const GATE = "SI7";
const NOT_APPLICABLE = "not-applicable";
const NO_ATTESTATION = "no-attestation";
const WHAT = "The access review is written down.";
const RECORD = "docs/access.md";

/** One requirement of each kind. */
const CRITERIA = [
  requirement(ARTIFACT, "artifact", "observed"),
  requirement(ATTESTED, "human-attested", "asserted"),
  requirement(GATE, "gate", "exercised"),
] as readonly InScopeCriterion[];

/** A repository that holds one file of ten lines. */
const REPOSITORY: RepositoryReader = {
  lineCount: file => (file === RECORD ? 10 : null),
  isFolder: () => true,
};

/**
 * A finding as the audit writes it.
 * @param criterion - The requirement
 * @param state - The state the audit chose
 * @param locators - Where the audit pointed
 * @param scope - The folder it is about
 * @returns The finding
 */
function finding(
  criterion: string,
  state: AuditFinding["state"],
  locators: readonly { readonly path: string; readonly line: number }[] = [],
  scope = "."
): AuditFinding {
  return {
    criterion,
    scope,
    state,
    what: WHAT,
    why: "Why it matters.",
    next: "What to do next.",
    mechanisms:
      locators.length === 0
        ? []
        : [
            {
              tool: "a written record",
              command: null,
              moment: "none",
              locators,
            },
          ],
  };
}

/**
 * What stands on the answer lines of the rendered report when a person
 * typed each of the given answers there.
 * @param answers - The answers, as the report holds them
 * @returns What reading the file gives
 */
function typedAs(answers: AuditReport["answers"]): InlineAnswers {
  return {
    rendered: true,
    problems: [],
    entries: answers.map((answer, index) => ({
      id: answer.id,
      question: answer.question,
      answer: answer.answer,
      answered: true,
      file: AUDIT_REPORT_MARKDOWN_PATH,
      line: 12 + index,
    })),
  };
}

/** A repository with no rendered report: nobody has typed anything. */
const NOTHING_TYPED: InlineAnswers = {
  rendered: false,
  problems: [],
  entries: [],
};

/**
 * The record one finding is written down as.
 * @param found - The finding
 * @param answers - The answers the report holds
 * @param typed - What stands on the answer lines; by default, exactly the
 *   answers the report holds, as when a person typed each one
 * @returns The record, or `undefined` when the finding gets none
 */
function written(
  found: AuditFinding,
  answers: AuditReport["answers"] = [],
  typed: InlineAnswers = typedAs(answers)
): EvidenceRecord | undefined {
  const records = findingRecords({
    report: { findings: [found], answers },
    inlineAnswers: typed,
    criteria: CRITERIA,
    repository: REPOSITORY,
    stamp: {
      commit: SAMPLE_COMMIT,
      freshnessSeconds: DEFAULT_FRESHNESS_SECONDS,
      checksDigest: SAMPLE_CHECKS.digest,
    },
    readAt: new Date(RECORDED_AT),
  });
  expect(parseEvidenceDocument(evidenceOf(records)).problems).toBeNull();
  return records[0];
}

describe("a finding about a record that exists", () => {
  it("is written as observed and held once every line it points at is found", () => {
    expect(
      written(
        finding(ARTIFACT, FOUND, [
          { path: RECORD, line: 1 },
          { path: RECORD, line: 10 },
        ])
      )
    ).toEqual({
      id: `audit-finding/${ARTIFACT}@.`,
      criterion: ARTIFACT,
      entry_id: null,
      scope: ".",
      rung: "observed",
      moment: null,
      result: "held",
      reason: "artifact-located",
      detail:
        "The access review is written down. The attest step found every line the audit pointed at: docs/access.md line 1, docs/access.md line 10.",
      commit: SAMPLE_COMMIT,
      checks_digest: SAMPLE_CHECKS.digest,
      command: null,
      exit_status: null,
      started_at: RECORDED_AT,
      completed_at: RECORDED_AT,
      freshness_seconds: DEFAULT_FRESHNESS_SECONDS,
      output_excerpt: "",
      output_truncated: false,
    });
  });

  it.each([
    [
      "the file it points at is gone",
      [{ path: "docs/gone.md", line: 1 }],
      "nothing is at docs/gone.md line 1",
    ],
    [
      "the line it points at is past the end of the file",
      [{ path: RECORD, line: 11 }],
      "nothing is at docs/access.md line 11",
    ],
    [
      "one of two pointers leads nowhere",
      [
        { path: RECORD, line: 2 },
        { path: "docs/gone.md", line: 1 },
      ],
      "nothing is at docs/gone.md line 1",
    ],
    [
      "it points at no file and line",
      [],
      "the audit pointed at no file and line",
    ],
  ])("is written as unknown when %s", (_name, locators, saying) => {
    const record = written(finding(ARTIFACT, FOUND, locators));

    expect(record).toMatchObject({
      rung: "asserted",
      result: "unknown",
      reason: "artifact-not-found",
    });
    expect(record?.detail).toContain(
      "could not find the record where the audit pointed"
    );
    expect(record?.detail).toContain(saying);
  });
});

describe("a finding about something a person vouches for", () => {
  const where = [{ path: RECORD, line: 3 }];
  const answer = {
    id: `${ATTESTED}@.`,
    question: "Who reviews the agents' access, and how often?",
    answer: "The platform lead, every quarter.",
  };
  const answers = [answer];

  it("is written as asserted and held when a person's answer is on record, quoting it", () => {
    expect(written(finding(ATTESTED, FOUND, where), answers)).toMatchObject({
      rung: "asserted",
      result: "held",
      reason: "person-attested",
      detail: `A person answered the audit's question "${ATTESTED}@." (Who reviews the agents' access, and how often?): "The platform lead, every quarter.". The access review is written down.`,
    });
  });

  it("is written as unknown when no person has answered, however well it is written down", () => {
    const record = written(finding(ATTESTED, FOUND, where));

    expect(record).toMatchObject({
      rung: "asserted",
      result: "unknown",
      reason: NO_ATTESTATION,
    });
    expect(record?.detail).toContain(
      `no person's answer to the audit's question "${ATTESTED}@." is on record`
    );
  });

  it("is not helped by an answer to another folder's question", () => {
    expect(
      written(finding(ATTESTED, FOUND, where, "api"), answers)
    ).toMatchObject({ result: "unknown", reason: NO_ATTESTATION });
  });

  describe("when the report holds an answer nobody typed", () => {
    const stillOpen: InlineAnswers = {
      ...typedAs(answers),
      entries: typedAs(answers).entries.map(entry => ({
        ...entry,
        answer: null,
        answered: false,
      })),
    };
    const unreadable: InlineAnswers = {
      rendered: true,
      problems: [".lisa/audit/report.md line 9 is not part of a question."],
      entries: [],
    };

    it.each([
      ["there is no rendered report to show a person typed it", NOTHING_TYPED],
      ["the rendered report shows the question as still open", stillOpen],
      [
        "the answer line holds different words",
        typedAs([{ ...answer, answer: "Nobody, yet." }]),
      ],
      [
        "the answer is typed on another question's line",
        typedAs([{ ...answer, id: `${ATTESTED}@api` }]),
      ],
      ["the rendered report cannot be read in the written form", unreadable],
    ])("is written as unknown when %s", (_name, typed) => {
      const record = written(finding(ATTESTED, FOUND, where), answers, typed);

      expect(record).toMatchObject({
        rung: "asserted",
        result: "unknown",
        reason: NO_ATTESTATION,
      });
      expect(record?.detail).toBe(
        `Only a person can vouch for this requirement, and the answer the audit report holds to the question "${ATTESTED}@." is not written on that question's answer line in .lisa/audit/report.md, so nothing shows that a person gave it. A person has to type the answer on that line, and the audit has to be run again.`
      );
      expect(record?.detail).not.toContain(answer.answer);
    });

    it.each(["TBD", "?", "n/a", "_(human fills in)_", "*(human fills in)*"])(
      "is written as unknown when the answer is only the placeholder %s",
      placeholder => {
        const held = [{ ...answer, answer: placeholder }];

        expect(
          written(finding(ATTESTED, FOUND, where), held, typedAs(held))
        ).toMatchObject({ result: "unknown", reason: NO_ATTESTATION });
      }
    );
  });
});

describe("a finding about a check", () => {
  it("is written as asserted, whatever it points at", () => {
    expect(
      written(finding(GATE, FOUND, [{ path: RECORD, line: 1 }]))
    ).toMatchObject({
      rung: "asserted",
      result: "held",
      reason: FOUND,
      detail: WHAT,
    });
  });
});

describe("a finding in any other state, for every kind", () => {
  it.each([ARTIFACT, ATTESTED, GATE])(
    "keeps its state as the reason and its words as the detail (%s)",
    criterion => {
      const results = (
        ["missing", "unknown", "question", NOT_APPLICABLE] as const
      ).map(state => {
        const record = written(finding(criterion, state));
        return [record?.rung, record?.result, record?.reason, record?.detail];
      });
      const what = WHAT;

      expect(results).toEqual([
        ["asserted", "failed", "missing", what],
        ["asserted", "unknown", "unknown", what],
        ["asserted", "unknown", "question", what],
        ["asserted", NOT_APPLICABLE, NOT_APPLICABLE, what],
      ]);
    }
  );

  it.each([ARTIFACT, ATTESTED, GATE])(
    "gets no record when it only repeats a record already on file (%s)",
    criterion => {
      expect(written(finding(criterion, "proved"))).toBeUndefined();
    }
  );
});
