/**
 * Hold the gates declaration against the live ruleset, on a path a machine
 * takes on its own.
 *
 * The comparison itself was not the missing piece. A finished reconciler has
 * existed for some time, unit- and mutation-covered, reporting MISSING, EXTRA,
 * MATCHED and a distinct UNPROVEN — and nothing invoked it. Its only callers
 * were copies of prose in a skill telling a human to type the command, which
 * makes it indistinguishable from a control that was never written. This module
 * is the same comparison sitting on a scheduled, machine-invoked path.
 *
 * Two rules it does not get to bend:
 *
 * - **A source this run could not read is `warn`, never `pass`.** A comparison
 *   that silently passes when it could not reach the live ruleset is the exact
 *   defect this check exists to catch, sited on the check itself.
 * - **Nothing here proposes removing a live required context, with one
 *   evidenced exception.** A context no declaration asks for is reported so it
 *   can be told apart from a third-party check, not so it can be pruned. The
 *   sole removal in `core/gate-declaration-drift`'s vocabulary is reachable
 *   only from a `previousLabels` match — Lisa's own record that Lisa renamed
 *   the job — and is a REPORT even then: the ruleset carrying the retired name
 *   is frequently one Lisa does not manage, and editing somebody else's
 *   ruleset is not this check's decision to make.
 *
 * This is also the only surface that sees a ruleset Lisa does not manage.
 * `lisa-github-rulesets.sh` and `health/ruleset-inspection` are both scoped per
 * MANAGED ruleset name, so a hand-made ruleset requiring a retired context is
 * invisible to both — the #3067 failure. The live reader here lists every
 * ruleset the repository has, managed or not, and the comparison runs over all
 * of them.
 * @module health/declared-checks-inspection
 */
import {
  classifyDeclarationDrift,
  contextOwners,
  type DeclarationDriftReport,
} from "../core/gate-declaration-drift.js";
import { loadGateRegistry } from "../cli/gate-report-registry.js";
import type { HealthFinding } from "./contract.js";
import { deterministicFinding, namedReason } from "./finding-utils.js";
import {
  liveRequiredContexts,
  type HealthRuleset,
  type RulesetReader,
} from "./ruleset-inspection.js";

/** This check's stable id. */
const CHECK = "github.declared-checks";

/** The workflow whose name prefixes a run gate's status context. */
const QUALITY_WORKFLOW_NAME = "🔍 Quality Checks";

/** Repository slug parts this check will address. */
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/u;

/**
 * The repository this check would read, when the settings file names one.
 * @param config - Safe project config
 * @returns The owner and repository, or undefined
 */
function githubTarget(
  config: Readonly<Record<string, unknown>>
): { readonly owner: string; readonly repo: string } | undefined {
  const github = config.github;
  if (github === null || typeof github !== "object" || Array.isArray(github)) {
    return undefined;
  }
  const owner = Reflect.get(github, "org");
  const repo = Reflect.get(github, "repo");
  return typeof owner === "string" &&
    typeof repo === "string" &&
    REPOSITORY_PART.test(owner) &&
    REPOSITORY_PART.test(repo)
    ? { owner, repo }
    : undefined;
}

/**
 * The finding one completed comparison produces.
 *
 * A contradiction fails: the two surfaces state opposite things, and one of
 * them is wrong. A gap warns: the declaration is silent, and silence is not
 * permission to stop requiring the context — the registry still carries gates
 * whose jobs run with no declaration anywhere, so reading silence as a defect
 * of the ruleset would point the operator at the wrong file.
 * @param report - The completed comparison
 * @returns The finding
 */
export function declaredChecksFinding(
  report: DeclarationDriftReport
): HealthFinding {
  // FIRST, ahead of the contradictions. A retired context is the only verdict
  // here that may be blocking every pull request in the repository at this
  // moment, and it is the one an operator cannot find on their own: there is
  // no failing job to open and no log to read, so the reason it blocks has to
  // come from this line or from nowhere.
  const retired = report.entries.filter(
    entry => entry.verdict === "enforced-context-retired"
  );
  if (retired.length > 0) {
    return deterministicFinding(
      CHECK,
      "fail",
      namedReason(
        "Live branch protection requires contexts nothing will ever post — these are not failing, they can never report, and every pull request here waits on them forever",
        retired.map(entry => entry.detail)
      )
    );
  }
  const contradictions = report.entries.filter(
    entry =>
      entry.verdict === "declared-not-enforced" ||
      entry.verdict === "enforced-declared-off"
  );
  if (contradictions.length > 0) {
    return deterministicFinding(
      CHECK,
      "fail",
      namedReason(
        "Gates declarations contradict live branch protection",
        contradictions.map(entry => `${entry.context} (${entry.verdict})`)
      )
    );
  }
  const gaps = report.entries.filter(
    entry =>
      entry.verdict === "enforced-undeclared" ||
      entry.verdict === "enforced-declared-optional"
  );
  return gaps.length === 0
    ? deterministicFinding(
        CHECK,
        "pass",
        "Every context live branch protection requires is governed by a gates declaration."
      )
    : deterministicFinding(
        CHECK,
        "warn",
        namedReason(
          "Live branch protection requires contexts no declaration governs",
          gaps.map(entry => `${entry.context} (${entry.verdict})`)
        )
      );
}

/**
 * Compare the gates declaration with the live ruleset.
 * @param projectRoot - Canonical host root
 * @param config - Safe project config
 * @param reader - Structured remote ruleset reader
 * @param timeoutMs - Remaining shared deadline
 * @param signal - Shared cancellation signal
 * @returns The finding, never a pass on an unread source
 */
export async function declaredChecksDriftFinding(
  projectRoot: string,
  config: Readonly<Record<string, unknown>>,
  reader: RulesetReader,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HealthFinding> {
  const target = githubTarget(config);
  if (target === undefined) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: no GitHub repository is configured, so the gates declarations were not held against live branch protection."
    );
  }
  const registry = await loadGateRegistry();
  if (registry === null) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: Lisa's shipped gate registry could not be located, so no declaration could be resolved into a status context."
    );
  }
  const actual = await readLive(reader, {
    owner: target.owner,
    repo: target.repo,
    projectRoot,
    timeoutMs,
    signal,
  });
  if (actual === undefined) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: live branch protection could not be read within the deterministic deadline, so nothing here claims a declaration does or does not match it."
    );
  }
  // An empty sweep and a clean repository are otherwise identical, and the
  // empty one is the more likely: a token without the ruleset scope, an
  // organization-level ruleset the reader cannot see, and a repository that
  // genuinely has no protection all arrive here as zero rows. Comparing
  // against zero rulesets would report every declared requirement as enforced
  // by nothing — a different and false claim, and exactly what the
  // comparator's own contract forbids its callers from asking it for.
  if (actual.length === 0) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: the repository reported no rulesets at all. A token without the ruleset scope, an organization ruleset this reader cannot see, and a repository with no protection are indistinguishable from here — so this run inspected nothing rather than finding nothing."
    );
  }
  const gates = readGatesSafely(registry, projectRoot);
  if (gates === null) {
    return deterministicFinding(
      CHECK,
      "warn",
      "Unproven: the gates block could not be read, so the contexts it implies could not be compared with live branch protection."
    );
  }
  return declaredChecksFinding(
    classifyDeclarationDrift({
      surface: "live-ruleset",
      owners: contextOwners({
        registry,
        gates,
        workflowName: QUALITY_WORKFLOW_NAME,
      }),
      enforced: liveRequiredContexts(actual),
    })
  );
}

/**
 * Call the ruleset reader, surviving a reader that throws synchronously.
 *
 * `.catch()` on the returned promise handles a rejection and nothing else; a
 * reader whose failure happens before it returns one would take the entire
 * health run down, turning "this source was unreadable" into no report at all.
 * @param reader - Structured remote ruleset reader
 * @param options - Reader arguments
 * @param options.owner - Repository owner
 * @param options.repo - Repository name
 * @param options.projectRoot - Canonical host root
 * @param options.timeoutMs - Remaining shared deadline
 * @param options.signal - Shared cancellation signal
 * @returns The rulesets, or undefined when they could not be read
 */
async function readLive(
  reader: RulesetReader,
  options: {
    owner: string;
    repo: string;
    projectRoot: string;
    timeoutMs: number;
    signal: AbortSignal;
  }
): Promise<readonly HealthRuleset[] | undefined> {
  try {
    return await reader(
      options.owner,
      options.repo,
      options.projectRoot,
      options.timeoutMs,
      options.signal
    );
  } catch {
    return undefined;
  }
}

/** The one registry call this module needs beyond the comparison itself. */
interface GatesReader {
  readonly readGates: (cwd: string) => { gates: Record<string, unknown> };
}

/**
 * Read the gates block, keeping a refusal distinguishable from an empty one.
 * @param registry - The shipped registry
 * @param projectRoot - Canonical host root
 * @returns The gates block, or null when it could not be read
 */
function readGatesSafely(
  registry: GatesReader,
  projectRoot: string
): Record<string, unknown> | null {
  try {
    return registry.readGates(projectRoot).gates;
  } catch {
    return null;
  }
}
