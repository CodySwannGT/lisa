/**
 * What the ticket flow hands back is held to the list of missing
 * requirements before any of it is believed (CodySwannGT/lisa#4994).
 */
import { describe, expect, it } from "vitest";

import type { ControlGap } from "../../../src/controls/commands/gaps.js";
import {
  controlGapKey,
  controlGapMarker,
} from "../../../src/controls/control-gap-marker.js";
import type { HandedTicket } from "../../../src/controls/enforce-inputs.js";
import {
  settleTickets,
  type TicketTracker,
} from "../../../src/controls/enforce-tickets.js";

const TRACKER: TicketTracker = {
  configured: true,
  problem: null,
  question: null,
};

const NO_TRACKER: TicketTracker = {
  configured: false,
  problem: "No tracker is configured, so no ticket can be filed.",
  question: "tracker",
};

/**
 * A requirement `lisa controls gaps` lists as missing.
 * @param criterion - Requirement id
 * @param scope - The folder
 * @returns The listed gap
 */
function gap(criterion: string, scope: string): ControlGap {
  return {
    criterion,
    scope,
    part: scope === "." ? "whole repository" : `folder ${scope}`,
    question: "Is it checked?",
    what: "Nothing does this.",
    why: "It matters.",
    next: "Add it.",
    key: controlGapKey(criterion, scope),
    marker: controlGapMarker(criterion, scope),
    outcome: null,
  };
}

/**
 * A result the ticket flow hands back for a listed gap.
 * @param listed - The gap it answers
 * @param change - Fields to replace
 * @returns The result
 */
function filed(
  listed: ControlGap,
  change: Partial<HandedTicket> = {}
): HandedTicket {
  return {
    criterion: listed.criterion,
    scope: listed.scope,
    key: listed.key,
    outcome: "ticketed",
    ticket: "tracker#7",
    ticket_state: "created",
    reason: null,
    question: null,
    ...change,
  };
}

/** A key the gaps list did not give, put together at run time. */
const WRONG_KEY = "0".repeat(12);

const API = gap("SI8", "api");
const WEB = gap("SI8", "web");

describe("settling what the ticket flow handed back", () => {
  it("answers ticketed with the ticket for a requirement that was filed", () => {
    const settled = settleTickets({
      gaps: [API],
      tracker: TRACKER,
      handed: [filed(API)],
    });

    expect(settled.problems).toBeNull();
    if (settled.problems !== null) return;
    expect(settled.ticketFor("SI8", "api")).toMatchObject({
      outcome: "ticketed",
      ticket: "tracker#7",
      state: "created",
    });
    expect(settled.created).toEqual(["tracker#7"]);
  });

  it("does not count a ticket that already existed as created in this run", () => {
    const settled = settleTickets({
      gaps: [API],
      tracker: TRACKER,
      handed: [filed(API, { ticket_state: "existing" })],
    });

    expect(settled.problems === null && settled.created).toEqual([]);
  });

  it("answers nothing for a requirement the list does not hold", () => {
    const settled = settleTickets({
      gaps: [API],
      tracker: TRACKER,
      handed: [filed(API)],
    });

    expect(settled.problems === null && settled.ticketFor("SI7", ".")).toBe(
      null
    );
  });

  it("blocks every listed requirement when no tracker is configured, and points at the open question", () => {
    const settled = settleTickets({
      gaps: [API, WEB],
      tracker: NO_TRACKER,
      handed: [],
    });

    expect(settled.problems).toBeNull();
    if (settled.problems !== null) return;
    expect(settled.created).toEqual([]);
    expect(settled.ticketFor("SI8", "web")).toMatchObject({
      outcome: "blocked",
      ticket: null,
    });
    expect(settled.ticketFor("SI8", "web")?.reason).toContain(
      "No tracker is configured"
    );
    expect(settled.ticketFor("SI8", "web")?.reason).toContain(
      ".lisa/audit/report.md"
    );
  });

  it("passes on why the flow could not file a ticket", () => {
    const settled = settleTickets({
      gaps: [API],
      tracker: TRACKER,
      handed: [
        filed(API, {
          outcome: "blocked",
          ticket: null,
          ticket_state: null,
          reason: "The tracker could not be searched.",
        }),
      ],
    });

    expect(
      settled.problems === null && settled.ticketFor("SI8", "api")?.reason
    ).toContain("The tracker could not be searched.");
  });
});

describe("results that cannot be relied on", () => {
  it.each([
    [
      "a listed requirement nothing was handed back for",
      { gaps: [API, WEB], tracker: TRACKER, handed: [filed(API)] },
      "say nothing about SI8 in web",
    ],
    [
      "a result for a requirement that is not listed",
      { gaps: [API], tracker: TRACKER, handed: [filed(API), filed(WEB)] },
      "does not list",
    ],
    [
      "a result under a key the list did not give",
      {
        gaps: [API],
        tracker: TRACKER,
        handed: [filed(API, { key: WRONG_KEY })],
      },
      `under the key "${WRONG_KEY}"`,
    ],
    [
      "two results for one requirement",
      { gaps: [API], tracker: TRACKER, handed: [filed(API), filed(API)] },
      "more than once",
    ],
    [
      "a ticket claimed where no tracker is configured",
      { gaps: [API], tracker: NO_TRACKER, handed: [filed(API)] },
      "no tracker is configured",
    ],
  ])("are refused: %s", (_name, settlement, said) => {
    const settled = settleTickets(settlement);

    expect(settled.problems?.join("\n")).toContain(said);
  });
});
