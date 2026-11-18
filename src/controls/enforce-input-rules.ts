/**
 * The shape each of the three handed results is held to, key by key.
 *
 * Only the keys the enforce report derives from are listed, so a command
 * that prints more is still read. The ticket results are written by an
 * agent, so they are also checked for a result that contradicts itself: a
 * ticket with no reference, or a blocked requirement with no reason.
 * @module controls/enforce-input-rules
 */
import { CARRIER_KINDS, CARRIER_POINT_OUTCOMES } from "./carrier-types.js";
import {
  isText,
  isTextOrNull,
  listProblems,
  listed,
  oneOf,
  shapeProblems,
  type FieldRule,
  type JsonObject,
} from "./enforce-input-shape.js";
import {
  HANDED_SCHEMA_VERSION,
  TICKET_STATES,
  type HandedTicket,
} from "./enforce-input-types.js";
import { ENFORCEMENT_LOCATIONS } from "./register-types.js";

const VERSION_RULE: FieldRule = {
  expected: String(HANDED_SCHEMA_VERSION),
  holds: value => value === HANDED_SCHEMA_VERSION,
  key: "schema_version",
};

const CARRIER_POINT_RULES: readonly FieldRule[] = [
  { expected: listed(CARRIER_KINDS), holds: oneOf(CARRIER_KINDS), key: "kind" },
  {
    expected: listed(ENFORCEMENT_LOCATIONS),
    holds: oneOf(ENFORCEMENT_LOCATIONS),
    key: "location",
  },
  { expected: "a moment's name", holds: isText, key: "moment" },
  {
    expected: listed(CARRIER_POINT_OUTCOMES),
    holds: oneOf(CARRIER_POINT_OUTCOMES),
    key: "outcome",
  },
  { expected: "a sentence or null", holds: isTextOrNull, key: "reason" },
  {
    expected: "a coding agent's name, when it is there",
    holds: value => value === undefined || isText(value),
    key: "agent",
  },
];

const CHANGE_RULES: readonly FieldRule[] = [
  { expected: "a path or a setting's name", holds: isText, key: "path" },
  {
    expected: listed(["create", "update", "set"]),
    holds: oneOf(["create", "update", "set"]),
    key: "action",
  },
];

const PROTECT_ENTRY_RULES: readonly FieldRule[] = [
  { expected: "a register entry's id", holds: isText, key: "id" },
  {
    expected: listed(["wired", "blocked"]),
    holds: oneOf(["wired", "blocked"]),
    key: "outcome",
  },
  { expected: "a sentence", holds: isText, key: "reason" },
];

const REQUEST_RULES: readonly FieldRule[] = [
  { expected: "a request method", holds: isText, key: "method" },
  { expected: "a request path", holds: isText, key: "path" },
  {
    expected: "true or false",
    holds: value => typeof value === "boolean",
    key: "sent",
  },
];

const HANDOVER_ACTIONS = ["written", "unchanged", "removed", "none"];

const TICKET_RULES: readonly FieldRule[] = [
  { expected: "a requirement's id", holds: isText, key: "criterion" },
  { expected: "a folder, or .", holds: isText, key: "scope" },
  { expected: "the key the gaps list gives", holds: isText, key: "key" },
  {
    expected: listed(["ticketed", "blocked"]),
    holds: oneOf(["ticketed", "blocked"]),
    key: "outcome",
  },
  {
    expected: "a ticket reference or null",
    holds: isTextOrNull,
    key: "ticket",
  },
  {
    expected: `${listed(TICKET_STATES)}, or null`,
    holds: oneOf([...TICKET_STATES, null]),
    key: "ticket_state",
  },
  { expected: "a sentence or null", holds: isTextOrNull, key: "reason" },
  { expected: "a question's id or null", holds: isTextOrNull, key: "question" },
];

/**
 * Find what is wrong with the carriers result.
 * @param document - The parsed file
 * @param where - What the file is, to start each line with
 * @returns One line per problem
 */
export function carriersProblems(
  document: JsonObject,
  where: string
): readonly string[] {
  return [
    ...shapeProblems(
      document,
      [
        VERSION_RULE,
        {
          expected: listed(["install", "check"]),
          holds: oneOf(["install", "check"]),
          key: "mode",
        },
      ],
      where
    ),
    ...listProblems(
      document.enforcement_points,
      CARRIER_POINT_RULES,
      `${where}: "enforcement_points"`
    ),
    ...listProblems(document.changes, CHANGE_RULES, `${where}: "changes"`),
  ];
}

/**
 * Find what is wrong with the merge-protection result.
 * @param document - The parsed file
 * @param where - What the file is, to start each line with
 * @returns One line per problem
 */
export function protectProblems(
  document: JsonObject,
  where: string
): readonly string[] {
  return [
    ...shapeProblems(
      document,
      [
        VERSION_RULE,
        {
          expected: listed(["read-only", "apply"]),
          holds: oneOf(["read-only", "apply"]),
          key: "mode",
        },
        {
          expected: "a branch name or null",
          holds: isTextOrNull,
          key: "branch",
        },
      ],
      where
    ),
    ...shapeProblems(
      document.platform,
      [{ expected: "the platform's name", holds: isText, key: "name" }],
      `${where}: "platform"`
    ),
    ...shapeProblems(
      document.handover,
      [
        { expected: "a path", holds: isText, key: "path" },
        {
          expected: listed(HANDOVER_ACTIONS),
          holds: oneOf(HANDOVER_ACTIONS),
          key: "action",
        },
      ],
      `${where}: "handover"`
    ),
    ...listProblems(
      document.entries,
      PROTECT_ENTRY_RULES,
      `${where}: "entries"`
    ),
    ...listProblems(document.requests, REQUEST_RULES, `${where}: "requests"`),
  ];
}

/**
 * Find a result that contradicts itself: a ticket with no reference, or a
 * blocked requirement with a ticket or with no reason.
 * @param results - The results, already shape-checked
 * @param where - What the file is, to start each line with
 * @returns One line per contradiction
 */
function ticketContradictions(
  results: readonly HandedTicket[],
  where: string
): readonly string[] {
  return results.flatMap((result, index) => {
    const item = `${where}: "results", item ${index + 1}`;
    if (result.outcome === "ticketed") {
      return isText(result.ticket) && result.ticket_state !== null
        ? []
        : [
            `${item} says a ticket exists, so "ticket" must be its reference and "ticket_state" must say whether it was created, already existed or was declined.`,
          ];
    }
    return result.ticket === null && isText(result.reason)
      ? []
      : [
          `${item} says no ticket could be filed, so "ticket" must be null and "reason" must say why in one sentence.`,
        ];
  });
}

/**
 * Find what is wrong with the ticket results.
 * @param document - The parsed file
 * @param where - What the file is, to start each line with
 * @returns One line per problem
 */
export function ticketsProblems(
  document: JsonObject,
  where: string
): readonly string[] {
  const shape = [
    ...shapeProblems(document, [VERSION_RULE], where),
    ...listProblems(document.results, TICKET_RULES, `${where}: "results"`),
  ];
  return shape.length > 0
    ? shape
    : ticketContradictions(document.results as readonly HandedTicket[], where);
}
