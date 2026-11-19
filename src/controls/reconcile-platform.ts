/**
 * Asking the hosting platform whether it requires the checks a register
 * says it does.
 *
 * A rule the register lists as enforced on a pull request, on GitHub, is
 * enforced there only when the platform refuses a merge without its check.
 * That is a setting the platform holds, and reading it is the one thing
 * `lisa controls reconcile` does that leaves the machine. So it is asked for
 * with a flag and never done otherwise: a plain run is local and fast.
 *
 * Nothing here is new. The read is `readMergeProtection`, the same read the
 * audit makes: reads only, to github.com only, through the recording door
 * that refuses anything that is not a read. The check names are derived by
 * `deriveRequiredChecks`, the same derivation `lisa controls protect`
 * compares and changes.
 *
 * Three answers are kept apart, because they mean different things:
 *
 * - The platform was not asked. Nothing is known, and nothing is claimed.
 * - It was asked and did not answer. That is "could not be read", with the
 *   access that is missing. It is never a finding that a check is absent.
 * - It answered. Only then can a point be `wired` or `not-wired`.
 *
 * ## Only rulesets are read
 *
 * GitHub keeps required checks in two places: rulesets, and branch
 * protection rules of the older kind. The read covers rulesets only. So an
 * answer that lists no check is a finding only when a ruleset governs the
 * branch: then the repository uses rulesets, and the one that should require
 * the check does not. When no ruleset governs the branch at all, whatever
 * the repository requires sits where this command did not look, and the
 * point is `not-read`. Either way the reason says that only rulesets were
 * read.
 *
 * A point left `not-read` for that reason also makes the read of the
 * platform one that could not be made ({@link unreadWithoutRuleset}), so the
 * run is incomplete and fails. A repository with no merge protection of
 * either kind has no ruleset on the branch either, and a run that passed
 * there would lose the one finding that matters most. Reading the older
 * rules, which would tell the two apart, is CodySwannGT/lisa#5018.
 * @module controls/reconcile-platform
 */
import type { AuditProbe } from "./audit-probe-types.js";
import {
  readMergeProtection,
  type MergeProtectionDependencies,
  type MergeProtectionRead,
} from "./merge-protection-read.js";
import { deriveRequiredChecks, isProtectedEntry } from "./protect-derive.js";
import { loadProtectionModules } from "./protect-modules.js";
import { platformLabel } from "./protect-platform.js";
import { isWrittenByLisa } from "./pull-request-executor.js";
import {
  PLATFORM_FLAG,
  RECONCILE_INVOCATION,
  type PointVerdict,
} from "./reconcile-types.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
  EnforcementPoint,
} from "./register-types.js";

/** What the hosting platform requires before a merge, as it answered. */
export interface PlatformAnswer {
  /** The platform's name as a person writes it. */
  readonly label: string;
  /** The branch whose protection was read. */
  readonly branch: string;
  /** The rulesets that govern that branch, by name. */
  readonly rulesets: readonly string[];
  /** Every check those rulesets require on that branch. */
  readonly required: readonly string[];
  /** The checks the register derives for each protected entry, by entry id. */
  readonly checks: Readonly<Record<string, readonly string[]>>;
}

/** What became of the read of the hosting platform. */
export type PlatformRead =
  | { readonly asked: false }
  | {
      readonly asked: true;
      readonly answer: null;
      /** What was in the way, and the access that is missing. */
      readonly detail: string;
    }
  | { readonly asked: true; readonly answer: PlatformAnswer };

/**
 * Tell whether a point is one only the hosting platform can answer for.
 * @param point - An enforcement point
 * @returns Whether it is enforced on the hosting platform by a pipeline Lisa
 *   ships, rather than by a file the register names
 */
function isPlatformPoint(point: EnforcementPoint): boolean {
  return (
    point.location === "hosting-platform" &&
    (point.executor === undefined || isWrittenByLisa(point.executor))
  );
}

/**
 * Tell whether any entry of a register needs the hosting platform read.
 * @param register - The control register
 * @returns Whether some point is one only the platform can answer for
 */
export function needsPlatform(register: ControlRegister): boolean {
  return register.entries.some(entry =>
    entry.enforcement_points.some(point => isPlatformPoint(point))
  );
}

/**
 * End a sentence with exactly one full stop.
 * @param text - The sentence, with or without its full stop
 * @returns The sentence, ending with one
 */
function sentence(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

/**
 * Say why a platform gave no answer, and what access is missing.
 * @param probe - The probe the read returned, or `null` for no platform
 * @returns One or two plain sentences
 */
function unanswered(probe: AuditProbe | null): string {
  if (probe === null) {
    return "Nothing says where this repository is hosted: it has no origin remote on a known platform. Add the remote, then run this again.";
  }
  const why = probe.observed_error ?? probe.reason ?? "It gave no answer.";
  return [
    `${probe.system} could not be read.`,
    sentence(why),
    ...(probe.access_needed === undefined
      ? []
      : [sentence(`What is needed: ${probe.access_needed}`)]),
  ].join(" ");
}

/**
 * Turn a read of the platform into what the points are judged against.
 * @param read - What `readMergeProtection` returned
 * @param checks - The derived checks of each protected entry
 * @returns The answer, or why there is none
 */
function answered(
  read: MergeProtectionRead,
  checks: PlatformAnswer["checks"]
): PlatformRead {
  return read.merge_protection === null || read.branch === null
    ? { answer: null, asked: true, detail: unanswered(read.probe) }
    : {
        answer: {
          branch: read.branch,
          checks,
          label: platformLabel(read.platform.name),
          required: read.merge_protection.required_checks.map(
            check => check.context
          ),
          rulesets: read.merge_protection.rulesets,
        },
        asked: true,
      };
}

/**
 * Read which checks the hosting platform requires before a merge.
 * @param root - Real path of the repository
 * @param register - The control register
 * @param dependencies - Replaceable collaborators of the read
 * @returns What the platform requires, or why it could not be read
 */
export async function readPlatform(
  root: string,
  register: ControlRegister,
  dependencies: MergeProtectionDependencies = {}
): Promise<PlatformRead> {
  const modules = await (dependencies.loadModules ?? loadProtectionModules)();
  const derived = deriveRequiredChecks({
    gates: modules.gates.readGates(root).gates,
    modules,
    register,
  });
  return answered(
    await readMergeProtection(root, dependencies),
    Object.fromEntries(
      derived.entries.map(({ checks, entry }) => [entry.id, checks] as const)
    )
  );
}

/** What is said wherever the rules this command does not read matter. */
const OLDER_RULES =
  "Branch protection rules of the older kind, if this repository uses them, are not read.";

/**
 * Quote some check names for a sentence.
 * @param names - At least one check name
 * @returns The names in quotes, joined
 */
function quoted(names: readonly string[]): string {
  return names.map(name => `"${name}"`).join(", ");
}

/**
 * Say that no ruleset governs the branch an answer is about.
 * @param answer - What the platform requires
 * @returns The opening of a reason, ending with a full stop
 */
function noRuleset(answer: PlatformAnswer): string {
  return `No ruleset governs ${answer.branch} on ${answer.label}, and rulesets are the only merge settings this command reads.`;
}

/**
 * Say why an answer from the platform still leaves the comparison
 * incomplete, when it does.
 *
 * The platform answered, and no ruleset governs the branch. A repository
 * that keeps its required checks in the older branch protection rules looks
 * like that, and so does one with no merge protection at all, and the two
 * cannot be told apart from here. So a check the register lists for a pull
 * request was not looked for anywhere it could be. That is a place that was
 * needed and could not be read, never a clean read.
 * @param answer - What the platform requires
 * @returns What could not be read and why, or `null` when every check the
 *   register lists was looked for
 */
export function unreadWithoutRuleset(answer: PlatformAnswer): string | null {
  if (answer.rulesets.length > 0) return null;
  const unread = [...new Set(Object.values(answer.checks).flat())].filter(
    check => !answer.required.includes(check)
  );
  return unread.length === 0
    ? null
    : `${noRuleset(answer)} So whether ${answer.label} requires ${quoted(unread)} before a merge into ${answer.branch} could not be read: a branch protection rule of the older kind may require it, or nothing may. Reading those rules is not built yet (CodySwannGT/lisa#5018).`;
}

/**
 * Say what an answered platform shows about one entry.
 * @param entry - The register entry
 * @param answer - What the platform requires
 * @returns The verdict
 */
function fromAnswer(
  entry: ControlRegisterEntry,
  answer: PlatformAnswer
): PointVerdict {
  const merge = `before a merge into ${answer.branch}`;
  if (!isProtectedEntry(entry)) {
    return {
      checked: null,
      reason: `The register does not list this rule as both authoritative and required on a pull request, so ${answer.label} is not asked to require it ${merge}. Whether the pipeline runs it cannot be read by this command.`,
      state: "not-verifiable",
    };
  }
  const checks = answer.checks[entry.id] ?? [];
  const missing = checks.filter(check => !answer.required.includes(check));
  if (checks.length === 0) {
    return {
      checked: null,
      reason: `No check name is derived for this rule, so there is nothing to look for on ${answer.label}.`,
      state: "not-verifiable",
    };
  }
  if (missing.length === 0) {
    return {
      checked: checks.join(", "),
      reason: `${answer.label} requires ${quoted(checks)} ${merge}.`,
      state: "wired",
    };
  }
  return answer.rulesets.length === 0
    ? {
        checked: checks.join(", "),
        reason: `${noRuleset(answer)} ${OLDER_RULES} So whether ${answer.label} requires ${quoted(missing)} ${merge} is not known.`,
        state: "not-read",
      }
    : {
        checked: checks.join(", "),
        reason: `${answer.label} does not require ${quoted(missing)} ${merge} in the ${answer.rulesets.length === 1 ? "ruleset that governs" : "rulesets that govern"} it (${answer.rulesets.join(", ")}), so a change can be merged without it unless a branch protection rule of the older kind requires it. Only rulesets were read.`,
        state: "not-wired",
      };
}

/**
 * Say what the hosting platform shows about one entry's pull-request point.
 * @param entry - The register entry
 * @param read - What became of the read of the platform
 * @returns Whether the platform requires the entry's checks, or why that is
 *   not known
 */
export function platformVerdict(
  entry: ControlRegisterEntry,
  read: PlatformRead
): PointVerdict {
  if (!read.asked) {
    return {
      checked: null,
      reason: `Whether the hosting platform requires this check before a merge was not read in this run. Run "${RECONCILE_INVOCATION} ${PLATFORM_FLAG}" to read it.`,
      state: "not-read",
    };
  }
  return read.answer === null
    ? { checked: null, reason: read.detail, state: "not-read" }
    : fromAnswer(entry, read.answer);
}
