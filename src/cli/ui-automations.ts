/**
 * Live-status probe for the console Automations section.
 *
 * Reads the harness scheduler (Codex `~/.codex/automations/` or Claude
 * `/schedule`) and emits only `lisa-auto-<project>-` matches with their real
 * cadence. READ-ONLY — never fabricates demo automations; absent or unreadable
 * schedulers resolve to unknown with a reason.
 * @module cli/ui-automations
 */
import type { JsonValue } from "../sync/json-path.js";
import type { ProbeResult, StatusProbe } from "./ui-status.js";
import {
  defaultCodexDirReadable,
  defaultListCodexAutomations,
  defaultReadClaudeScheduleListing,
  defaultResolveIdentity,
  loadDefaultListClaudeAutomations,
  resolveDefaultCodexAutomationsDir,
} from "./ui-automations-adapters.js";

/** Stable probe id consumed by `/api/status` and the Automations section. */
export const AUTOMATIONS_PROBE_ID = "automations";

const PROBE_TIMEOUT_MS = 8_000;
const IDENTITY_UNAVAILABLE = "identity-unavailable";
const SCHEDULER_UNAVAILABLE = "scheduler-unavailable";
const SCHEDULER_UNREADABLE = "scheduler-unreadable";
const SCHEDULER_UNAVAILABLE_MESSAGE =
  "No harness scheduler is configured (Codex automations directory absent and Claude /schedule listing unavailable)";

/** One observed automation from a harness scheduler adapter. */
export interface HarnessAutomationObservation {
  readonly automationId: string;
  readonly observedCadence?: string;
  readonly status?: string;
  readonly lastRunAt?: string | null;
}

/** One automation entry shipped to the console (never invented). */
export interface HarnessAutomationEntry {
  readonly [key: string]: JsonValue;
  readonly id: string;
  readonly cadence: string | null;
  readonly runtime: "codex" | "claude";
  readonly status: string | null;
  readonly lastRunAt: string | null;
}

/** Structured value emitted when the scheduler is readable. */
export type AutomationsProbeValue = {
  readonly [key: string]: JsonValue;
  readonly prefix: string;
  readonly runtime: "codex" | "claude";
  /** Prefix-matching automations; typed as JsonValue[] for the probe transport. */
  readonly automations: JsonValue[];
};

/** Resolved Lisa automation naming identity for the current project. */
export interface AutomationProjectIdentity {
  readonly owner: string;
  readonly repo: string;
  readonly project: string;
  readonly automationPrefix: string;
}

/** Resolve `lisa-auto-<project>-` for the served project root. */
export type ProjectIdentityResolver = (
  cwd: string,
  signal: AbortSignal
) => Promise<AutomationProjectIdentity>;

/** List Codex automations matching a prefix (adapter seam). */
export type CodexAutomationLister = (input: {
  readonly automationsDir?: string;
  readonly automationPrefix: string;
  readonly signal?: AbortSignal;
}) => Promise<readonly HarnessAutomationObservation[]>;

/** List Claude `/schedule` automations matching a prefix (adapter seam). */
export type ClaudeAutomationLister = (input: {
  readonly scheduleListing: unknown;
  readonly automationPrefix: string;
}) => readonly HarnessAutomationObservation[];

/** Read the Claude `/schedule` listing when the runtime can expose it. */
export type ClaudeScheduleListingReader = (
  signal: AbortSignal
) => Promise<unknown | null>;

/** Whether the Codex automations directory exists and is readable. */
export type CodexDirReadableCheck = (
  automationsDir: string,
  signal: AbortSignal
) => Promise<boolean>;

/** Injectable collaborators for focused tests and default runtime wiring. */
export interface AutomationsProbeDependencies {
  readonly cwd: string;
  readonly automationsDir?: string;
  readonly resolveIdentity?: ProjectIdentityResolver;
  readonly listCodexAutomations?: CodexAutomationLister;
  readonly listClaudeAutomations?: ClaudeAutomationLister;
  readonly readClaudeScheduleListing?: ClaudeScheduleListingReader;
  readonly codexAutomationsDirReadable?: CodexDirReadableCheck;
}

/** Inputs for {@link mapHarnessAutomations}. */
export interface MapHarnessAutomationsInput {
  readonly prefix: string;
  readonly runtime: "codex" | "claude";
  readonly observations: readonly HarnessAutomationObservation[];
}

/**
 * Map scheduler observations onto the live-status tri-state contract.
 * @param input - Prefix, runtime label, and raw observations
 * @returns Probe value with only prefix-matching automations
 */
export function mapHarnessAutomations(
  input: MapHarnessAutomationsInput
): ProbeResult<AutomationsProbeValue> {
  const automations: HarnessAutomationEntry[] = input.observations
    .filter(entry => entry.automationId.startsWith(input.prefix))
    .map(
      (entry): HarnessAutomationEntry => ({
        id: entry.automationId,
        cadence:
          typeof entry.observedCadence === "string" &&
          entry.observedCadence.trim().length > 0
            ? entry.observedCadence
            : null,
        runtime: input.runtime,
        status:
          typeof entry.status === "string" && entry.status.trim().length > 0
            ? entry.status
            : null,
        lastRunAt:
          typeof entry.lastRunAt === "string" &&
          entry.lastRunAt.trim().length > 0
            ? entry.lastRunAt
            : null,
      })
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    state: "value",
    value: {
      prefix: input.prefix,
      runtime: input.runtime,
      automations,
    },
  };
}

/**
 * Map thrown identity errors to unknown.
 * @param error - Thrown value
 * @returns Unknown identity result
 */
function identityUnknown(error: unknown): ProbeResult<AutomationsProbeValue> {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Unable to resolve repo identity for automation naming";
  return { state: "unknown", reason: IDENTITY_UNAVAILABLE, message };
}

/**
 * Map scheduler read failures to unknown.
 * @param error - Thrown value
 * @returns Unknown scheduler result
 */
function schedulerUnreadable(
  error: unknown
): ProbeResult<AutomationsProbeValue> {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Harness scheduler could not be read";
  return { state: "unknown", reason: SCHEDULER_UNREADABLE, message };
}

/**
 * Create the Automations live-status probe.
 * @param dependencies - Project root plus injectable scheduler seams
 * @returns Probe registered under {@link AUTOMATIONS_PROBE_ID}
 */
export function createAutomationsProbe(
  dependencies: AutomationsProbeDependencies
): StatusProbe<AutomationsProbeValue> {
  const resolveIdentity =
    dependencies.resolveIdentity ?? defaultResolveIdentity;
  const listCodex =
    dependencies.listCodexAutomations ?? defaultListCodexAutomations;
  const readClaudeListing =
    dependencies.readClaudeScheduleListing ?? defaultReadClaudeScheduleListing;
  const codexReadable =
    dependencies.codexAutomationsDirReadable ?? defaultCodexDirReadable;
  const automationsDir =
    dependencies.automationsDir ?? resolveDefaultCodexAutomationsDir();

  return {
    id: AUTOMATIONS_PROBE_ID,
    timeoutMs: PROBE_TIMEOUT_MS,
    run: async signal => {
      const base: AutomationsProbeRunInput = {
        cwd: dependencies.cwd,
        signal,
        resolveIdentity,
        listCodex,
        readClaudeListing,
        codexReadable,
        automationsDir,
      };
      return runAutomationsProbe(
        dependencies.listClaudeAutomations === undefined
          ? base
          : {
              ...base,
              listClaudeAutomations: dependencies.listClaudeAutomations,
            }
      );
    },
  };
}

/** Bound collaborators for one automations probe request. */
interface AutomationsProbeRunInput {
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly resolveIdentity: ProjectIdentityResolver;
  readonly listCodex: CodexAutomationLister;
  readonly readClaudeListing: ClaudeScheduleListingReader;
  readonly codexReadable: CodexDirReadableCheck;
  readonly automationsDir: string;
  readonly listClaudeAutomations?: ClaudeAutomationLister;
}

/**
 * Execute one automations probe cycle.
 * @param input - Bound collaborators for this request
 * @returns Probe result
 */
async function runAutomationsProbe(
  input: AutomationsProbeRunInput
): Promise<ProbeResult<AutomationsProbeValue>> {
  const identity = await input.resolveIdentity(input.cwd, input.signal).then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error })
  );
  if (!identity.ok) {
    return identityUnknown(identity.error);
  }

  if (await input.codexReadable(input.automationsDir, input.signal)) {
    try {
      return mapHarnessAutomations({
        prefix: identity.value.automationPrefix,
        runtime: "codex",
        observations: await input.listCodex({
          automationsDir: input.automationsDir,
          automationPrefix: identity.value.automationPrefix,
          signal: input.signal,
        }),
      });
    } catch (error) {
      return schedulerUnreadable(error);
    }
  }

  const listing = await input.readClaudeListing(input.signal).then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error })
  );
  if (!listing.ok) {
    return schedulerUnreadable(listing.error);
  }
  if (listing.value === null || listing.value === undefined) {
    return {
      state: "unknown",
      reason: SCHEDULER_UNAVAILABLE,
      message: SCHEDULER_UNAVAILABLE_MESSAGE,
    };
  }

  try {
    const listClaude =
      input.listClaudeAutomations ?? (await loadDefaultListClaudeAutomations());
    return mapHarnessAutomations({
      prefix: identity.value.automationPrefix,
      runtime: "claude",
      observations: listClaude({
        scheduleListing: listing.value,
        automationPrefix: identity.value.automationPrefix,
      }),
    });
  } catch (error) {
    return schedulerUnreadable(error);
  }
}
