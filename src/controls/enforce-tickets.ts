/**
 * What the ticket flow answered for each requirement the repository has
 * nothing for.
 *
 * `lisa controls gaps` decides which requirements are missing and the key
 * each one's ticket is found by. An agent then searches the tracker and
 * files, so what it hands back is checked here against that same list before
 * anything is believed:
 *
 * - every result must be about a requirement the list holds, under the key
 *   the list gives it, and no requirement may be answered twice;
 * - where a tracker is configured, every listed requirement must be
 *   answered, so none can be left out;
 * - where none is configured, nothing can have been filed through Lisa's
 *   write path, so a result that claims a ticket is refused and every listed
 *   requirement is `blocked`, with the tracker's own problem as the reason.
 * @module controls/enforce-tickets
 */
import { AUDIT_REPORT_MARKDOWN_PATH } from "./audit-report.js";
import type { ControlGap } from "./commands/gaps.js";
import type { HandedTicket } from "./enforce-inputs.js";

/** How the ticket flow left one missing requirement. */
export interface TicketAnswer {
  readonly outcome: "ticketed" | "blocked";
  /** The ticket's reference when `ticketed`; `null` when `blocked`. */
  readonly ticket: string | null;
  /** `created`, `existing` or `declined` when `ticketed`; else `null`. */
  readonly state: HandedTicket["ticket_state"];
  /** The outcome in plain words. */
  readonly reason: string;
}

/** Looks up the answer for one requirement in one folder. */
export type TicketLookup = (
  criterion: string,
  scope: string
) => TicketAnswer | null;

/** The tracker as `lisa controls gaps` describes it. */
export interface TicketTracker {
  readonly configured: boolean;
  /** What is wrong and what to do, when no tracker is configured. */
  readonly problem: string | null;
  /** The id of the audit's open question about the tracker, or `null`. */
  readonly question: string | null;
}

/** What settling the tickets takes. */
export interface TicketSettlement {
  /** The requirements `lisa controls gaps` lists, in its order. */
  readonly gaps: readonly ControlGap[];
  readonly tracker: TicketTracker;
  /** The results the ticket flow handed over. */
  readonly handed: readonly HandedTicket[];
}

/** The answers, or one line per reason the results cannot be relied on. */
export type SettledTickets =
  | {
      readonly problems: null;
      readonly ticketFor: TicketLookup;
      /** The tickets this run created, in the order they were handed over. */
      readonly created: readonly string[];
    }
  | { readonly problems: readonly string[] };

/** What a ticket's state means to the operator. */
const TICKETED_WORDS: Readonly<
  Record<NonNullable<HandedTicket["ticket_state"]>, string>
> = {
  created: "A ticket was opened for that work",
  declined: "A person closed the ticket for that work as not planned",
  existing: "A ticket for that work already exists",
};

/**
 * Join a requirement and a folder into one lookup key.
 * @param criterion - The requirement's id
 * @param scope - The folder
 * @returns The key
 */
function addressOf(criterion: string, scope: string): string {
  return `${criterion}\0${scope}`;
}

/**
 * Say why a requirement with no tracker to file in is blocked.
 * @param tracker - The tracker as the gaps list describes it
 * @returns The reason, pointing at the open tracker question when one exists
 */
function noTrackerReason(tracker: TicketTracker): string {
  const problem =
    tracker.problem ?? "No tracker is configured, so no ticket was filed.";
  return tracker.question === null
    ? problem
    : `${problem} The audit asked which tracker the team uses, and that question ("${tracker.question}") is still open in ${AUDIT_REPORT_MARKDOWN_PATH}.`;
}

/**
 * Turn one handed result into an answer.
 * @param result - The result the ticket flow handed over
 * @param gap - The listed requirement it is about
 * @returns The answer
 */
function answerOf(result: HandedTicket, gap: ControlGap): TicketAnswer {
  if (result.outcome === "ticketed" && result.ticket_state !== null) {
    return {
      outcome: "ticketed",
      reason: `Nothing in the ${gap.part} does this yet. ${TICKETED_WORDS[result.ticket_state]}: ${result.ticket ?? ""}.`,
      state: result.ticket_state,
      ticket: result.ticket,
    };
  }
  return {
    outcome: "blocked",
    reason: `Nothing in the ${gap.part} does this yet, and no ticket could be filed for that work. ${result.reason ?? ""}`,
    state: null,
    ticket: null,
  };
}

/**
 * Find what is wrong with the handed results, measured against the list.
 * @param settlement - The list, the tracker and the results
 * @returns One line per problem; empty when the results can be relied on
 */
function settlementProblems(settlement: TicketSettlement): readonly string[] {
  const { gaps, handed, tracker } = settlement;
  const listed = new Map(
    gaps.map(gap => [addressOf(gap.criterion, gap.scope), gap])
  );
  const addresses = handed.map(result =>
    addressOf(result.criterion, result.scope)
  );
  const named = (result: HandedTicket): string =>
    `${result.criterion} in ${result.scope}`;
  const unlisted = handed
    .filter(
      result =>
        listed.get(addressOf(result.criterion, result.scope))?.key !==
        result.key
    )
    .map(
      result =>
        `The ticket results answer for ${named(result)} under the key "${result.key}", which "lisa controls gaps" does not list. Copy the requirement, the folder and the key from that command's output.`
    );
  const repeated = handed
    .filter((_, index) => addresses.indexOf(addresses[index] ?? "") !== index)
    .map(
      result =>
        `The ticket results answer for ${named(result)} more than once. Give each missing requirement one result.`
    );
  const impossible = tracker.configured
    ? []
    : handed
        .filter(result => result.outcome === "ticketed")
        .map(
          result =>
            `The ticket results say a ticket was filed for ${named(result)}, but no tracker is configured, so none can have been filed through Lisa's ticket writer.`
        );
  const unanswered = tracker.configured
    ? gaps
        .filter(gap => !addresses.includes(addressOf(gap.criterion, gap.scope)))
        .map(
          gap =>
            `The ticket results say nothing about ${gap.criterion} in ${gap.scope}, which "lisa controls gaps" lists as missing. Run the missing-capability ticket flow for it and add its result.`
        )
    : [];
  return [...unlisted, ...repeated, ...impossible, ...unanswered];
}

/**
 * Check what the ticket flow handed over and make it answerable per
 * requirement.
 * @param settlement - The list, the tracker and the results
 * @returns The answers, or one line per problem
 */
export function settleTickets(settlement: TicketSettlement): SettledTickets {
  const problems = settlementProblems(settlement);
  if (problems.length > 0) return { problems };
  const { gaps, handed, tracker } = settlement;
  const answers = new Map(
    gaps.map(gap => {
      const result = handed.find(
        each => each.criterion === gap.criterion && each.scope === gap.scope
      );
      const answer: TicketAnswer =
        result === undefined || !tracker.configured
          ? {
              outcome: "blocked",
              reason: `Nothing in the ${gap.part} does this yet, and no ticket could be filed for that work. ${noTrackerReason(tracker)}`,
              state: null,
              ticket: null,
            }
          : answerOf(result, gap);
      return [addressOf(gap.criterion, gap.scope), answer] as const;
    })
  );
  return {
    created: handed.flatMap(result =>
      result.ticket_state === "created" && result.ticket !== null
        ? [result.ticket]
        : []
    ),
    problems: null,
    ticketFor: (criterion, scope) =>
      answers.get(addressOf(criterion, scope)) ?? null,
  };
}
