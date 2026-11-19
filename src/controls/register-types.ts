/**
 * The shape of the control register.
 *
 * The register is the one committed file an operator, an auditor or another
 * tool reads to see what governs a repository. It is generated from the
 * `gates` block of `.lisa.config.json` and never authored, so these types
 * describe what the generator writes.
 *
 * The published contract is the JSON Schema at
 * {@link CONTROL_REGISTER_SCHEMA_PACKAGE_PATH}. This file and that one are
 * written by hand and held to each other by
 * `tests/unit/controls/register-schema.test.ts`: every key and every allowed
 * value here must be in the schema and the other way round, so a field added
 * to one without the other fails that suite.
 *
 * ## Adding a field
 *
 * Every object is closed: the schema refuses a key it does not list. A later
 * step that needs a new fact on an entry or on an enforcement point adds an
 * optional key here and in the schema, in the change that introduces its
 * writer. Nothing existing has to move.
 * @module controls/register-types
 */
import type { CodingAgent } from "./coding-agents.js";

/** Where the register is written, from the repository root. */
export const CONTROL_REGISTER_PATH = ".lisa/controls/register.json";

/** Where the register's JSON Schema is, from the Lisa package root. */
export const CONTROL_REGISTER_SCHEMA_PACKAGE_PATH =
  "schemas/control-register.schema.json";

/** The format version the generator writes. */
export const CONTROL_REGISTER_SCHEMA_VERSION = 1;

/** The `scope` of an entry that covers the whole repository. */
export const WHOLE_REPOSITORY_SCOPE = ".";

/** What joins the gate and the scope in an entry's identifier. */
const ENTRY_ID_SEPARATOR = "@";

/** The enforcement tiers, strictest first. */
export const CONTROL_TIERS = ["authoritative", "advisory"] as const;

/** Whether the author of a change can get around a rule. */
export type ControlTier = (typeof CONTROL_TIERS)[number];

/** What a failure does at an enforcement point. */
export const ENFORCEMENT_LEVELS = ["required", "optional"] as const;

/** `required` stops the change; `optional` reports and lets it go on. */
export type EnforcementLevel = (typeof ENFORCEMENT_LEVELS)[number];

/** Every place a rule can be enforced, in the order a change reaches them. */
export const ENFORCEMENT_LOCATIONS = [
  "coding-agent",
  "local-checkout",
  "hosting-platform",
  "deployment-pipeline",
  "scheduled-run",
] as const;

/** Where a rule is enforced at one moment. */
export type EnforcementLocation = (typeof ENFORCEMENT_LOCATIONS)[number];

/** Every kind of thing that can measure a rule. */
export const MECHANISM_KINDS = [
  "command",
  "task",
  "external-check",
  "interceptor",
  "built-in",
  "none",
] as const;

/** The kind of a measuring mechanism. */
export type MechanismKind = (typeof MECHANISM_KINDS)[number];

/** Which way a threshold parameter may move. */
export const PARAMETER_DIRECTIONS = ["floor", "ceiling"] as const;

/** A `floor` may rise and never fall; a `ceiling` may fall and never rise. */
export type ParameterDirection = (typeof PARAMETER_DIRECTIONS)[number];

/**
 * What the register says about an entry beyond what the declaration states.
 *
 * `unproved`: the entry's pull-request check runs from a file Lisa did not
 * write, and the evidence file holds no record that both halves of the
 * entry's proof held. The key is left off every other entry, so its absence is not a claim
 * that the rule was proved; that is the verdict's to say.
 */
export const CONTROL_ENTRY_STATUSES = ["unproved"] as const;

/** The status of an entry that has one. */
type ControlEntryStatus = (typeof CONTROL_ENTRY_STATUSES)[number];

/** The file that runs the gates on a pull request, and the platform it is for. */
export interface PullRequestExecutor {
  /** The hosting platform's name, for example `github` or `gitlab`. */
  readonly platform: string;
  /** The file, written from the repository root. */
  readonly path: string;
}

/** A command the repository declares for one folder. */
export interface CommandMechanism {
  readonly kind: "command";
  /** One item per argument, the program first. Started in the entry's scope. */
  readonly argv: readonly string[];
}

/** A named task run through the repository's task runner. */
interface TaskMechanism {
  readonly kind: "task";
  /** The task's name in the task runner. */
  readonly task: string;
  /** The runner and the task together, as they are run. */
  readonly command: string;
}

/** A check another system reports on the pull request. */
interface ExternalCheckMechanism {
  readonly kind: "external-check";
  /** The name the check reports under. */
  readonly name: string;
  /** The id of the one app allowed to report it, or `null` for any source. */
  readonly posted_by: number | null;
}

/** A shipped hook that stops the action before it happens. */
interface InterceptorMechanism {
  readonly kind: "interceptor";
}

/** A job of the shipped pull-request workflow that measures the rule itself. */
interface BuiltInMechanism {
  readonly kind: "built-in";
}

/** Nothing measures the rule. */
interface NoMechanism {
  readonly kind: "none";
}

/** What measures a rule. */
export type MeasuringMechanism =
  | CommandMechanism
  | TaskMechanism
  | ExternalCheckMechanism
  | InterceptorMechanism
  | BuiltInMechanism
  | NoMechanism;

/** One moment a rule is enforced at, and where. */
export interface EnforcementPoint {
  /** When: `commit`, `pull-request`, `pre-deploy:production`, and so on. */
  readonly moment: string;
  readonly level: EnforcementLevel;
  readonly location: EnforcementLocation;
  /** What measures the rule here, only when it differs from the entry's own. */
  readonly measuring_mechanism?: MeasuringMechanism;
  /**
   * The file that runs the rule here, when the declaration names one. Only a
   * `pull-request` point has it.
   */
  readonly executor?: PullRequestExecutor;
  /**
   * The coding agents the rule cannot be enforced on at this moment, because
   * they have no hook that can refuse what they did. Only a point enforced by
   * a coding agent has it, and only when the declaration names an agent.
   */
  readonly unenforceable_on?: readonly CodingAgent[];
}

/** One named setting of a check. */
export interface ControlParameter {
  readonly value: number | string | boolean;
  /** Present when the value is a threshold. */
  readonly direction?: ParameterDirection;
}

/**
 * The paired proof that a rule works. Every key is always present; `null`
 * means the declaration does not say.
 */
export interface ControlProof {
  /** The patch file holding a change that breaks the rule. */
  readonly violation: string | null;
  /** The patch file holding a change that does not. */
  readonly clean: string | null;
  /** Text the check prints when it finds the rule broken. */
  readonly failure_shape: readonly string[] | null;
  /** How long one half of the proof may run. */
  readonly timeout_seconds: number | null;
  /** What the proof does outside the repository; `[]` says nothing. */
  readonly external_effects: readonly string[] | null;
}

/** A place the audit found a check: the audit report's own locator. */
export interface EvidenceLocator {
  /** The file, written from the repository root. */
  readonly path: string;
  /** The line in that file, counted from 1. */
  readonly line: number;
}

/**
 * What supports an entry: the places the audit found its check, and the audit
 * questions a person answered. Both keys are always present and at least one
 * of the two lists is not empty, because a part that names neither is refused
 * before a register is written.
 */
export interface ControlEvidence {
  /** Where the audit found the check, as the declaration lists them. */
  readonly locators: readonly EvidenceLocator[];
  /** The ids of the answered audit questions, as the declaration lists them. */
  readonly questions: readonly string[];
}

/** One rule, for one folder. */
export interface ControlRegisterEntry {
  /** `<gate>@<scope>`; see {@link controlEntryId}. */
  readonly id: string;
  /** The gate in the `gates` block the entry was generated from. */
  readonly gate: string;
  /** The requirement ids the rule serves, in catalogue order. */
  readonly criteria: readonly string[];
  /** The folder the rule covers, or {@link WHOLE_REPOSITORY_SCOPE}. */
  readonly scope: string;
  readonly tier: ControlTier;
  /** Every moment the rule is enforced at, in the order the moments happen. */
  readonly enforcement_points: readonly EnforcementPoint[];
  /** What measures the rule, unless an enforcement point says otherwise. */
  readonly measuring_mechanism: MeasuringMechanism;
  /** The check's named settings, by name. */
  readonly parameters: Readonly<Record<string, ControlParameter>>;
  readonly proof: ControlProof;
  /** Who answers for the rule, or `null` when the gate names nobody. */
  readonly accountable_party: string | null;
  /**
   * What supports the entry. Present on every entry generated from one of a
   * gate's `parts`. Absent on the entry of a gate with no parts: that rule
   * comes from the declarations Lisa ships for a supported project type, and
   * has no part to carry evidence.
   */
  readonly evidence?: ControlEvidence;
  /** Present only while the entry is {@link CONTROL_ENTRY_STATUSES unproved}. */
  readonly status?: ControlEntryStatus;
}

/** The control register file. */
export interface ControlRegister {
  readonly schema_version: typeof CONTROL_REGISTER_SCHEMA_VERSION;
  /** One entry per gate and folder, ordered by gate and then by folder. */
  readonly entries: readonly ControlRegisterEntry[];
}

/**
 * The identifier of the entry for one gate in one folder.
 *
 * It is the gate, {@link ENTRY_ID_SEPARATOR}, and the scope, both exactly as
 * the `gates` block writes them: `code-style@api`, or `code-style@.` for the
 * whole repository. Nothing else goes into it — not the entry's position, not
 * its command, not any other entry — so it is the same on every run and stays
 * the same when unrelated gates or folders are added or removed. It changes
 * only when the gate is renamed or the folder is.
 * @param gate - The gate's id in the `gates` block
 * @param scope - The folder the entry covers
 * @returns The entry's identifier
 */
export function controlEntryId(gate: string, scope: string): string {
  return `${gate}${ENTRY_ID_SEPARATOR}${scope}`;
}

/**
 * What measures an entry's rule at one of its enforcement points.
 * @param entry - The entry
 * @param point - One of its enforcement points
 * @returns The point's own mechanism when it has one, else the entry's
 */
export function mechanismAt(
  entry: ControlRegisterEntry,
  point: EnforcementPoint
): MeasuringMechanism {
  return point.measuring_mechanism ?? entry.measuring_mechanism;
}
