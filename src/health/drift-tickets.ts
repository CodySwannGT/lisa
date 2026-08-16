/**
 * Decide which health drift becomes a ticket, and which is already tracked.
 *
 * The scheduled health consumer's whole difficulty is idempotency: a nightly
 * cron that refiles the same drift every night is worse than no cron at all,
 * because it trains people to ignore the tickets it files. Everything here
 * exists to make "the same drift" a decidable question.
 *
 * ## Dedupe is per CHECK, not per drift set
 *
 * The marker fingerprints the check id. Fingerprinting the whole finding set
 * would mean one added finding produces a brand-new ticket while the old one
 * still stands, so a slowly-degrading project accumulates near-duplicates —
 * the same "worse than no cron" outcome by a slightly different route. Per
 * check also makes partial repair behave: fix one drifting check, its ticket
 * closes, the others stay open on their own merits.
 *
 * ## A closed ticket does not suppress live drift
 *
 * Enforced by construction rather than by a conditional: this planner is given
 * only the OPEN tickets, so a closed one cannot suppress anything. It is not
 * that closed tickets are checked and then ignored — they are not in evidence.
 *
 * The alternative, treating closure as permanent suppression, means closing a
 * ticket without fixing anything makes that drift invisible forever, which is
 * the silent decay this consumer exists to prevent. Suppression should be a
 * configured declaration visible in a diff, not a side effect of somebody
 * tidying a backlog. Turning the check off in config is the sanctioned way.
 * @module health/drift-tickets
 */

import type { HealthFinding } from "./contract.js";

/** Statuses that count as drift worth tracking. `pass` is not drift. */
const DRIFT_STATUSES = new Set(["warn", "fail"]);

/** Marker prefix written into a filed ticket so the next run can find it. */
export const DRIFT_MARKER_PREFIX = "lisa-health-drift";

/**
 * The dedupe marker for one check.
 *
 * An HTML comment so it is invisible in rendered ticket bodies but present in
 * the raw text every tracker returns. Trackers differ in what they preserve of
 * a body; they do not differ in preserving its characters.
 * @param check - The health check id
 * @returns The marker to embed in a filed ticket
 */
export function driftMarker(check: string): string {
  return `<!-- ${DRIFT_MARKER_PREFIX}: ${check} -->`;
}

/** A ticket already open in the tracker, reduced to what dedupe needs. */
export interface OpenTicket {
  readonly id: string;
  readonly body: string;
}

/** One ticket the consumer should file. */
export interface DriftTicket {
  readonly check: string;
  readonly title: string;
  readonly body: string;
  readonly marker: string;
}

/** Drift already covered by an open ticket, reported rather than dropped. */
export interface TrackedDrift {
  readonly check: string;
  readonly ticketId: string;
}

/** What a scheduled run should do about the drift it found. */
export interface DriftTicketPlan {
  readonly file: readonly DriftTicket[];
  readonly alreadyTracked: readonly TrackedDrift[];
}

/**
 * Inputs to a planning pass.
 *
 * `openTickets` is deliberately named for its own precondition. A caller that
 * passes closed tickets defeats the ruling above, and a parameter called
 * `tickets` would not have told them so.
 */
export interface DriftTicketInput {
  readonly findings: readonly HealthFinding[];
  readonly openTickets: readonly OpenTicket[];
}

/**
 * Compose the ticket body for one drifting check.
 * @param finding - The drifting finding
 * @returns Operator-readable body carrying the dedupe marker
 */
function bodyFor(finding: HealthFinding): string {
  return [
    `The scheduled health check found drift in \`${finding.check}\`.`,
    "",
    `**Status:** ${finding.status}`,
    `**Layer:** ${finding.layer}`,
    `**Reason:** ${finding.reason}`,
    "",
    "Filed automatically by the scheduled health consumer. It files; it never",
    "closes or edits. Repairing the drift is separate work.",
    "",
    "If this drift is accepted rather than fixed, turn the check off in config",
    "rather than closing this ticket — a closed ticket does not suppress live",
    "drift, so it would simply be filed again on the next run.",
    "",
    driftMarker(finding.check),
  ].join("\n");
}

/**
 * Decide what to file for the drift a run found.
 *
 * Total and pure: every unique drifting check lands in exactly one of `file` or
 * `alreadyTracked` after duplicate findings for that check collapse, so a caller
 * reporting "nothing to do" is asserting it looked at all checks rather than
 * that its filter happened to be empty.
 * @param input - Findings from the run and the tracker's OPEN tickets
 * @returns Tickets to file, and drift already covered
 */
export function planDriftTickets(input: DriftTicketInput): DriftTicketPlan {
  const drifting = input.findings.filter(finding =>
    DRIFT_STATUSES.has(finding.status)
  );
  // One entry per check even when a run reports the same check twice: the
  // marker cannot distinguish them, so filing two would self-duplicate on the
  // very first run — the defect this module exists to prevent, arriving before
  // any second run happens. First occurrence wins, so the reported reason is
  // the one a reader would see first in the run output.
  const unique = drifting.filter(
    (finding, index) =>
      drifting.findIndex(other => other.check === finding.check) === index
  );

  const decided = unique.map(finding => {
    const marker = driftMarker(finding.check);
    return {
      finding,
      marker,
      existing: input.openTickets.find(ticket => ticket.body.includes(marker)),
    };
  });

  return {
    file: decided.flatMap(entry =>
      entry.existing
        ? []
        : [
            {
              check: entry.finding.check,
              title: `health drift: ${entry.finding.check}`,
              body: bodyFor(entry.finding),
              marker: entry.marker,
            },
          ]
    ),
    alreadyTracked: decided.flatMap(entry =>
      entry.existing
        ? [{ check: entry.finding.check, ticketId: entry.existing.id }]
        : []
    ),
  };
}
