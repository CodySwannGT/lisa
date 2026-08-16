/**
 * Tests for the scheduled health consumer's ticket planning.
 *
 * These are the acceptance criteria of #1530, which called idempotency "the
 * whole ballgame" — a nightly cron that refiles the same drift every night is
 * worse than no cron at all, because it teaches people to ignore its tickets.
 *
 * Two assertions carry the weight, and they pull in opposite directions:
 *
 *  - an OPEN ticket for a check must suppress a refile, and
 *  - a CLOSED ticket must NOT.
 *
 * The naive marker search — "has this marker ever been used?" — satisfies the
 * first and fails the second, so they are asserted in the same file. A fix to
 * one cannot quietly break the other without turning this suite red.
 * @module tests/unit/health/drift-tickets
 */

import { describe, expect, it } from "vitest";

import type { HealthFinding } from "../../../src/health/contract.js";
import {
  driftMarker,
  planDriftTickets,
  type OpenTicket,
} from "../../../src/health/drift-tickets.js";

const CHECK_A = "coverage-floor";
const CHECK_B = "managed-file-drift";

/**
 * A finding for one check at a given status.
 * @param check - Check id
 * @param status - Health status
 * @returns A finding shaped like the contract's
 */
const finding = (
  check: string,
  status: HealthFinding["status"]
): HealthFinding => ({
  check,
  layer: "deterministic",
  status,
  reason: `${check} is ${status}`,
});

/**
 * An open ticket already tracking one check.
 * @param id - Tracker id
 * @param check - Check the ticket tracks
 * @returns An open ticket carrying that check's marker
 */
const tracking = (id: string, check: string): OpenTicket => ({
  id,
  body: `whatever prose the tracker holds\n${driftMarker(check)}`,
});

describe("planDriftTickets", () => {
  it("files nothing for a project in band", () => {
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "pass"), finding(CHECK_B, "pass")],
      openTickets: [],
    });
    expect(plan.file).toEqual([]);
    expect(plan.alreadyTracked).toEqual([]);
  });

  it("files exactly one ticket per drifting check", () => {
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "fail"), finding(CHECK_B, "pass")],
      openTickets: [],
    });
    expect(plan.file).toHaveLength(1);
    expect(plan.file[0]?.check).toBe(CHECK_A);
  });

  it("treats a warning as drift, not only a failure", () => {
    // `warn` is the status the agentic layer emits, and it is the whole reason
    // that layer exists. Filing only on `fail` would make it decorative.
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "warn")],
      openTickets: [],
    });
    expect(plan.file).toHaveLength(1);
  });

  it("files two tickets when two checks drift", () => {
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "fail"), finding(CHECK_B, "warn")],
      openTickets: [],
    });
    expect(plan.file.map(ticket => ticket.check)).toEqual([CHECK_A, CHECK_B]);
  });

  it("carries a marker naming the check", () => {
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "fail")],
      openTickets: [],
    });
    expect(plan.file[0]?.marker).toBe(driftMarker(CHECK_A));
    expect(plan.file[0]?.body).toContain(driftMarker(CHECK_A));
  });

  it("does not refile drift an OPEN ticket already tracks", () => {
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "fail")],
      openTickets: [tracking("42", CHECK_A)],
    });
    expect(plan.file).toEqual([]);
    // Reported rather than dropped: a run that says "nothing to do" should be
    // able to say why, or it is indistinguishable from a run that found nothing.
    expect(plan.alreadyTracked).toEqual([{ check: CHECK_A, ticketId: "42" }]);
  });

  it("does not let one check's open ticket suppress another's drift", () => {
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "fail"), finding(CHECK_B, "fail")],
      openTickets: [tracking("42", CHECK_A)],
    });
    expect(plan.file.map(ticket => ticket.check)).toEqual([CHECK_B]);
    expect(plan.alreadyTracked.map(entry => entry.check)).toEqual([CHECK_A]);
  });

  it("files again when the tracking ticket is CLOSED", () => {
    // The counterpart to the suppression test above, and the one a naive
    // "has this marker ever been used" implementation gets wrong. A closed
    // ticket is simply absent from `openTickets`, so suppression is impossible
    // by construction rather than by a conditional someone could invert.
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "fail")],
      openTickets: [],
    });
    expect(plan.file.map(ticket => ticket.check)).toEqual([CHECK_A]);
  });

  it("files nothing for a check that has stopped drifting", () => {
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "pass")],
      openTickets: [tracking("42", CHECK_A)],
    });
    expect(plan.file).toEqual([]);
    // And the existing ticket is not reported as tracking live drift, because
    // there is none — this consumer files, it never closes or edits.
    expect(plan.alreadyTracked).toEqual([]);
  });

  it("collapses a repeated check within one run", () => {
    // Self-duplication would arrive on the FIRST run, before any second run
    // could be blamed for it, and the marker cannot tell the two apart.
    const plan = planDriftTickets({
      findings: [finding(CHECK_A, "fail"), finding(CHECK_A, "warn")],
      openTickets: [],
    });
    expect(plan.file).toHaveLength(1);
    expect(plan.file[0]?.body).toContain("fail");
  });

  it("is not fooled by a check whose name is a prefix of another", () => {
    // Both directions, because only one of them is reachable by a loose match
    // and it is not the obvious one. A ticket tracking `coverage-floor` matched
    // against a bare `coverage` is the dangerous case: a containment test finds
    // the shorter name inside the longer one and suppresses drift that nothing
    // is tracking. The reverse is harmless, which is exactly why asserting only
    // the reverse would pass against the broken implementation.
    //
    // What makes the real marker exact is its closing delimiter: the ` -->` at
    // the end means `coverage -->` cannot be found inside `coverage-floor -->`.
    const shortName = "coverage";
    const suppressedWrongly = planDriftTickets({
      findings: [finding(shortName, "fail")],
      openTickets: [tracking("42", CHECK_A)],
    });
    expect(suppressedWrongly.file.map(ticket => ticket.check)).toEqual([
      shortName,
    ]);
    expect(suppressedWrongly.alreadyTracked).toEqual([]);

    const other = planDriftTickets({
      findings: [finding(CHECK_A, "fail")],
      openTickets: [tracking("42", shortName)],
    });
    expect(other.file.map(ticket => ticket.check)).toEqual([CHECK_A]);
  });

  it("accounts for every drifting finding exactly once", () => {
    // Totality: a caller reporting "nothing to do" must be asserting it looked
    // at all of them, not that its filter happened to come out empty.
    const findings = [
      finding(CHECK_A, "fail"),
      finding(CHECK_B, "warn"),
      finding("third", "pass"),
    ];
    const plan = planDriftTickets({
      findings,
      openTickets: [tracking("42", CHECK_B)],
    });
    expect(plan.file.length + plan.alreadyTracked.length).toBe(2);
  });
});
