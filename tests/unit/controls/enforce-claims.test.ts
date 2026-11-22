/**
 * How a requirement's one enforce outcome is derived from what the audit
 * found and from the register entries that serve it
 * (CodySwannGT/lisa#4994, R32).
 */
import { describe, expect, it } from "vitest";

import type { AuditFindingState } from "../../../src/controls/audit-report.js";
import {
  deriveCriteria,
  outcomeProblems,
} from "../../../src/controls/enforce-claims.js";
import type { TicketAnswer } from "../../../src/controls/enforce-tickets.js";
import type {
  CriterionEnforcement,
  EnforcedEntry,
  EnforceOutcome,
} from "../../../src/controls/enforce-types.js";
import {
  FILED,
  PERSON,
  RECORD,
  STYLE,
  UNFILED,
  criteriaOf,
  finding,
  judgedEntry,
  reportOf,
} from "./support/enforce-samples.js";

/** One row of the derivation: one finding, the entries, and the result. */
interface Row {
  readonly name: string;
  readonly criterion: string;
  readonly state: AuditFindingState;
  readonly entries?: readonly EnforcedEntry[];
  readonly ticket?: TicketAnswer;
  readonly outcome: EnforceOutcome;
}

const WHOLE = "code-style@.";
const IN_API = "code-style@api";
const IN_PLACE = "exists-not-enforced";
const TICKET = "tracker#12";
const NOTHING = "nothing-to-enforce";
const NOT_APPLICABLE = "not-applicable";
const WIRED_HERE = judgedEntry(WHOLE, [STYLE], "wired");
const BLOCKED_HERE = judgedEntry(WHOLE, [STYLE], "blocked");

const ROWS: readonly Row[] = [
  {
    name: "a missing capability with a ticket",
    criterion: STYLE,
    state: "missing",
    ticket: FILED,
    outcome: "ticketed",
  },
  {
    name: "a missing capability no ticket could be filed for",
    criterion: STYLE,
    state: "missing",
    ticket: UNFILED,
    outcome: "blocked",
  },
  {
    name: "a question nobody has answered",
    criterion: PERSON,
    state: "question",
    outcome: "blocked",
  },
  {
    name: "a requirement that could not be checked for want of access",
    criterion: RECORD,
    state: "unknown",
    outcome: "blocked",
  },
  {
    name: "a requirement that does not apply",
    criterion: STYLE,
    state: NOT_APPLICABLE,
    outcome: NOTHING,
  },
  {
    name: "a written record the audit found in place",
    criterion: RECORD,
    state: IN_PLACE,
    outcome: NOTHING,
  },
  {
    name: "a person's word the audit found on record",
    criterion: PERSON,
    state: IN_PLACE,
    outcome: NOTHING,
  },
  {
    name: "a check that exists and that nobody declared",
    criterion: STYLE,
    state: IN_PLACE,
    outcome: "blocked",
  },
  {
    name: "a declared check whose enforcement points are wired",
    criterion: STYLE,
    state: IN_PLACE,
    entries: [WIRED_HERE],
    outcome: "wired",
  },
  {
    name: "a proved check whose enforcement points are wired",
    criterion: STYLE,
    state: "proved",
    entries: [WIRED_HERE],
    outcome: "wired",
  },
  {
    name: "a declared check with a blocked enforcement point",
    criterion: STYLE,
    state: IN_PLACE,
    entries: [BLOCKED_HERE],
    outcome: "blocked",
  },
  {
    name: "a missing capability with a ticket, beside a wired entry",
    criterion: STYLE,
    state: "missing",
    ticket: FILED,
    entries: [WIRED_HERE],
    outcome: "ticketed",
  },
];

/**
 * Derive the outcome of one requirement from one finding.
 * @param row - The case
 * @returns The requirement's row
 */
function derive(row: Row): CriterionEnforcement | undefined {
  return deriveCriteria({
    criteria: criteriaOf([row.criterion]),
    report: reportOf([finding(row.criterion, ".", row.state)]),
    entries: row.entries ?? [],
    ticketFor: () => row.ticket ?? null,
  })[0];
}

describe("the one outcome of a requirement", () => {
  it.each(ROWS)("is $outcome for $name", row => {
    expect(derive(row)?.outcome).toBe(row.outcome);
  });

  it("gives every requirement exactly one row, in catalogue order", () => {
    const criteria = criteriaOf([STYLE, RECORD, PERSON]);
    const rows = deriveCriteria({
      criteria,
      report: reportOf([
        finding(STYLE, ".", NOT_APPLICABLE),
        finding(PERSON, ".", "question"),
        finding(RECORD, ".", "unknown"),
      ]),
      entries: [],
      ticketFor: () => null,
    });

    expect(rows.map(row => row.criterion)).toEqual(
      criteria.map(criterion => criterion.id)
    );
    expect(outcomeProblems(rows, criteria)).toEqual([]);
  });

  it("carries the plain question and the ticket, never the id, in what it says", () => {
    const row = derive({
      name: "",
      criterion: STYLE,
      state: "missing",
      ticket: FILED,
      outcome: "ticketed",
    });

    expect(row?.question).toBe(criteriaOf([STYLE])[0]?.question);
    expect(row?.tickets).toEqual([TICKET]);
    expect(row?.reason).toContain(TICKET);
    expect(row?.reason).not.toContain(STYLE);
  });

  it("says what the operator is asked when it is waiting on an answer", () => {
    const row = derive({
      name: "",
      criterion: PERSON,
      state: "question",
      outcome: "blocked",
    });

    expect(row?.reason).toContain("Who answers for what the agents do here?");
    expect(row?.reason).toContain(".lisa/audit/report.md");
  });
});

describe("a requirement answered in more than one part", () => {
  const criteria = criteriaOf([STYLE]);

  /**
   * Derive the outcome of the style requirement over two folders.
   * @param web - Where it stands in the folder `web`
   * @param entries - The judged entries
   * @param ticket - What the ticket flow answered, if anything
   * @returns The requirement's row
   */
  function overTwoParts(
    web: AuditFindingState,
    entries: readonly EnforcedEntry[],
    ticket: TicketAnswer | null = null
  ): CriterionEnforcement | undefined {
    return deriveCriteria({
      criteria,
      report: reportOf([
        finding(STYLE, "api", IN_PLACE),
        finding(STYLE, "web", web),
      ]),
      entries,
      ticketFor: (_criterion, scope) => (scope === "web" ? ticket : null),
    })[0];
  }

  const API_WIRED = judgedEntry(IN_API, [STYLE], "wired");

  it("is blocked when one part is wired and nothing is declared for the other", () => {
    const row = overTwoParts(IN_PLACE, [API_WIRED]);

    expect(row?.outcome).toBe("blocked");
    expect(row?.claims.map(claim => [claim.id, claim.outcome])).toEqual([
      [`${STYLE}@web`, "blocked"],
      [IN_API, "wired"],
    ]);
  });

  it("is ticketed when one part is wired and the other has a ticket", () => {
    const row = overTwoParts("missing", [API_WIRED], FILED);

    expect(row?.outcome).toBe("ticketed");
    expect(row?.tickets).toEqual([TICKET]);
  });

  it("is blocked, not ticketed, when one part is blocked and the other has a ticket", () => {
    const row = overTwoParts(
      "missing",
      [judgedEntry(IN_API, [STYLE], "blocked")],
      FILED
    );

    expect(row?.outcome).toBe("blocked");
    expect(row?.tickets).toEqual([TICKET]);
  });

  it("is wired when one part is wired and the requirement does not apply to the other", () => {
    expect(overTwoParts(NOT_APPLICABLE, [API_WIRED])?.outcome).toBe("wired");
  });

  it("lets an entry for the whole repository speak for every folder", () => {
    const row = overTwoParts(IN_PLACE, [judgedEntry(WHOLE, [STYLE], "wired")]);

    expect(row?.outcome).toBe("wired");
  });
});

describe("the check that every requirement has exactly one outcome", () => {
  const criteria = criteriaOf([STYLE, RECORD]);
  const rows = deriveCriteria({
    criteria,
    report: reportOf([
      finding(STYLE, ".", NOT_APPLICABLE),
      finding(RECORD, ".", "unknown"),
    ]),
    entries: [],
    ticketFor: () => null,
  });

  it("names a requirement that has none", () => {
    expect(outcomeProblems(rows.slice(0, 1), criteria)).toEqual([
      expect.stringContaining("has no outcome"),
    ]);
  });

  it("names a requirement that has two", () => {
    expect(outcomeProblems([...rows, ...rows.slice(0, 1)], criteria)).toEqual([
      expect.stringContaining("has 2 outcomes"),
    ]);
  });

  it("leaves a requirement with neither a finding nor an entry without a row", () => {
    const derived = deriveCriteria({
      criteria,
      report: reportOf([finding(STYLE, ".", NOT_APPLICABLE)]),
      entries: [],
      ticketFor: () => null,
    });

    expect(derived.map(row => row.criterion)).toEqual([STYLE]);
    expect(outcomeProblems(derived, criteria)).toHaveLength(1);
  });
});
