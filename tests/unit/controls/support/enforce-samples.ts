/**
 * Small typed samples for the suites that derive enforce outcomes: an audit
 * report with a handful of findings, register entries as the enforce step has
 * already judged them, and the answers of the ticket flow
 * (CodySwannGT/lisa#4994).
 * @module tests/unit/controls/support/enforce-samples
 */
import type {
  AuditFinding,
  AuditFindingState,
  AuditReport,
} from "../../../../src/controls/audit-report.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
  type InScopeCriterion,
} from "../../../../src/controls/catalogue.js";
import type { TicketAnswer } from "../../../../src/controls/enforce-tickets.js";
import type {
  EnforcedEntry,
  EnforcedEntryOutcome,
} from "../../../../src/controls/enforce-types.js";
import { requirementQuestionId } from "../../../../src/controls/question-ids.js";

/** A requirement a check can refuse a change for, answered per part. */
export const STYLE = "SI7";

/** A requirement met by a written record, answered once. */
export const RECORD = "AC1.1";

/** A requirement met by a person's word, answered once. */
export const PERSON = "AC1.4";

/**
 * Read requirements from the shipped catalogue.
 * @param ids - The ids wanted
 * @returns Those requirements, in catalogue order
 */
export function criteriaOf(
  ids: readonly string[]
): readonly InScopeCriterion[] {
  return inScopeCriteria(loadCriterionCatalogue()).filter(criterion =>
    ids.includes(criterion.id)
  );
}

/**
 * One finding of an audit report.
 * @param criterion - Requirement id
 * @param scope - The folder it is about
 * @param state - Where the requirement stands there
 * @returns The finding
 */
export function finding(
  criterion: string,
  scope: string,
  state: AuditFindingState
): AuditFinding {
  return {
    criterion,
    scope,
    state,
    what: `What was found for ${state}.`,
    why: "Why it matters.",
    next: "To check this requirement an agent needs read access to the platform.",
    mechanisms: [],
  };
}

/**
 * A report holding the given findings, with the question each `question`
 * finding needs.
 * @param findings - The findings
 * @returns The report
 */
export function reportOf(findings: readonly AuditFinding[]): AuditReport {
  return {
    schema_version: 1,
    scopes: [...new Set(findings.map(each => each.scope))],
    findings,
    questions: findings
      .filter(each => each.state === "question")
      .map(each => ({
        id: requirementQuestionId(each.criterion, each.scope),
        text: "Who answers for what the agents do here?",
        candidates: [],
        no_candidates_reason: "Nothing written names anybody.",
      })),
    answers: [],
    probes: [],
  };
}

/**
 * A register entry as the enforce step judged it.
 * @param id - The entry's id, `<gate>@<scope>`
 * @param criteria - The requirements it serves
 * @param outcome - What its enforcement points added up to
 * @returns The entry
 */
export function judgedEntry(
  id: string,
  criteria: readonly string[],
  outcome: EnforcedEntryOutcome
): EnforcedEntry {
  const [gate = "", scope = "."] = id.split("@");
  return {
    id,
    gate,
    scope,
    criteria,
    outcome,
    reason: `The entry ${id} is ${outcome}.`,
    points: [],
  };
}

/** A ticket the flow filed in this run. */
export const FILED: TicketAnswer = {
  outcome: "ticketed",
  ticket: "tracker#12",
  state: "created",
  reason: "A ticket was opened for that work: tracker#12.",
};

/** A requirement the flow could not file a ticket for. */
export const UNFILED: TicketAnswer = {
  outcome: "blocked",
  ticket: null,
  state: null,
  reason: "No tracker is configured, so no ticket could be filed.",
};
