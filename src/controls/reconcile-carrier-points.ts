/**
 * Reading the carrier check as an answer about one enforcement point.
 *
 * Whether git runs the gate runner at commit and at push in a checkout is
 * already worked out in one place: `lisa controls install-carriers --check`.
 * It knows who owns the hooks, that `core.hooksPath` is not copied into a
 * clone, and when a hook manager is declared but not switched on. The
 * reconciler does not work any of that out again. It reads the check's
 * result and turns it into an answer about one point:
 *
 * | The check says | The point is |
 * | --- | --- |
 * | The point is `blocked` | not wired, for the check's own reason |
 * | A run would have to add the call | not wired |
 * | A file the call depends on would be created | not wired: it is missing |
 * | A file the call depends on would only be rewritten | wired, and said to differ, as long as its text still starts the runner |
 * | Nothing about the point would change | wired |
 *
 * The files a point depends on are the file that holds the call, the carrier
 * script for its hook, and the gate runner. A hook that a Lisa project type
 * ships calls the runner itself, so it depends on none of the files this
 * command places. A coding agent's hook depends on the edit-time carrier it
 * starts, which is a script and the program beside it.
 *
 * The check reports a point by `location` and `moment`, the same two words
 * the control register uses. Nothing here assumes the point is a git hook,
 * so a carrier of another kind is read the same way once the check reports
 * one. Only the last look at a rewritten file's text is specific to git
 * hooks, because only their invocation is known here.
 * @module controls/reconcile-carrier-points
 */
import {
  AGENT_CARRIER_PATH,
  AGENT_CARRIER_PROGRAM_PATH,
} from "./carrier-agent-script.js";
import { HOOKS_PATH_SETTING } from "./carrier-git.js";
import {
  AGENT_CONFIG,
  CARRIER_HOOKS_FOLDER,
  CARRIER_RUNNER_FILE,
  GIT_HOOK_LOCATION,
  INSTALL_CARRIERS_INVOCATION,
  STACK_HOOK,
  type CarrierPoint,
  type CarrierResult,
} from "./carrier-types.js";
import type { PointVerdict } from "./reconcile-types.js";

/** Reads a file by the path the carrier check shows it under. */
export type ShownFileReader = (shown: string) => Promise<string | null>;

/**
 * Tell whether a text still starts the gate runner at a moment.
 *
 * A look at the text, and only that: some line that is not a comment names
 * Lisa's carrier script for the hook, or names the runner with the moment.
 * @param text - A hook file's or a carrier script's content
 * @param point - The enforcement point the file serves
 * @returns Whether such a line is there
 */
function startsRunner(text: string, point: CarrierPoint): boolean {
  const script = `${CARRIER_HOOKS_FOLDER}/${point.hook}`;
  return text
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .some(
      line =>
        line.includes(script) ||
        (line.includes(CARRIER_RUNNER_FILE) &&
          line.includes(`--moment=${point.moment}`))
    );
}

/**
 * Join some names the way a sentence lists them.
 * @param names - At least one name
 * @returns `a`, `a and b`, or `a, b and c`
 */
function listed(names: readonly string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * The files of a point that must start the runner themselves.
 * @param point - The enforcement point
 * @returns The file that holds the call and, for a git hook that is not a
 *   project type's own, Lisa's carrier script
 */
function callingFiles(point: CarrierPoint): readonly string[] {
  const holdsCall =
    point.path === null || point.path === HOOKS_PATH_SETTING
      ? []
      : [point.path];
  if (point.wired_through === AGENT_CONFIG) {
    // A coding agent's hook starts Lisa's edit-time carrier, which is two
    // files. With either gone the hook entry is there and starts nothing.
    return [...holdsCall, AGENT_CARRIER_PATH, AGENT_CARRIER_PROGRAM_PATH];
  }
  const ownScript =
    point.location === GIT_HOOK_LOCATION && point.wired_through !== STACK_HOOK
      ? [`${CARRIER_HOOKS_FOLDER}/${point.hook}`]
      : [];
  return [...holdsCall, ...ownScript];
}

/**
 * Find the rewritten files of a point that no longer start the runner.
 * @param point - The enforcement point
 * @param rewritten - The files a run would rewrite
 * @param read - Reads a file by the path it is shown under
 * @returns The files whose text does not start the runner any more
 */
async function silenced(
  point: CarrierPoint,
  rewritten: readonly string[],
  read: ShownFileReader
): Promise<readonly string[]> {
  if (point.location !== GIT_HOOK_LOCATION) return [];
  const calling = callingFiles(point).filter(file => rewritten.includes(file));
  const texts = await Promise.all(calling.map(file => read(file)));
  return calling.filter((_, index) => {
    const text = texts[index];
    return text === null || text === undefined || !startsRunner(text, point);
  });
}

/**
 * Say why a point a run would have to wire is not wired now.
 * @param point - The enforcement point
 * @param result - The carrier check's result
 * @returns The reason
 */
function unwired(point: CarrierPoint, result: CarrierResult): string {
  const setting = result.changes.some(
    change => change.action === "set" && change.path === HOOKS_PATH_SETTING
  );
  if (setting && point.path === HOOKS_PATH_SETTING) {
    return `Git is not set to run hooks from ${CARRIER_HOOKS_FOLDER} in this checkout (${HOOKS_PATH_SETTING} is not set), so nothing starts the gate runner at ${point.moment}. Git does not copy that setting into a new clone.`;
  }
  const holder = point.path ?? `The ${point.hook} hook`;
  return `${holder} does not call the gate runner, so nothing starts it at ${point.moment}.`;
}

/**
 * Choose the word that agrees with how many things a sentence is about.
 * @param names - The things
 * @param one - The word for one
 * @param many - The word for more
 * @returns The word
 */
function agreeing(names: readonly string[], one: string, many: string): string {
  return names.length === 1 ? one : many;
}

/**
 * The files a point depends on that a run would create or rewrite.
 * @param point - The enforcement point
 * @param result - The carrier check's result
 * @param action - `create` for a missing file, `update` for one that differs
 * @returns The files, as the check shows them
 */
function pendingFiles(
  point: CarrierPoint,
  result: CarrierResult,
  action: "create" | "update"
): readonly string[] {
  const depends = new Set([
    ...callingFiles(point),
    ...(point.wired_through === STACK_HOOK ? [] : result.runner.files),
  ]);
  return result.changes
    .filter(change => change.action === action && depends.has(change.path))
    .map(change => change.path);
}

/**
 * Say why a point whose call is in place is still not wired, when it is not.
 * @param point - The enforcement point
 * @param result - The carrier check's result
 * @param read - Reads a file by the path the check shows it under
 * @returns The reason, or `null` when something starts the runner there
 */
async function brokenBehindTheCall(
  point: CarrierPoint,
  result: CarrierResult,
  read: ShownFileReader
): Promise<string | null> {
  const missing = pendingFiles(point, result, "create");
  if (missing.length > 0) {
    return `${listed(missing)} ${agreeing(missing, "is", "are")} missing, so the ${point.hook} hook cannot start the gate runner at ${point.moment}.`;
  }
  const quiet = await silenced(
    point,
    pendingFiles(point, result, "update"),
    read
  );
  return quiet.length === 0
    ? null
    : `${listed(quiet)} no longer ${agreeing(quiet, "starts", "start")} the gate runner at ${point.moment}.`;
}

/**
 * Say that a point is wired, and which of its files differ from Lisa's own.
 * @param point - The enforcement point
 * @param result - The carrier check's result
 * @returns The sentence
 */
function wiredReason(point: CarrierPoint, result: CarrierResult): string {
  const wired = `The ${point.hook} hook starts the gate runner at ${point.moment} in this checkout.`;
  const rewritten = pendingFiles(point, result, "update");
  return rewritten.length === 0
    ? wired
    : `${wired} ${listed(rewritten)} ${agreeing(rewritten, "differs", "differ")} from what this version of Lisa installs; run "${INSTALL_CARRIERS_INVOCATION}" to bring ${agreeing(rewritten, "it", "them")} up to date.`;
}

/**
 * Say what the carrier check established about one enforcement point.
 * @param point - The point, as the check reports it
 * @param result - The whole result of the check
 * @param read - Reads a file by the path the check shows it under
 * @returns Whether something starts the gate runner there, and why
 */
export async function carrierVerdict(
  point: CarrierPoint,
  result: CarrierResult,
  read: ShownFileReader
): Promise<PointVerdict> {
  const notWired = (reason: string): PointVerdict => ({
    checked: point.path,
    reason,
    state: "not-wired",
  });
  if (point.outcome === "blocked") {
    return notWired(
      point.reason ??
        `Git does not run the declared checks at ${point.moment} in this checkout.`
    );
  }
  if (point.outcome === "installed") return notWired(unwired(point, result));
  const broken = await brokenBehindTheCall(point, result, read);
  return broken === null
    ? {
        checked: point.path,
        reason: wiredReason(point, result),
        state: "wired",
      }
    : notWired(broken);
}
