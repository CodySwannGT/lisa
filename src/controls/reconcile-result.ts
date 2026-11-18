/**
 * Saying how a reconcile run went: which places were read, and the outcome
 * in one sentence.
 *
 * Three outcomes are kept apart. `in-step` and `findings` both mean every
 * place that was needed was read; the difference is whether anything
 * differs, and neither is a failure. `incomplete` means a place that was
 * needed could not be read, so silence about it proves nothing. That is the
 * only outcome the command fails on, and the result says which place.
 * @module controls/reconcile-result
 */
import type { HooksRead } from "./reconcile-hooks.js";
import type { PlatformRead } from "./reconcile-platform.js";
import {
  PLATFORM_FLAG,
  RECONCILE_INVOCATION,
  type CommittedRegister,
  type ReconcileFinding,
  type ReconcileOutcome,
  type ReconciledPoint,
  type SurfaceRead,
} from "./reconcile-types.js";
import { CONTROL_REGISTER_PATH } from "./register-types.js";

/** What the reads of a run came to. */
export interface SurfaceFacts {
  /** Whether the committed register is what the declaration generates. */
  readonly committed: CommittedRegister;
  /** What the hooks held. */
  readonly hooks: HooksRead;
  /** Whether any register entry depends on the hosting platform's settings. */
  readonly needsPlatform: boolean;
  /** What became of the read of the hosting platform. */
  readonly platform: PlatformRead;
}

/** The state of a read that was needed and failed. */
const COULD_NOT_READ = "could-not-read";

/** What is said about the committed register when it is not current. */
const REGISTER_NOTES: Readonly<Record<CommittedRegister, string | null>> = {
  absent: `${CONTROL_REGISTER_PATH} is not in this checkout. The comparison used the register the declaration generates; run "lisa controls register" to write the file.`,
  current: null,
  stale: `${CONTROL_REGISTER_PATH} is not what the declaration generates now. The comparison used the register the declaration generates; run "lisa controls register" to bring the file up to date.`,
};

/**
 * Say what became of the read of the hosting platform.
 * @param facts - What the reads came to
 * @returns The surface row
 */
function platformSurface(facts: SurfaceFacts): SurfaceRead {
  const surface = "hosting-platform";
  if (!facts.needsPlatform) {
    return {
      detail:
        "No register entry depends on the hosting platform's merge settings.",
      state: "not-needed",
      surface,
    };
  }
  if (!facts.platform.asked) {
    return {
      detail: `Not read in this run. Run "${RECONCILE_INVOCATION} ${PLATFORM_FLAG}" to read whether the hosting platform requires the checks the register lists for a pull request.`,
      state: "not-asked",
      surface,
    };
  }
  return facts.platform.answer === null
    ? { detail: facts.platform.detail, state: COULD_NOT_READ, surface }
    : {
        detail: `Read the checks ${facts.platform.answer.label} requires before a merge into ${facts.platform.answer.branch}.`,
        state: "read",
        surface,
      };
}

/**
 * Say what became of every read of a run, in a fixed order.
 * @param facts - What the reads came to
 * @returns One row per place
 */
export function surfacesOf(facts: SurfaceFacts): readonly SurfaceRead[] {
  const { files, problems } = facts.hooks;
  return [
    {
      detail: REGISTER_NOTES[facts.committed],
      state: "read",
      surface: "register",
    },
    { detail: null, state: "read", surface: "carriers" },
    problems.length > 0
      ? {
          detail: problems.join(" "),
          state: COULD_NOT_READ,
          surface: "hooks",
        }
      : {
          detail:
            files.length === 0
              ? "No commit or push hook was found to read."
              : `Read ${files.join(", ")}.`,
          state: "read",
          surface: "hooks",
        },
    platformSurface(facts),
  ];
}

/**
 * Write a count with its noun.
 * @param count - How many
 * @param one - The noun for one
 * @param many - The noun for any other number
 * @returns For example `1 command` or `3 commands`
 */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Say the outcome of a run, and why, in one sentence.
 * @param points - Every enforcement point, as it was reconciled
 * @param findings - Every finding
 * @param surfaces - What became of every read
 * @returns The outcome and its sentence
 */
export function describeReconcile(
  points: readonly ReconciledPoint[],
  findings: readonly ReconcileFinding[],
  surfaces: readonly SurfaceRead[]
): { readonly outcome: ReconcileOutcome; readonly reason: string } {
  const unread = surfaces.filter(surface => surface.state === COULD_NOT_READ);
  const missing = findings.filter(
    finding => finding.kind === "enforcement-point-not-wired"
  ).length;
  const undeclared = findings.length - missing;
  const parts = [
    ...(missing === 0
      ? []
      : [
          `${counted(missing, "enforcement point the register lists is", "enforcement points the register lists are")} not wired`,
        ]),
    ...(undeclared === 0
      ? []
      : [
          `${counted(undeclared, "command runs", "commands run")} in a hook with no register entry that declares it`,
        ]),
  ];
  const differ =
    parts.length === 0 ? "nothing differs." : `${parts.join(", and ")}.`;
  if (unread.length > 0) {
    return {
      outcome: "incomplete",
      reason: `This comparison is not complete: ${unread.map(surface => surface.surface).join(" and ")} could not be read. Of what was read, ${differ}`,
    };
  }
  if (findings.length > 0) {
    return {
      outcome: "findings",
      reason: `The register and what is installed differ: ${differ}`,
    };
  }
  const wired = points.filter(point => point.state === "wired").length;
  const open = points.length - wired;
  const unchecked =
    open === 0 ? "" : `, ${open} could not be checked by this run`;
  return {
    outcome: "in-step",
    reason: `The register and what is installed are in step: ${wired} of ${counted(points.length, "enforcement point", "enforcement points")} ${wired === 1 ? "was" : "were"} confirmed${unchecked}, and no hook runs a command the register does not declare.`,
  };
}
