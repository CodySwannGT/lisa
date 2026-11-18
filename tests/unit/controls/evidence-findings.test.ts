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

import type {
  AuditFinding,
  AuditReport,
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
  SAMPLE_COMMIT,
} from "./support/evidence-samples.js";

const FOUND = "exists-not-enforced";
const ARTIFACT = "AC1.1";
const ATTESTED = "AC1.4";
const GATE = "SI7";
const NOT_APPLICABLE = "not-applicable";
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
 * The record one finding is written down as.
 * @param found - The finding
 * @param answers - The answers people gave, as the report holds them
 * @returns The record, or `undefined` when the finding gets none
 */
function written(
  found: AuditFinding,
  answers: AuditReport["answers"] = []
): EvidenceRecord | undefined {
  const records = findingRecords({
    report: { findings: [found], answers },
    criteria: CRITERIA,
    repository: REPOSITORY,
    stamp: {
      commit: SAMPLE_COMMIT,
      freshnessSeconds: DEFAULT_FRESHNESS_SECONDS,
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
  const answers = [
    {
      id: `${ATTESTED}@.`,
      question: "Who reviews the agents' access, and how often?",
      answer: "The platform lead, every quarter.",
    },
  ];

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
      reason: "no-attestation",
    });
    expect(record?.detail).toContain(
      `no person's answer to the audit's question "${ATTESTED}@." is on record`
    );
  });

  it("is not helped by an answer to another folder's question", () => {
    expect(
      written(finding(ATTESTED, FOUND, where, "api"), answers)
    ).toMatchObject({ result: "unknown", reason: "no-attestation" });
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
