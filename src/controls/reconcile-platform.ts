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
  /** Every check the platform requires on that branch. */
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
export function isPlatformPoint(point: EnforcementPoint): boolean {
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

/**
 * Quote some check names for a sentence.
 * @param names - At least one check name
 * @returns The names in quotes, joined
 */
function quoted(names: readonly string[]): string {
  return names.map(name => `"${name}"`).join(", ");
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
  return missing.length === 0
    ? {
        checked: checks.join(", "),
        reason: `${answer.label} requires ${quoted(checks)} ${merge}.`,
        state: "wired",
      }
    : {
        checked: checks.join(", "),
        reason: `${answer.label} does not require ${quoted(missing)} ${merge}, so a change can be merged without it.`,
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
