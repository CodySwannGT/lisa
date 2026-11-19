/**
 * What a declared check with no moment to run at does to the outcome of the
 * requirements it is declared for (CodySwannGT/lisa#4994).
 *
 * A gate switched off at every moment runs nowhere. It must not count as the
 * answer to a requirement, and it must not hold back a requirement another
 * check serves: Lisa's own declaration switches one test gate off everywhere
 * and runs the same requirement through another.
 */
import { describe, expect, it } from "vitest";

import type { AuditFindingState } from "../../../src/controls/audit-report.js";
import { deriveCriteria } from "../../../src/controls/enforce-claims.js";
import type { TicketAnswer } from "../../../src/controls/enforce-tickets.js";
import type {
  CriterionEnforcement,
  EnforcedEntry,
} from "../../../src/controls/enforce-types.js";
import {
  FILED,
  RECORD,
  STYLE,
  criteriaOf,
  finding,
  idleEntry,
  judgedEntry,
  reportOf,
} from "./support/enforce-samples.js";

const WHOLE = "code-style@.";
const IN_PLACE = "exists-not-enforced";
const NOTHING = "nothing-to-enforce";
const NOT_APPLICABLE = "not-applicable";
const WIRED_HERE = judgedEntry(WHOLE, [STYLE], "wired");
const BLOCKED_HERE = judgedEntry(WHOLE, [STYLE], "blocked");

describe("a declared check with no moment to run at", () => {
  const OFF = "style-suites@.";
  const NO_CHECK_RUNS = "no check is declared to run";
  const CHOOSE_WHEN =
    "run the configure step and choose when this check has to pass";

  /**
   * Derive the outcome of one requirement for the whole repository.
   * @param criterion - The requirement
   * @param state - Where the audit found it
   * @param entries - The judged entries
   * @param ticket - What the ticket flow answered, if anything
   * @returns The requirement's row
   */
  function withEntries(
    criterion: string,
    state: AuditFindingState,
    entries: readonly EnforcedEntry[],
    ticket: TicketAnswer | null = null
  ): CriterionEnforcement | undefined {
    return deriveCriteria({
      criteria: criteriaOf([criterion]),
      report: reportOf([finding(criterion, ".", state)]),
      entries,
      ticketFor: () => ticket,
    })[0];
  }

  it("takes the outcome of the other check that serves the requirement", () => {
    const row = withEntries(STYLE, IN_PLACE, [
      idleEntry(OFF, [STYLE]),
      WIRED_HERE,
    ]);

    expect(row?.outcome).toBe("wired");
    expect(row?.reason).toBe(WIRED_HERE.reason);
    expect(row?.claims.map(claim => claim.id)).toEqual([WHOLE]);
  });

  it("stays out of it when the other check is blocked", () => {
    const row = withEntries(STYLE, IN_PLACE, [
      idleEntry(OFF, [STYLE]),
      BLOCKED_HERE,
    ]);

    expect(row?.outcome).toBe("blocked");
    expect(row?.reason).toBe(BLOCKED_HERE.reason);
  });

  it.each(["proved", IN_PLACE] as const)(
    "is blocked, saying no check is declared to run, when it alone serves a requirement the audit found %s",
    state => {
      const row = withEntries(STYLE, state, [idleEntry(OFF, [STYLE])]);

      expect(row?.outcome).toBe("blocked");
      expect(row?.reason).toContain(NO_CHECK_RUNS);
      expect(row?.reason).toContain(OFF);
      expect(row?.reason).toContain(CHOOSE_WHEN);
    }
  );

  it("is blocked for the folder it is declared in when the other check runs in a different folder", () => {
    const row = deriveCriteria({
      criteria: criteriaOf([STYLE]),
      report: reportOf([
        finding(STYLE, "api", IN_PLACE),
        finding(STYLE, "web", IN_PLACE),
      ]),
      entries: [
        idleEntry("style-suites@api", [STYLE]),
        judgedEntry("code-style@web", [STYLE], "wired"),
      ],
      ticketFor: () => null,
    })[0];

    expect(row?.outcome).toBe("blocked");
    expect(row?.claims.map(claim => [claim.id, claim.outcome])).toEqual([
      [`${STYLE}@api`, "blocked"],
      ["code-style@web", "wired"],
    ]);
    expect(row?.reason).toContain(NO_CHECK_RUNS);
  });

  it("does not turn a requirement that does not apply into one that waits on the operator", () => {
    const row = withEntries(STYLE, NOT_APPLICABLE, [idleEntry(OFF, [STYLE])]);

    expect(row?.outcome).toBe(NOTHING);
    expect(row?.reason).not.toContain(CHOOSE_WHEN);
  });

  it("leaves a missing capability with its ticket", () => {
    const row = withEntries(STYLE, "missing", [idleEntry(OFF, [STYLE])], FILED);

    expect(row?.outcome).toBe("ticketed");
  });

  it("does not block a written record it is also declared for", () => {
    const row = withEntries(RECORD, IN_PLACE, [
      idleEntry(OFF, [STYLE, RECORD]),
    ]);

    expect(row?.outcome).toBe(NOTHING);
  });

  it("still gives the requirement an outcome when it is the only thing that speaks for it", () => {
    const rows = deriveCriteria({
      criteria: criteriaOf([STYLE, RECORD]),
      report: reportOf([]),
      entries: [idleEntry(OFF, [STYLE, RECORD])],
      ticketFor: () => null,
    });

    expect(rows.map(row => [row.criterion, row.outcome])).toEqual([
      [RECORD, NOTHING],
      [STYLE, "blocked"],
    ]);
    expect(rows[1]?.reason).toContain(NO_CHECK_RUNS);
    expect(rows[1]?.reason).toContain(CHOOSE_WHEN);
  });
});
