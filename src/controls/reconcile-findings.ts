/**
 * Turning what a reconcile run read into the findings an operator acts on.
 *
 * There are two kinds, one for each direction the register is compared in:
 *
 * - A claimed enforcement point that nothing runs. The finding names the
 *   register entry, says where the register claims the rule is checked, and
 *   says what was found there instead.
 * - A command a hook runs that no register entry declares. The finding names
 *   the hook, the file and line, and the command.
 *
 * Neither is an error. The first is a rule that is not being enforced where
 * the record says it is. The second is a control that runs with nothing on
 * record that says what it proves. Both are for a person to look at, and
 * this command changes nothing about either.
 *
 * A point that could not be verified, or whose answer could not be read, is
 * not a finding: not knowing is not absence.
 * @module controls/reconcile-findings
 */
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { INSTALL_CARRIERS_INVOCATION } from "./carrier-types.js";
import { isWrittenByLisa } from "./pull-request-executor.js";
import { EXECUTOR_INVOCATION } from "./reconcile-executor.js";
import {
  RECONCILE_INVOCATION,
  type CommandFinding,
  type HookCommand,
  type PointFinding,
  type ReconciledPoint,
} from "./reconcile-types.js";
import {
  WHOLE_REPOSITORY_SCOPE,
  type ControlRegister,
  type ControlRegisterEntry,
  type EnforcementLocation,
} from "./register-types.js";

/** How a moment is written after "is checked". */
const WHEN: Readonly<Record<string, string>> = {
  commit: "at commit",
  push: "at push",
  "pull-request": "on a pull request",
};

/** What was found instead, by where the register claims the rule is run. */
const INSTEAD: Readonly<Record<EnforcementLocation, string>> = {
  "coding-agent": "nothing in this checkout makes the coding agent run it",
  "local-checkout": "nothing in this checkout runs it",
  "hosting-platform": "nothing was found that enforces it there",
  "deployment-pipeline": "nothing was found that runs it there",
  "scheduled-run": "nothing was found that runs it there",
};

/** What is said last about running this command again. */
const AGAIN = `Then run "${RECONCILE_INVOCATION}" again.`;

/** What to do about a command no entry declares. */
export const UNDECLARED_NEXT = `If the team relies on this check, declare it in the "gates" block of ${GATES_DECLARATION_PATH} and run "lisa controls register" so that the register lists it. If it does not, nothing has to change: this command never removes anything.`;

/**
 * Say what to do about a point that nothing runs.
 * @param entry - The register entry
 * @param point - The point, as it was reconciled
 * @returns One or two plain sentences
 */
function nextFor(entry: ControlRegisterEntry, point: ReconciledPoint): string {
  if (point.location !== "hosting-platform") {
    return `Run "${INSTALL_CARRIERS_INVOCATION}" in this checkout. ${AGAIN}`;
  }
  const executor = entry.enforcement_points.find(
    each => each.moment === point.moment
  )?.executor;
  return executor === undefined || isWrittenByLisa(executor)
    ? `Run "lisa controls protect" to see which checks the hosting platform would have to require, and have an administrator make that change. ${AGAIN}`
    : `Put ${executor.path} back so that it runs "${EXECUTOR_INVOCATION}" on every pull request, or change the executor the "gates" block of ${GATES_DECLARATION_PATH} names and run "lisa controls register". ${AGAIN}`;
}

/**
 * Report one claimed enforcement point that nothing runs.
 * @param entry - The register entry
 * @param point - The point, as it was reconciled
 * @returns The finding
 */
function pointFinding(
  entry: ControlRegisterEntry,
  point: ReconciledPoint
): PointFinding {
  const where =
    entry.scope === WHOLE_REPOSITORY_SCOPE ? "" : ` in folder ${entry.scope}`;
  const when = WHEN[point.moment] ?? `at ${point.moment}`;
  return {
    criteria: entry.criteria,
    entry_id: entry.id,
    gate: entry.gate,
    kind: "enforcement-point-not-wired",
    location: point.location,
    message: `The register says "${entry.gate}"${where} is checked ${when}, but ${INSTEAD[point.location]} (register entry ${entry.id}). ${point.reason}`,
    moment: point.moment,
    next: nextFor(entry, point),
    scope: entry.scope,
  };
}

/**
 * Report every claimed enforcement point that nothing runs.
 * @param register - The control register
 * @param points - Every point, as it was reconciled
 * @returns One finding per point found not wired, in register order
 */
export function pointFindings(
  register: ControlRegister,
  points: readonly ReconciledPoint[]
): readonly PointFinding[] {
  return points.flatMap(point => {
    const entry = register.entries.find(each => each.id === point.entry_id);
    return entry === undefined || point.state !== "not-wired"
      ? []
      : [pointFinding(entry, point)];
  });
}

/**
 * Report every command a hook runs that no register entry declares.
 * @param commands - Every command the hooks run
 * @returns One finding per undeclared command, in the order they were read
 */
export function commandFindings(
  commands: readonly HookCommand[]
): readonly CommandFinding[] {
  return commands
    .filter(command => command.declared_by.length === 0)
    .map(command => ({
      command: command.command,
      hook: command.hook,
      kind: "undeclared-command",
      line: command.line,
      message: `The ${command.moment} hook also runs "${command.command}" (${command.path} line ${command.line}), which the register does not mention.`,
      moment: command.moment,
      next: UNDECLARED_NEXT,
      path: command.path,
    }));
}
