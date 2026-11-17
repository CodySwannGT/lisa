/**
 * Adding the call to a carrier to a hook file the repository already owns.
 *
 * Husky, a hooks folder named by `core.hooksPath`, and git's own hooks folder
 * all hold one shell script per hook. The call is added at the end of that
 * script, between markers, so what the script already does keeps running
 * first. The added lines start by reading the exit status of what ran above
 * them: a hook that failed before still fails, with the same status.
 *
 * The file is refused, and left exactly as it is, whenever lines added at
 * its end would not do that: it is not a shell script, git does not run it,
 * or it ends by handing over to another program.
 * @module controls/carrier-shell-hook
 */
import path from "node:path";

import { fileEdit, fileState, type FileState } from "./carrier-edits.js";
import { shownPath } from "./carrier-owner.js";
import {
  carrierCall,
  carrierScriptPath,
  findMarkedBlock,
  withMarkedBlock,
} from "./carrier-script.js";
import {
  CARRIER_RUNNER_FILE,
  INSTALL_CARRIERS_INVOCATION,
  STACK_HOOK,
  type CarrierEdit,
  type CarrierMoment,
  type PointPlan,
  type WiredThrough,
} from "./carrier-types.js";

/** The first line of a hook file this command creates. */
const SHEBANG = "#!/bin/sh";

/** The programs whose scripts the call can be added to. */
const SHELLS = ["sh", "bash", "dash", "ash", "ksh", "zsh"];

/** What Lisa writes at the top of a file it replaces on every update. */
const REPLACED_EACH_RUN = "managed by Lisa and IS replaced";

/** One hook file to add the call to. */
export interface ShellHook {
  /** Real path of the repository. */
  readonly root: string;
  /** The moment the hook runs at. */
  readonly moment: CarrierMoment;
  /** Who owns the file. */
  readonly through: WiredThrough;
  /** The hook file. */
  readonly file: string;
  /**
   * Whether the owner starts the file with `sh` itself, so that it needs
   * neither a first line naming a shell nor permission to be started.
   */
  readonly startedBySh: boolean;
  /** Why git does not reach this file in this checkout yet, or `null`. */
  readonly notSwitchedOn: string | null;
}

/** The plan for one hook file. */
export interface ShellHookPlan {
  readonly point: PointPlan;
  readonly edits: readonly CarrierEdit[];
}

/**
 * Tell whether a hook already starts the gate runner the way a hook shipped
 * by a Lisa project type does.
 * @param text - The hook file's content
 * @param moment - The moment the hook runs at
 * @returns Whether a second call would run the gates twice
 */
export function callsRunnerItself(
  text: string,
  moment: CarrierMoment
): boolean {
  return (
    text.includes(CARRIER_RUNNER_FILE) &&
    text
      .split("\n")
      .some(
        line =>
          !line.trimStart().startsWith("#") &&
          line.includes(`--moment=${moment}`) &&
          line.includes("--coverage")
      )
  );
}

/**
 * Tell whether Lisa replaces a file on every update.
 * @param text - The file's content
 * @returns Whether anything added to it would be lost
 */
export function isReplacedByLisa(text: string): boolean {
  return text.includes(REPLACED_EACH_RUN);
}

/**
 * The program a script's first line names.
 * @param text - The script
 * @returns The program's name, or `null` when the first line names none
 */
function interpreter(text: string): string | null {
  const [first = ""] = text.split("\n");
  if (!first.startsWith("#!")) return null;
  const words = first.slice(2).trim().split(/\s+/u);
  const [program = ""] = words;
  const named =
    path.basename(program) === "env"
      ? words
          .slice(1)
          .find(word => !word.startsWith("-") && !word.includes("="))
      : program;
  return named === undefined ? null : path.basename(named);
}

/**
 * The last line of a script that does something.
 * @param text - The script
 * @returns The line, trimmed; empty when the script does nothing
 */
function lastCommand(text: string): string {
  return (
    text
      .split("\n")
      .map(line => line.trim())
      .filter(line => line !== "" && !line.startsWith("#"))
      .at(-1) ?? ""
  );
}

/**
 * Say why the call cannot be added to an existing hook file.
 * @param hook - The hook file
 * @param shown - How the file is named to a person
 * @param state - What is in the file
 * @param text - Its content
 * @returns The reason, or `null` when it can be added
 */
function refusal(
  hook: ShellHook,
  shown: string,
  state: FileState,
  text: string
): string | null {
  const byHand = `Add this line to it by hand, where it will run after the existing checks: sh ${carrierScriptPath(hook.moment)} "$@" || exit $?`;
  if (isReplacedByLisa(text)) {
    return `${shown} is replaced by Lisa on every update, so a line added to it would be lost. Nothing was added; this repository's project type has to call the gate runner itself.`;
  }
  const program = interpreter(text);
  if (program === null ? !hook.startedBySh : !SHELLS.includes(program)) {
    return `${shown} is not a shell script, so the gate runner cannot be added after what it already does without changing it. It was left as it is. Start the existing program from a shell script, then run this again.`;
  }
  if (!state.executable && !hook.startedBySh) {
    return `${shown} is not marked executable, so git does not run it. It was left as it is. Make it executable or remove it, then run this again.`;
  }
  return /^(?:exec|exit)\b/u.test(lastCommand(text))
    ? `${shown} ends with "${lastCommand(text).split(/\s+/u)[0] ?? ""}", so anything added after its last line would never run. It was left as it is. ${byHand}`
    : null;
}

/**
 * Plan the call in a hook file that is not there yet or already holds text.
 * @param hook - The hook file
 * @param shown - How the file is named to a person
 * @param state - What is in the file
 * @returns The plan
 */
function planCall(
  hook: ShellHook,
  shown: string,
  state: FileState
): ShellHookPlan {
  const point = (
    call: PointPlan["call"],
    blocked: string | null,
    through = hook.through
  ): PointPlan => ({
    blocked,
    call,
    moment: hook.moment,
    path: shown,
    through,
  });
  const text = state.content?.toString("utf8") ?? "";
  if (callsRunnerItself(text, hook.moment)) {
    return {
      edits: [],
      point: point("present", hook.notSwitchedOn, STACK_HOOK),
    };
  }
  const marked = findMarkedBlock(text.split("\n"), hook.moment);
  const refused =
    state.content === null || (marked.problem === null && marked.found)
      ? null
      : refusal(hook, shown, state, text);
  if (refused !== null) return { edits: [], point: point("absent", refused) };
  const written = withMarkedBlock(
    state.content === null ? `${SHEBANG}\n` : text,
    hook.moment,
    carrierCall(hook.moment)
  );
  if (written.problem !== null) {
    return {
      edits: [],
      point: point(
        "absent",
        `In ${shown}, ${written.problem}, so the lines this command wrote there cannot be found. Remove what is left of them, then run this again.`
      ),
    };
  }
  const edit = fileEdit(
    {
      absolute: hook.file,
      content: written.text,
      executable: state.content === null || state.executable,
      path: shown,
    },
    state
  );
  return {
    edits: edit === null ? [] : [edit],
    point: point(
      state.content === null ? "added" : written.state,
      hook.notSwitchedOn
    ),
  };
}

/**
 * Plan the call to the carrier in one hook file.
 * @param hook - The hook file
 * @returns What the point becomes and the write that makes it so
 */
export async function wireShellHook(hook: ShellHook): Promise<ShellHookPlan> {
  const shown = shownPath(hook.root, hook.file);
  const state = await fileState(hook.file);
  if (state.kind !== "missing" && state.kind !== "file") {
    return {
      edits: [],
      point: {
        blocked: `${shown} is not an ordinary file (it may be a link), so it was left as it is. Replace it with an ordinary file, then run "${INSTALL_CARRIERS_INVOCATION}" again.`,
        call: "absent",
        moment: hook.moment,
        path: shown,
        through: hook.through,
      },
    };
  }
  return planCall(hook, shown, state);
}
