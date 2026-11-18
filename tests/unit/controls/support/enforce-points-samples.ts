/**
 * Register entries, carriers and results for the suites that judge whether a
 * register entry's check now runs (CodySwannGT/lisa#4994).
 *
 * The carriers are given as a read of the checkout found them
 * (`src/controls/enforce-carriers.ts`), which is what the points are judged
 * from: never as the saved carriers result on its own.
 * @module tests/unit/controls/support/enforce-points-samples
 */
import type {
  InstalledCarrier,
  InstalledCarrierState,
} from "../../../../src/controls/enforce-carriers.js";
import type { HandedProtect } from "../../../../src/controls/enforce-inputs.js";
import { enforcedEntries } from "../../../../src/controls/enforce-points.js";
import type { EnforcedEntry } from "../../../../src/controls/enforce-types.js";
import type { PointVerdict } from "../../../../src/controls/reconcile-types.js";
import type {
  ControlRegisterEntry,
  EnforcementPoint,
  MeasuringMechanism,
} from "../../../../src/controls/register-types.js";

export const PIPELINE_FILE = ".gitlab-ci.yml";
export const NOTHING = "nothing-to-enforce";

export const COMMAND: MeasuringMechanism = {
  kind: "command",
  argv: ["ruff", "check", "."],
};
export const TASK: MeasuringMechanism = {
  kind: "task",
  task: "lint",
  command: "npm run lint",
};
export const EXTERNAL: MeasuringMechanism = {
  kind: "external-check",
  name: "Security scan",
  posted_by: null,
};
export const IN_PLACE = "in-place";
export const NOT_IN_PLACE = "not-in-place";
export const NO_HOOK = "no-hook";
export const DISAGREES =
  "The carriers result that was handed in says this carrier is in place; this checkout was read again just now and the carrier is not in place. What the checkout holds now is what is reported.";

export const COMMIT: EnforcementPoint = {
  moment: "commit",
  level: "required",
  location: "local-checkout",
};
export const EDIT: EnforcementPoint = {
  moment: "post-tool",
  level: "required",
  location: "coding-agent",
};
export const MERGE: EnforcementPoint = {
  moment: "pull-request",
  level: "required",
  location: "hosting-platform",
};
export const DEPLOY: EnforcementPoint = {
  moment: "pre-deploy:production",
  level: "required",
  location: "deployment-pipeline",
};

/**
 * A register entry for the whole repository.
 * @param points - Its enforcement points
 * @param mechanism - What measures it
 * @returns The entry
 */
export function entry(
  points: readonly EnforcementPoint[],
  mechanism: MeasuringMechanism = COMMAND
): ControlRegisterEntry {
  return {
    id: "code-style@.",
    gate: "code-style",
    criteria: ["SI7"],
    scope: ".",
    tier: "authoritative",
    enforcement_points: points,
    measuring_mechanism: mechanism,
    parameters: {},
    proof: {
      clean: null,
      violation: null,
      failure_shape: null,
      timeout_seconds: null,
      external_effects: null,
    },
    accountable_party: null,
  };
}

/**
 * One carrier, as a read of the checkout found it.
 * @param moment - `commit`, `push` or `post-tool`
 * @param state - Whether it is in place now
 * @param extra - The agent and how it refuses, for an agent carrier
 * @returns The carrier
 */
export function carried(
  moment: string,
  state: InstalledCarrierState,
  extra: Partial<InstalledCarrier> = {}
): InstalledCarrier {
  return {
    contradicts: null,
    location: moment === "post-tool" ? "coding-agent" : "local-checkout",
    moment,
    reason: state === NOT_IN_PLACE ? "A hook file is in the way." : "",
    state,
    wired_through: moment === "post-tool" ? "agent-config" : "lisa",
    ...extra,
  };
}

/**
 * The carriers a read of the checkout found.
 * @param points - The carriers
 * @returns The same carriers
 */
export function carriers(
  points: readonly InstalledCarrier[]
): readonly InstalledCarrier[] {
  return points;
}

/**
 * A merge-protection result.
 * @param outcome - What it says of the entry; left out, it lists no entry
 * @returns The result
 */
export function protect(outcome?: "wired" | "blocked"): HandedProtect {
  return {
    mode: "read-only",
    branch: "main",
    platform: { name: "github" },
    entries:
      outcome === undefined
        ? []
        : [
            {
              id: "code-style@.",
              outcome,
              reason: `The platform says ${outcome}.`,
            },
          ],
    handover: {
      path: ".lisa/controls/merge-protection-change.md",
      action: "none",
    },
    requests: [],
  };
}

export const FILE_WIRED: PointVerdict = {
  state: "wired",
  reason: "The pipeline file runs the gate runner.",
  checked: PIPELINE_FILE,
};

/**
 * Judge one entry.
 * @param judged - The entry
 * @param sources - The carriers and the merge-protection result
 * @param sources.carriers - The carriers a read of the checkout found
 * @param sources.protect - The merge-protection result
 * @param sources.file - What reading the host's pipeline file says
 * @param sources.gateCriteria - The requirements a check can refuse a
 *   change for; the entry's own by default
 * @returns The judged entry
 */
export async function judge(
  judged: ControlRegisterEntry,
  sources: {
    readonly carriers?: readonly InstalledCarrier[];
    readonly protect?: HandedProtect;
    readonly file?: PointVerdict;
    readonly gateCriteria?: readonly string[];
  } = {}
): Promise<EnforcedEntry> {
  const [result] = await enforcedEntries(
    { schema_version: 1, entries: [judged] },
    {
      executorVerdict: () => Promise.resolve(sources.file ?? FILE_WIRED),
      gateCriteria: sources.gateCriteria ?? ["SI7"],
      installed: sources.carriers ?? carriers([carried("commit", IN_PLACE)]),
      protect: sources.protect ?? protect(),
    }
  );
  if (result === undefined) throw new Error("No entry was judged.");
  return result;
}
