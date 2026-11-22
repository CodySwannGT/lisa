/**
 * The parts of the enforce report that are about the run as a whole: what
 * its steps changed, how many requirements have each outcome, and what the
 * result does not show.
 *
 * ## What a run changed
 *
 * Each step says what it wrote, and those statements are gathered here: the
 * files and the git setting the carriers step wrote, the tickets the ticket
 * flow created, and the handover file and any change request the
 * merge-protection step made. A run that found everything in place gathers
 * nothing, which is how a second run shows it made no write. The control
 * register is written by its own command, which says for itself whether it
 * wrote; the report requires that file to be current before it says
 * anything.
 *
 * ## What the summary says of the checks run on the default branch
 *
 * How many ran to an answer, how many of those do not pass, and how many
 * gave no answer. A check that could not be started, ran out of time or runs
 * through the project's task runner says nothing about the code, so a run in
 * which no check gave an answer is said to have measured nothing. It is
 * never written as a count of zero failing checks.
 *
 * ## What the result does not show
 *
 * A carrier being in place is not proof that a check stops a bad change, and
 * some places a check runs cannot be measured in this release. Each such
 * limit is one plain sentence, added only when it applies to this
 * repository. The ones about carriers are read from the carriers the
 * checkout holds now (`./enforce-carriers.ts`), not from the saved result.
 * @module controls/enforce-summary
 */
import type { InstalledCarrier } from "./enforce-carriers.js";
import type { EnforceInputs } from "./enforce-inputs.js";
import {
  ENFORCE_OUTCOMES,
  type CriterionEnforcement,
  type CurrentlyFailing,
  type EnforceCounts,
  type ReportedChange,
} from "./enforce-types.js";
import { platformLabel } from "./protect-platform.js";
import { isWrittenByLisa } from "./pull-request-executor.js";
import type { ControlRegister, PullRequestExecutor } from "./register-types.js";

/**
 * The hook owners for which git runs the hooks only because of a setting of
 * this one checkout: nothing owned them (`none`), or Lisa's own folder
 * already does (`lisa`), which is what the first becomes on a second run.
 */
const SETTING_OWNERS: readonly string[] = ["none", "lisa"];

/** The gate that refuses a change which loosens a declared threshold. */
const THRESHOLD_GATE = "threshold-monotonicity";

/** The request method that only reads. */
const READ_METHOD = "GET";

/**
 * Join some names the way a sentence lists them.
 * @param names - At least one name
 * @returns `a`, `a and b`, or `a, b and c`
 */
function sentenceList(names: readonly string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * Gather what the three steps said they changed.
 * @param inputs - The three results
 * @param created - The tickets the ticket flow created in this run
 * @returns One entry per change, in the order the steps ran
 */
export function reportedChanges(
  inputs: EnforceInputs,
  created: readonly string[]
): readonly ReportedChange[] {
  const { carriers, protect } = inputs;
  const handover: readonly ReportedChange[] =
    protect.handover.action === "written" ||
    protect.handover.action === "removed"
      ? [
          {
            action: protect.handover.action,
            step: "merge-protection",
            target: protect.handover.path,
          },
        ]
      : [];
  return [
    ...carriers.changes.map(
      (change): ReportedChange => ({
        action: change.action,
        step: "carriers",
        target: change.path,
      })
    ),
    ...created.map(
      (ticket): ReportedChange => ({
        action: "created",
        step: "tickets",
        target: ticket,
      })
    ),
    ...handover,
    ...protect.requests
      .filter(request => request.sent && request.method !== READ_METHOD)
      .map(
        (request): ReportedChange => ({
          action: "sent",
          step: "merge-protection",
          target: `${request.method} ${request.path}`,
        })
      ),
  ];
}

/**
 * Count the requirements that have each outcome.
 * @param rows - One row per requirement
 * @returns The counts, with a zero for an outcome nothing has
 */
export function countOutcomes(
  rows: readonly CriterionEnforcement[]
): EnforceCounts {
  return Object.fromEntries(
    ENFORCE_OUTCOMES.map(outcome => [
      outcome,
      rows.filter(row => row.outcome === outcome).length,
    ])
  ) as EnforceCounts;
}

/**
 * Say what running the required checks on the default branch came to.
 * @param failing - What running them found
 * @returns The sentence, with a space in front; empty when they were not run
 */
function measuredSentence(failing: CurrentlyFailing): string {
  if (!failing.measured) return "";
  const branch = failing.head?.branch ?? "the default branch";
  const failed = failing.gates.length;
  const unanswered = failing.not_measured.length;
  if (failing.checked === 0 && unanswered > 0) {
    return unanswered === 1
      ? ` The 1 required check gave no answer on ${branch} as it stands, so whether it passes there is not known.`
      : ` None of the ${unanswered} required checks gave an answer on ${branch} as it stands, so whether they pass there is not known.`;
  }
  const ran = ` ${failing.checked} required ${failing.checked === 1 ? "check" : "checks"} ran on ${branch} as it stands: ${failed} ${failed === 1 ? "does" : "do"} not pass.`;
  return unanswered === 0
    ? ran
    : `${ran} ${unanswered} more gave no answer, so nothing is known about ${unanswered === 1 ? "it" : "them"}.`;
}

/**
 * Say the whole result in one sentence.
 * @param counts - How many requirements have each outcome
 * @param changes - What the steps changed
 * @param failing - What running the checks on the default branch found
 * @returns The sentence
 */
export function summaryOf(
  counts: EnforceCounts,
  changes: readonly ReportedChange[],
  failing: CurrentlyFailing
): string {
  const total = ENFORCE_OUTCOMES.reduce(
    (sum, outcome) => sum + counts[outcome],
    0
  );
  return `${total} requirements: ${counts.wired} wired, ${counts.ticketed} ticketed, ${counts.blocked} waiting on somebody, ${counts["nothing-to-enforce"]} with nothing to enforce. The steps of this run reported ${changes.length} ${changes.length === 1 ? "change" : "changes"}.${measuredSentence(failing)}`;
}

/**
 * Name the agents of some carriers.
 * @param points - Agent carriers
 * @returns The agents, as a sentence lists them
 */
function agentsOf(points: readonly InstalledCarrier[]): string {
  return sentenceList(points.flatMap(point => point.agent ?? []));
}

/**
 * The limits that come from the carriers the checkout holds.
 * @param points - The carriers, as a read of the checkout found them
 * @returns One sentence per limit that applies
 */
function carrierLimits(points: readonly InstalledCarrier[]): readonly string[] {
  const wired = points.filter(point => point.state === "in-place");
  const assumed = wired.filter(point => point.refusal_evidence === "assumed");
  const told = wired.filter(point => point.refusal === "additional-context");
  const cannot = points.filter(point => point.state === "no-hook");
  return [
    ...(wired.some(point => SETTING_OWNERS.includes(point.wired_through))
      ? [
          'Git is set to run these hooks in this checkout only: the setting (core.hooksPath) is not copied into a new clone. In every other checkout, run "lisa controls install-carriers" once.',
        ]
      : []),
    ...(assumed.length > 0
      ? [
          `On ${agentsOf(assumed)}, that a failed check stops the agent after it writes a file is assumed from how the agent's hooks are described. It has not been measured.`,
        ]
      : []),
    ...(told.length > 0
      ? [
          `On ${agentsOf(told)}, a failed check does not fail the file write. The agent is told afterwards, and nothing stops it going on.`,
        ]
      : []),
    ...(cannot.length > 0
      ? [
          `${agentsOf(cannot)} ${cannot.length === 1 ? "has" : "have"} no hook that can refuse a file write, so no check can be enforced there after an edit. The control register records that.`,
        ]
      : []),
    ...(wired.some(point => point.agent === "codex")
      ? [
          "Codex runs a repository's hooks only after each person has approved them once, with /hooks inside Codex.",
        ]
      : []),
  ];
}

/**
 * The limits that come from the register itself.
 * @param register - The control register
 * @returns One sentence per limit that applies
 */
function registerLimits(register: ControlRegister): readonly string[] {
  const hosted = register.entries
    .flatMap(entry => entry.enforcement_points)
    .flatMap((point): readonly PullRequestExecutor[] =>
      point.executor !== undefined && !isWrittenByLisa(point.executor)
        ? [point.executor]
        : []
    );
  const [executor] = hosted;
  const thresholds = register.entries.flatMap(entry =>
    Object.values(entry.parameters).filter(
      parameter => parameter.direction !== undefined
    )
  ).length;
  const guarded = register.entries.some(entry => entry.gate === THRESHOLD_GATE);
  return [
    ...(executor === undefined
      ? []
      : [
          executor.platform === "github"
            ? `The changes proposed on GitHub run their checks through ${executor.path}. Attest must record both proof halves before those checks are proved.`
            : `The checks on a proposed change run from ${executor.path} on ${platformLabel(executor.platform)}, a file Lisa did not write. Nothing in this release can prove a check there, so those entries stay marked unproved.`,
        ]),
    ...(thresholds > 0 && !guarded
      ? [
          `${thresholds} ${thresholds === 1 ? "threshold is" : "thresholds are"} declared, and no check is declared that refuses a change which loosens one. The enforce step adds no check of its own: that one is declared in the configure step like any other.`,
        ]
      : []),
  ];
}

/**
 * Say what the result does not show.
 * @param register - The control register
 * @param installed - The carriers the checkout holds now
 * @returns One plain sentence per limit, the general one first
 */
export function reportLimits(
  register: ControlRegister,
  installed: readonly InstalledCarrier[]
): readonly string[] {
  return [
    "Wired means that what runs a check is in place. Whether the check really stops a bad change is what the attest step proves.",
    ...carrierLimits(installed),
    ...registerLimits(register),
  ];
}
