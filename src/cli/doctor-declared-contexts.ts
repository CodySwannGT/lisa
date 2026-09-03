/**
 * Report where the settings file and the ruleset that enforces it disagree.
 *
 * The machine payload under `--json` carries the whole comparison, three states
 * and all. This is the line an operator reads without asking for JSON, and it
 * is deliberately the OFFLINE half: doctor is documented as making no network
 * call, and the template is what a repository's protection is provisioned
 * from, so a disagreement with it is drift the moment anyone provisions —
 * whether or not the live ruleset has caught up. The live half runs in
 * `lisa health`, which already reaches GitHub.
 *
 * A `warn` here is not a softer `fail`. Two of the verdicts are contradictions
 * — the two surfaces state opposite things and one of them is wrong — and
 * those fail. The other two are silences, and a silence must not send an
 * operator to delete a required check; those warn and say what to declare.
 * @module cli/doctor-declared-contexts
 */
import {
  isContradiction,
  isGap,
  type DeclarationDriftEntry as DriftEntry,
  type DeclarationDriftReport,
} from "../core/gate-declaration-drift.js";
import { readConfig } from "./gate-report-config.js";
import { readFacadeFacts } from "./gate-report-facade.js";
import { buildDeclarationDrift } from "./gate-report-joins.js";
import { loadGateRegistry } from "./gate-report-registry.js";
import { readTemplateEnforcement } from "./gate-report-templates.js";
import type { DoctorCheck } from "./doctor.js";
import type { Finding } from "./gate-report-types.js";

/** The workflow whose name prefixes a run gate's status context. */
const QUALITY_WORKFLOW_NAME = "🔍 Quality Checks";

/** The moment a branch ruleset guards. */
const MERGE_MOMENT = "pull-request";

/** This check's operator-facing name. */
const NAME = "Required checks match what the settings file declares?";

/**
 * Name at most a few contexts, so one line stays one line.
 * @param contexts - Context strings
 * @returns A bounded, sorted list
 */
function named(contexts: readonly string[]): string {
  const shown = contexts.slice(0, 4);
  const rest = contexts.length - shown.length;
  return `${shown.join(", ")}${rest > 0 ? ` (+${String(rest)} more)` : ""}`;
}

/**
 * Turn a completed comparison into one operator-readable line.
 * @param report - The comparison
 * @returns The check
 */
export function declaredContextsCheck(
  report: DeclarationDriftReport
): DoctorCheck {
  // Ahead of the contradictions, because it is worse than either of them: a
  // required context nothing can post does not go red, it holds every pull
  // request at "Expected — Waiting for status to be reported" indefinitely,
  // and the operator has no failing job to open. Doctor is offline by
  // contract, so what it can catch here is a retired name in the TEMPLATE this
  // repository is provisioned from; the live sweep — including rulesets Lisa
  // does not manage, which is where #3067 actually hid — belongs to
  // `lisa health`, which already reaches GitHub.
  const retired = report.entries.filter(
    entry => entry.verdict === "enforced-context-retired"
  );
  if (retired.length > 0) {
    return {
      name: NAME,
      status: "fail",
      detail: `${named(retired.map(entry => entry.context))} can never report: Lisa renamed the job that used to post ${retired.length === 1 ? "it" : "them"}. ${retired[0]?.detail ?? ""} Run \`lisa health\` to sweep the LIVE rulesets, including any this repository hand-made, for the same name.`,
    };
  }
  // Asked of the comparator rather than re-listed here — see the note on the
  // same call in `health/declared-checks-inspection`.
  const contradictions = report.entries.filter(entry =>
    isContradiction(entry.verdict)
  );
  if (contradictions.length > 0) {
    return {
      name: NAME,
      status: "fail",
      detail: `The settings file and the ruleset template say opposite things about ${named(contradictions.map(entry => entry.context))}. ${contradictions[0]?.detail ?? ""} Fix whichever is wrong; nothing here proposes removing a check.`,
    };
  }
  if (!report.entries.some(entry => isGap(entry.verdict))) {
    return {
      name: NAME,
      status: "ok",
      detail:
        "Every check the ruleset template requires is asked for by a declaration in the settings file, and every declared requirement is required by the template. Agreement between the two, not evidence that any of those checks proves its property.",
    };
  }
  return {
    name: NAME,
    status: "warn",
    // The two gaps are kept in separate sentences on purpose. An undeclared
    // gate and one declared `optional` both leave a required check ungoverned,
    // but they are not the same thing to fix, and a single sentence covering
    // both would have to say "no declaration governs these" about a context
    // whose gate IS declared — which is untrue and sends the operator looking
    // for a declaration that is already there.
    detail: [
      undeclaredClause(entriesWith(report, "enforced-undeclared")),
      optionalClause(entriesWith(report, "enforced-declared-optional")),
      awaitedClause(entriesWith(report, "enforced-awaited-elsewhere")),
      "Do NOT remove the required check to make this line go away.",
    ]
      .filter(clause => clause.length > 0)
      .join(" "),
  };
}

/**
 * The entries carrying one verdict.
 * @param report - The comparison
 * @param verdict - The verdict to collect
 * @returns The matching entries
 */
function entriesWith(
  report: DeclarationDriftReport,
  verdict: DriftEntry["verdict"]
): readonly DriftEntry[] {
  return report.entries.filter(entry => entry.verdict === verdict);
}

/**
 * The clause for contexts a gate's declaration awaits a different signal for.
 * @param entries - The awaited-elsewhere entries
 * @returns One sentence, or an empty string
 */
function awaitedClause(entries: readonly DriftEntry[]): string {
  if (entries.length === 0) return "";
  const gates = gateIdsOf(entries);
  const awaited = named([
    ...new Set(
      entries.flatMap(entry =>
        entry.awaitedInstead === null ? [] : [entry.awaitedInstead]
      )
    ),
  ]);
  return `The template also requires ${named(entries.map(entry => entry.context))} while the settings file declares ${gates} with an \`await:\` at pull-request, which promises ${awaited} as the merge condition instead. An awaited gate posts no job of its own, so unless a hand-written job posts these exact names they will never report and every pull request waits on them.`;
}

/**
 * The clause for contexts whose gate the settings file never mentions.
 * @param entries - The undeclared entries
 * @returns One sentence, or an empty string
 */
function undeclaredClause(entries: readonly DriftEntry[]): string {
  if (entries.length === 0) return "";
  const gates = gateIdsOf(entries);
  return `The ruleset template requires ${named(entries.map(entry => entry.context))}, which no declaration governs — so changing the settings file cannot turn ${entries.length === 1 ? "it" : "them"} on, off, or into something else. Declare ${gates} at pull-request to take control.`;
}

/**
 * The clause for contexts whose gate is declared optional.
 * @param entries - The optional entries
 * @returns One sentence, or an empty string
 */
function optionalClause(entries: readonly DriftEntry[]): string {
  if (entries.length === 0) return "";
  const gates = gateIdsOf(entries);
  return `The template also requires ${named(entries.map(entry => entry.context))} while the settings file declares ${gates} optional at pull-request: the job runs, may fail, and merges anyway, yet the template says the check must pass. Two surfaces, two answers — name which one wins.`;
}

/**
 * The gates behind a set of entries, named once each.
 * @param entries - The entries
 * @returns A readable list, or a fallback phrase
 */
function gateIdsOf(entries: readonly DriftEntry[]): string {
  const ids = [
    ...new Set(
      entries.flatMap(entry => (entry.gateId === null ? [] : [entry.gateId]))
    ),
  ];
  return ids.length === 0 ? "the matching gate" : ids.join(", ");
}

/**
 * The line emitted when a source could not be read.
 * @param finding - The unreadable source
 * @returns The check
 */
function unreadable(finding: Finding<DeclarationDriftReport>): DoctorCheck {
  return {
    name: NAME,
    status: "warn",
    detail:
      finding.state === "verified"
        ? ""
        : `Not checked this run: ${finding.message} This is not a pass — it means the comparison was not made.`,
  };
}

/**
 * Compare the settings file with the ruleset template it is enforced by.
 * @param projectRoot - Project root
 * @returns The check
 */
export async function checkDeclaredContexts(
  projectRoot: string
): Promise<DoctorCheck> {
  const registry = await loadGateRegistry();
  if (registry === null) {
    return unreadable({
      state: "unknown",
      reason: "registry-not-found",
      message:
        "Lisa's shipped check registry could not be located, so no declaration could be turned into the name of a required check.",
    });
  }
  const drift = buildDeclarationDrift(
    {
      registry,
      gates: readConfig(registry, projectRoot).gates,
      // The live half belongs to `lisa health`, which already reaches GitHub.
      // Doctor is documented as offline, so it states the live surface as
      // unread rather than quietly skipping it.
      contexts: {
        state: "unknown",
        reason: "offline",
        message:
          "lisa doctor makes no network call, so live branch protection was not read here.",
      },
      facade: await readFacadeFacts(projectRoot),
      mergeMoment: MERGE_MOMENT,
      workflowName: QUALITY_WORKFLOW_NAME,
    },
    "ruleset-templates",
    await readTemplateEnforcement({ projectRoot })
  );
  return drift.state === "verified"
    ? declaredContextsCheck(drift.value)
    : unreadable(drift);
}
