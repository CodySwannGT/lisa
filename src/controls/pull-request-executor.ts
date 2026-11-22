/**
 * The pull-request executor a declaration names, and what the control
 * register says about it.
 *
 * The executor is the file the hosting platform runs on a pull request, which
 * in turn runs the gates. Lisa ships that file for one platform. On any other
 * the host's agent writes it, and the `gates` block says where it is, on the
 * gate's pull-request entry:
 *
 * ```json
 * "pull-request": {
 *   "level": "required",
 *   "executor": { "platform": "gitlab", "path": ".gitlab-ci.yml" }
 * }
 * ```
 *
 * The register records the executor on the entry's pull-request enforcement
 * point. Lisa did not write a host's workflow and has never seen it
 * refuse a change, so every entry it runs carries `status: "unproved"` until
 * the evidence file holds a record of both halves of that entry's proof,
 * each saying the half held.
 *
 * ## Why the register may depend on the evidence file
 *
 * The register is compared byte for byte with what generating it again would
 * write. The status can clear when the authorized attest receipt binds both
 * current halves to the live check definition. Hosted evidence can expire
 * after the register was written. A declaration without host-authored
 * executors still produces the register from the declaration alone.
 * @module controls/pull-request-executor
 */
import { isJsonObject } from "../sync/json-path.js";
import { compareCodeUnits } from "./canonical-json.js";
import { EVIDENCE_PATH } from "./evidence.js";
import {
  GATES_DECLARATION_PATH,
  type DeclaredGate,
  type GatesDeclaration,
} from "./gates-declaration.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
  PullRequestExecutor,
} from "./register-types.js";

/** The one moment that has an executor, as the gate registry writes it. */
export const PULL_REQUEST_MOMENT = "pull-request";

/** The key of a pull-request entry that names the executor. */
export const EXECUTOR_KEY = "executor";

/** The one platform Lisa ships the pull-request executor for. */
export const LISA_WRITTEN_PLATFORM = "github";

/** The pull-request caller provided by Lisa's supported GitHub stacks. */
const SHIPPED_PULL_REQUEST_WORKFLOW = ".github/workflows/ci.yml";

/** The levels at which a gate is checked at a moment; `off` is neither. */
const ENFORCED_LEVELS: readonly unknown[] = ["required", "optional"];

/** One gate that is checked at the pull-request moment. */
interface PullRequestGate {
  /** The gate's id. */
  readonly gate: string;
  /** `required` or `optional`. */
  readonly level: string;
  /** The executor the gate names, or `null` when it names none. */
  readonly executor: PullRequestExecutor | null;
  /** Whether the gate waits there for a check another system reports. */
  readonly awaits: boolean;
}

/**
 * A gate's pull-request entry in its long form.
 * @param gate - The gate as declared
 * @returns The entry, or `null` when the gate is not declared there
 */
function pullRequestEntry(
  gate: DeclaredGate
): Readonly<Record<string, unknown>> | null {
  const declared = gate[PULL_REQUEST_MOMENT];
  if (typeof declared === "string") return { level: declared };
  return isJsonObject(declared) ? declared : null;
}

/**
 * The executor one gate names for its pull-request moment.
 * @param gate - The gate, from a validated declaration
 * @returns The platform and the file, or `null` when the gate names none
 */
export function declaredExecutor(
  gate: DeclaredGate
): PullRequestExecutor | null {
  const executor = pullRequestEntry(gate)?.[EXECUTOR_KEY];
  if (!isJsonObject(executor)) return null;
  const { platform, path } = executor;
  return typeof platform === "string" && typeof path === "string"
    ? { platform, path }
    : null;
}

/**
 * Tell whether an executor is one Lisa ships.
 * @param executor - The executor
 * @returns Whether it identifies Lisa's packaged pull-request caller
 */
export function isWrittenByLisa(executor: PullRequestExecutor): boolean {
  return (
    executor.platform === LISA_WRITTEN_PLATFORM &&
    executor.path === SHIPPED_PULL_REQUEST_WORKFLOW
  );
}

/**
 * Every gate a declaration checks at the pull-request moment, by gate id.
 * @param declaration - The validated declaration
 * @returns The gates that are `required` or `optional` there
 */
function pullRequestGates(
  declaration: GatesDeclaration
): readonly PullRequestGate[] {
  return Object.keys(declaration.gates)
    .sort(compareCodeUnits)
    .flatMap(gate => {
      const declared = declaration.gates[gate] ?? {};
      const entry = pullRequestEntry(declared);
      return entry !== null &&
        typeof entry.level === "string" &&
        ENFORCED_LEVELS.includes(entry.level)
        ? [
            {
              gate,
              level: entry.level,
              executor: declaredExecutor(declared),
              // Truthiness, as the gate registry itself decides whether a
              // moment awaits: an empty `await` awaits nothing.
              awaits: Boolean(entry.await),
            },
          ]
        : [];
    });
}

/**
 * Say where an executor is, in words.
 * @param executor - The executor
 * @returns For example `.gitlab-ci.yml on gitlab`
 */
function located(executor: PullRequestExecutor): string {
  return `${executor.path} on ${executor.platform}`;
}

/**
 * Write an executor the way the declaration does.
 * @param executor - The executor
 * @returns The `executor` key and its value, as JSON
 */
function asDeclared(executor: PullRequestExecutor): string {
  return `"${EXECUTOR_KEY}": { "platform": ${JSON.stringify(executor.platform)}, "path": ${JSON.stringify(executor.path)} }`;
}

/**
 * Name some gates as the subject of a sentence.
 * @param gates - Gate ids, at least one
 * @param verb - The verb, singular
 * @returns For example `"a" and "b" name` or `"a" names`
 */
function subject(gates: readonly string[], verb: string): string {
  const quoted = gates.map(gate => `"${gate}"`);
  const names =
    quoted.length === 1
      ? quoted.join("")
      : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
  const agreeing = quoted.length === 1 ? `${verb}s` : verb;
  return `${names} ${agreeing}`;
}

/** A gate and the executor it names. */
interface NamingGate {
  readonly gate: string;
  readonly executor: PullRequestExecutor;
}

/**
 * Report a declaration that names more than one executor.
 * @param named - The gates that name an executor
 * @returns The one-line problem, or `null` when they all name the same one
 */
function disagreement(named: readonly NamingGate[]): string | null {
  const places = [...new Set(named.map(each => located(each.executor)))];
  if (places.length < 2) return null;
  const who = places
    .map(place => {
      const gates = named
        .filter(each => located(each.executor) === place)
        .map(each => each.gate);
      return `${subject(gates, "name")} ${place}`;
    })
    .join("; ");
  return `The gates block in ${GATES_DECLARATION_PATH} names more than one file that runs the gates on a pull request: ${who}. One command runs every gate checked at the ${PULL_REQUEST_MOMENT} moment, so they all run from one file. Write the same executor on each of these gates.`;
}

/**
 * Every gate checked at the pull-request moment names the same executor, or
 * none of them names one.
 *
 * One command runs every gate declared at that moment, so they all run from
 * one file. A declaration that names the file on some gates and not on others
 * would leave the rest reading as enforced on the hosting platform with
 * nothing to say the file Lisa did not write runs them too. A gate that waits
 * for a check another system reports is run by no file of the repository, so
 * it may leave the executor out.
 * @param context - What a register rule is given
 * @param context.declaration - The validated declaration
 * @returns One line per problem
 */
export function executorsAgree(context: {
  readonly declaration: GatesDeclaration;
}): readonly string[] {
  const checked = pullRequestGates(context.declaration);
  const named = checked.flatMap(({ gate, executor }): readonly NamingGate[] =>
    executor === null ? [] : [{ gate, executor }]
  );
  const [first] = named;
  if (first === undefined) return [];
  const disagreeing = disagreement(named);
  if (disagreeing !== null) return [disagreeing];
  const { executor, gate: namer } = first;
  return checked
    .filter(each => each.executor === null && !each.awaits)
    .map(
      each =>
        `The gate "${each.gate}" in ${GATES_DECLARATION_PATH} is checked at the ${PULL_REQUEST_MOMENT} moment but does not name the file that runs it there, and the gate "${namer}" does (${located(executor)}). One command runs every gate checked at that moment, so they all run from one file. Name it on "${each.gate}" too: "${PULL_REQUEST_MOMENT}": { "level": "${each.level}", ${asDeclared(executor)} }, keeping anything else that entry already says.`
    );
}

/**
 * Record each gate's declared executor on its entries' pull-request points.
 * @param entries - The register's entries
 * @param declaration - The validated declaration they were built from
 * @returns The entries; one whose gate names no executor is returned as it is
 */
export function withDeclaredExecutors(
  entries: readonly ControlRegisterEntry[],
  declaration: GatesDeclaration
): readonly ControlRegisterEntry[] {
  return entries.map(entry => {
    const executor = declaredExecutor(declaration.gates[entry.gate] ?? {});
    return executor === null
      ? entry
      : {
          ...entry,
          enforcement_points: entry.enforcement_points.map(point =>
            point.moment === PULL_REQUEST_MOMENT
              ? { ...point, executor }
              : point
          ),
        };
  });
}

/**
 * The executor an entry's pull-request check runs from, when Lisa did not
 * write it.
 * @param entry - The entry
 * @returns The executor, or `null` when there is none or Lisa wrote it
 */
export function unwrittenExecutor(
  entry: ControlRegisterEntry
): PullRequestExecutor | null {
  const executor = entry.enforcement_points.find(
    point => point.moment === PULL_REQUEST_MOMENT
  )?.executor;
  return executor === undefined || isWrittenByLisa(executor) ? null : executor;
}

/**
 * Mark every entry whose pull-request check runs from a file Lisa did not
 * write as unproved until the authorized receipt confirms the pair.
 * @param entries - The entries, their executors already recorded
 * @param confirmed - The entries whose exact proof receipts were verified
 * @returns The entries, `status: "unproved"` added where it applies
 */
export function withProofStatus(
  entries: readonly ControlRegisterEntry[],
  confirmed?: ReadonlySet<string>
): readonly ControlRegisterEntry[] {
  return entries.map(entry => {
    if (unwrittenExecutor(entry) === null) return entry;
    if (confirmed?.has(entry.id) !== true)
      return { ...entry, status: "unproved" as const };
    const { status: _status, ...proved } = entry;
    return proved;
  });
}

/**
 * Say which entries of a register read unproved and why, for the operator.
 * @param register - The register
 * @returns One sentence-group, or `null` when no entry reads unproved
 */
export function unprovedNote(register: ControlRegister): string | null {
  const unproved = register.entries.filter(
    entry => entry.status === "unproved"
  );
  const executor = unproved
    .map(entry => unwrittenExecutor(entry))
    .find(found => found !== null);
  if (executor === undefined || executor === null) return null;
  const one = unproved.length === 1;
  const ids = unproved.map(entry => entry.id).join(", ");
  return `${unproved.length} ${one ? "entry reads" : "entries read"} unproved: ${ids}. The ${PULL_REQUEST_MOMENT} check for ${one ? "it" : "them"} runs from ${located(executor)}, a file Lisa did not write. Authenticating both halves of ${one ? "its" : "their"} proof in ${EVIDENCE_PATH} requires a trusted, current receipt. ${one ? "It stays" : "They stay"} unproved until the attest step records that both held.`;
}

/** What a drift report adds when an entry's status is what differs. */
export const STATUS_DRIFT_NOTE = `The status depends on a trusted, current attest receipt for the proof records in ${EVIDENCE_PATH}.`;
