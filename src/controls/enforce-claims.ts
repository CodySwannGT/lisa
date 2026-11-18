/**
 * Deriving the one enforce outcome of every requirement.
 *
 * A requirement is spoken for by two kinds of source, and each source makes
 * a claim: the audit's finding for it in each part of the repository, and
 * each register entry that serves it.
 *
 * ## What a finding claims
 *
 * | The audit found | And | The claim |
 * | --- | --- | --- |
 * | `missing` | the ticket flow found or filed a ticket | `ticketed`, with the ticket |
 * | `missing` | no ticket could be filed, or no tracker is configured | `blocked`, with why |
 * | `question` | — | `blocked`: waiting on the operator's answer to that question |
 * | `unknown` | — | `blocked`: waiting on the access the audit named |
 * | `not-applicable` | — | `nothing-to-enforce` |
 * | `exists-not-enforced` or `proved` | the requirement is met by a record or a person's word | `nothing-to-enforce`: no hook can run a document |
 * | `exists-not-enforced` or `proved` | it is a check, and an entry that serves it covers that part | none: the entry speaks for it |
 * | `exists-not-enforced` or `proved` | it is a check, and no entry covers that part | `blocked`: waiting on the operator to declare it in the configure step |
 *
 * An entry covers a finding's part when the finding is about the whole
 * repository, when the entry is, or when the entry's folder is that part or
 * inside it.
 *
 * ## What an entry claims
 *
 * Its own outcome, as `./enforce-entry-outcome.ts` adds its enforcement
 * points up: `wired`, `blocked` or `nothing-to-enforce`. An entry that
 * serves a requirement a check can refuse a change for is never
 * `nothing-to-enforce` for having no moment to run at: it is `blocked`, so
 * the finding it covers is not counted as answered by a check nothing runs.
 *
 * ## One outcome from many claims
 *
 * The strongest claim wins, in the order of `ENFORCE_OUTCOMES`: `blocked`,
 * then `ticketed`, then `wired`, then `nothing-to-enforce`. So a requirement
 * is `wired` only when nothing about it is still waiting on a person or on a
 * ticket, and `nothing-to-enforce` only when no source asks anything of this
 * step at all.
 *
 * The enforce step adds no check of its own. A check nobody declared is
 * reported as not wired and sent back to the configure step, where it is
 * declared with what supports it like any other.
 * @module controls/enforce-claims
 */
import {
  AUDIT_REPORT_MARKDOWN_PATH,
  REPOSITORY_SCOPE,
  describeScope,
  type AuditFinding,
  type AuditFindingState,
  type AuditReport,
} from "./audit-report.js";
import { compareCodeUnits } from "./canonical-json.js";
import type { InScopeCriterion } from "./catalogue.js";
import type { TicketLookup } from "./enforce-tickets.js";
import {
  ENFORCE_OUTCOMES,
  NOTHING_TO_ENFORCE,
  type CriterionEnforcement,
  type EnforceClaim,
  type EnforcedEntry,
  type EnforceOutcome,
} from "./enforce-types.js";
import { requirementQuestionId } from "./question-ids.js";

/** The catalogue's word for a requirement a check can refuse a change for. */
export const GATE_KIND = "gate";

/** What the outcomes are derived from. */
export interface ClaimSources {
  /** The in-scope requirements, in catalogue order. */
  readonly criteria: readonly InScopeCriterion[];
  /** The validated audit report. */
  readonly report: AuditReport;
  /** Every register entry, already judged. */
  readonly entries: readonly EnforcedEntry[];
  /** What the ticket flow answered for a missing requirement. */
  readonly ticketFor: TicketLookup;
}

/** One finding, with everything a rule needs to turn it into a claim. */
interface FindingContext {
  readonly finding: AuditFinding;
  readonly criterion: InScopeCriterion;
  readonly report: AuditReport;
  /** The judged entries that serve the requirement. */
  readonly serving: readonly EnforcedEntry[];
  readonly ticketFor: TicketLookup;
}

/** A claim before it is tied to its finding. */
type Claimed = Pick<EnforceClaim, "outcome" | "reason" | "ticket">;

/**
 * Tell whether an entry's folder covers the part a finding is about.
 * @param entryScope - The entry's folder
 * @param findingScope - The finding's folder
 * @returns Whether the entry speaks for that part
 */
function covers(entryScope: string, findingScope: string): boolean {
  return (
    findingScope === REPOSITORY_SCOPE ||
    entryScope === REPOSITORY_SCOPE ||
    entryScope === findingScope ||
    entryScope.startsWith(`${findingScope}/`)
  );
}

/**
 * The claim of a requirement the repository has nothing for.
 * @param context - The finding and its surroundings
 * @returns What the ticket flow answered; `blocked` when it answered nothing
 */
function missingClaim(context: FindingContext): Claimed {
  const { finding } = context;
  const answer = context.ticketFor(finding.criterion, finding.scope);
  return answer === null
    ? {
        outcome: "blocked",
        reason: `Nothing in the ${describeScope(finding.scope)} does this yet, and the ticket flow reported nothing for it. Run the enforce step again.`,
        ticket: null,
      }
    : { outcome: answer.outcome, reason: answer.reason, ticket: answer.ticket };
}

/**
 * The claim of a requirement only a person can settle.
 * @param context - The finding and its surroundings
 * @returns `blocked`, with the question the operator is asked
 */
function questionClaim(context: FindingContext): Claimed {
  const { finding, report } = context;
  const id = requirementQuestionId(finding.criterion, finding.scope);
  const asked = report.questions.find(question => question.id === id);
  return {
    outcome: "blocked",
    reason: `Waiting on your answer about the ${describeScope(finding.scope)}: ${asked?.text ?? finding.next} Type the answer on that question's answer line in ${AUDIT_REPORT_MARKDOWN_PATH}, then run the audit again.`,
    ticket: null,
  };
}

/**
 * The claim of a requirement the audit found something in place for.
 * @param context - The finding and its surroundings
 * @returns The claim, or `null` when a register entry speaks for that part
 */
function inPlaceClaim(context: FindingContext): Claimed | null {
  const { criterion, finding, serving } = context;
  const part = describeScope(finding.scope);
  if (criterion.kind !== GATE_KIND) {
    return {
      outcome: NOTHING_TO_ENFORCE,
      reason: `For the ${part} this is met by a written record or a person's word, which the audit found in place. No hook can run a document, so there is nothing to wire; the attest step says whether what is there is enough.`,
      ticket: null,
    };
  }
  return serving.some(entry => covers(entry.scope, finding.scope))
    ? null
    : {
        outcome: "blocked",
        reason: `Something that checks this exists in the ${part}, but no check is declared for it there, so nothing was wired. Waiting on you: run the configure step and decide when it should run.`,
        ticket: null,
      };
}

/** What a finding in each state claims. */
const FINDING_CLAIMS: Readonly<
  Record<AuditFindingState, (context: FindingContext) => Claimed | null>
> = {
  "exists-not-enforced": inPlaceClaim,
  missing: missingClaim,
  "not-applicable": ({ finding }) => ({
    outcome: NOTHING_TO_ENFORCE,
    reason: `This does not apply to the ${describeScope(finding.scope)}: ${finding.what}`,
    ticket: null,
  }),
  proved: inPlaceClaim,
  question: questionClaim,
  unknown: ({ finding }) => ({
    outcome: "blocked",
    reason: `Waiting on access for the ${describeScope(finding.scope)}: ${finding.next}`,
    ticket: null,
  }),
};

/**
 * Order two claims: strongest outcome first, then findings before entries,
 * then by id.
 * @param left - A claim
 * @param right - Another
 * @returns Negative, zero or positive, as a sort expects
 */
function byStrength(left: EnforceClaim, right: EnforceClaim): number {
  const strength =
    ENFORCE_OUTCOMES.indexOf(left.outcome) -
    ENFORCE_OUTCOMES.indexOf(right.outcome);
  if (strength !== 0) return strength;
  return left.source === right.source
    ? compareCodeUnits(left.id, right.id)
    : compareCodeUnits(left.source, right.source);
}

/**
 * Collect every claim about one requirement.
 * @param criterion - The requirement
 * @param sources - The report, the judged entries and the ticket answers
 * @returns The claims, strongest first
 */
function claimsAbout(
  criterion: InScopeCriterion,
  sources: ClaimSources
): readonly EnforceClaim[] {
  const serving = sources.entries.filter(entry =>
    entry.criteria.includes(criterion.id)
  );
  const fromFindings = sources.report.findings
    .filter(finding => finding.criterion === criterion.id)
    .flatMap((finding): readonly EnforceClaim[] => {
      const claimed = FINDING_CLAIMS[finding.state]({
        criterion,
        finding,
        report: sources.report,
        serving,
        ticketFor: sources.ticketFor,
      });
      return claimed === null
        ? []
        : [
            {
              ...claimed,
              id: requirementQuestionId(finding.criterion, finding.scope),
              scope: finding.scope,
              source: "audit-finding",
            },
          ];
    });
  const fromEntries = serving.map(
    (entry): EnforceClaim => ({
      id: entry.id,
      outcome: entry.outcome,
      reason: entry.reason,
      scope: entry.scope,
      source: "register-entry",
      ticket: null,
    })
  );
  return [...fromFindings, ...fromEntries].sort(byStrength);
}

/**
 * Derive the outcome of every requirement that something speaks for.
 *
 * A requirement with neither a finding nor an entry gets no row here, so
 * that {@link outcomeProblems} reports it instead of an outcome being made
 * up for it.
 * @param sources - The requirements, the report, the judged entries and the
 *   ticket answers
 * @returns One row per requirement with at least one claim, in catalogue
 *   order
 */
export function deriveCriteria(
  sources: ClaimSources
): readonly CriterionEnforcement[] {
  return sources.criteria.flatMap(criterion => {
    const claims = claimsAbout(criterion, sources);
    const [strongest] = claims;
    if (strongest === undefined) return [];
    const deciding = claims.filter(
      claim => claim.outcome === strongest.outcome
    );
    return [
      {
        claims,
        criterion: criterion.id,
        kind: typeof criterion.kind === "string" ? criterion.kind : "",
        outcome: strongest.outcome,
        question: criterion.question,
        reason: deciding.map(claim => claim.reason).join(" "),
        tickets: [
          ...new Set(
            claims.flatMap(claim => (claim.ticket === null ? [] : claim.ticket))
          ),
        ],
      },
    ];
  });
}

/**
 * Check that every requirement has exactly one outcome.
 * @param rows - The derived rows
 * @param criteria - The in-scope requirements
 * @returns One line per requirement with no outcome or with more than one,
 *   and per row that is about no requirement; empty when the count of
 *   outcomes equals the count of requirements and none has two
 */
export function outcomeProblems(
  rows: readonly CriterionEnforcement[],
  criteria: readonly InScopeCriterion[]
): readonly string[] {
  const outcomes: readonly EnforceOutcome[] = ENFORCE_OUTCOMES;
  const known = new Set(criteria.map(criterion => criterion.id));
  const counted = criteria.flatMap(criterion => {
    const found = rows.filter(row => row.criterion === criterion.id).length;
    if (found === 1) return [];
    return [
      found === 0
        ? `The requirement ${criterion.id} has no outcome: the audit report holds no finding for it and no register entry serves it. Run the audit again.`
        : `The requirement ${criterion.id} has ${found} outcomes, and it may have only one.`,
    ];
  });
  const strangers = rows
    .filter(row => !known.has(row.criterion) || !outcomes.includes(row.outcome))
    .map(
      row =>
        `An outcome was derived for ${row.criterion} (${row.outcome}), which is not an outcome of a Level 1 requirement.`
    );
  return [...counted, ...strangers];
}
