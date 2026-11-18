/**
 * Adding the call to a carrier to a hook file the repository already owns.
 *
 * Husky, a hooks folder named by `core.hooksPath`, and git's own hooks folder
 * all hold one shell script per hook. The call is added at the end of that
 * script, between markers, so what the script already does keeps running
 * first. The added lines start by reading the exit status of what ran above
 * them: a hook that failed before still fails, with the same status.
 *
 * Running after that content has one cost at push. Git writes what is being
 * pushed on the hook's standard input once, and the content above may have
 * read some of it. Lines added at the end cannot take a copy before that
 * happens, so the call does not pass standard input on: the carrier is
 * started without it and the runner runs every part. See
 * `./carrier-script.ts`.
 *
 * The file is refused, and left exactly as it is, whenever lines added at
 * its end would not do that: it is not a shell script, git does not run it,
 * a line above the place can end the hook before the added lines are
 * reached, or the hook could not be read as far as the place
 * (`./carrier-hook-reach.ts`). The last two say which line, and carry the
 * lines to add by hand.
 *
 * The same questions are asked of a hook that already holds the lines. A
 * hook changes after the day it was wired: someone adds an `exit 0` above
 * the lines, or the file loses its permission to be started. Reporting such
 * a hook as wired would be reporting checks that no longer run.
 * @module controls/carrier-shell-hook
 */
import path from "node:path";

import { fileEdit, fileState, type FileState } from "./carrier-edits.js";
import { earlyLeave, type EarlyLeave } from "./carrier-hook-reach.js";
import {
  carrierCall,
  carrierCallBlock,
  carrierMarkers,
  findMarkedBlock,
  withMarkedBlock,
  type MarkedBlock,
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
  /** How the file is named to a person: never a path of the machine. */
  readonly shown: string;
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

/** What a line that can end a hook holds, said to a person. */
const LEAVES: Readonly<Record<Exclude<EarlyLeave["word"], "unread">, string>> =
  {
    exec: 'an "exec" there hands over to another program',
    exit: 'an "exit" there can leave without a failure: it is neither given a status written as a number other than 0 nor the last part of "|| exit"',
    return:
      'a "return" there ends a hook that dash, ksh or zsh runs, and can do so without a failure: it is neither given a status written as a number other than 0 nor the last part of "|| return"',
    trap: 'a "trap" there runs when the hook ends or a command fails, and what it runs can end the hook with success after a check has failed',
  };

/**
 * Say where lines added by hand are reached and heeded.
 * @param leave - The line that stands in the way, and what is on it
 * @returns The place, as the end of "Add these lines to it by hand ..."
 */
function placeFor(leave: EarlyLeave): string {
  if (leave.word === "unread") return `above line ${leave.line}`;
  return leave.word === "trap"
    ? "where they run before that trap is set"
    : "where they run before the hook can leave";
}

/**
 * Say that a line above the call can end the hook before the call runs, or
 * that the hook could not be read as far as the call.
 *
 * Every such reason ends the same way: the lines to add by hand, or, where
 * the hook already holds them, where to move them. Above the line named
 * they are reached and heeded whatever that line does, and a later run then
 * reads only what is above them.
 * @param hook - The hook file
 * @param leave - The line, and what is on it
 * @param present - Whether the file already holds the call
 * @returns The reason, ending with what a person does about it
 */
function unreachable(
  hook: ShellHook,
  leave: EarlyLeave,
  present: boolean
): string {
  const { begin, end } = carrierMarkers(hook.moment);
  const lines = present
    ? "the lines this command added there"
    : "lines added at its end";
  const left =
    leave.word === "unread"
      ? `${hook.shown} could not be read from line ${leave.line} on: either a quote, a here-document or a parenthesis that starts there is still open where the call goes, or the line is written in a way this command does not follow. So it cannot tell whether ${lines} would be run as commands of the hook itself, and they might never run. It was left as it is.`
      : `${hook.shown} can leave at line ${leave.line} before its end (${LEAVES[leave.word]}), so ${lines} might never run. It was left as it is.`;
  if (present) {
    return `${left} Move the lines from "${begin}" to "${end}", those two included, above line ${leave.line} by hand.`;
  }
  return `${left} Add these lines to it by hand ${placeFor(leave)}, the two marker lines included:\n${carrierCallBlock(hook.moment)}`;
}

/**
 * Say why git does not reach the call in an existing hook file, whether the
 * call is in it already or is about to be added.
 * @param hook - The hook file
 * @param state - What is in the file
 * @param lines - Its content, one item per line
 * @param marked - Where the call is in it, when it is
 * @returns The reason, or `null` when the call is reached
 */
function refusal(
  hook: ShellHook,
  state: FileState,
  lines: readonly string[],
  marked: MarkedBlock
): string | null {
  const text = lines.join("\n");
  if (isReplacedByLisa(text)) {
    return `${hook.shown} is replaced by Lisa on every update, so a line added to it would be lost. Nothing was added; this repository's project type has to call the gate runner itself.`;
  }
  const program = interpreter(text);
  if (program === null ? !hook.startedBySh : !SHELLS.includes(program)) {
    return `${hook.shown} is not a shell script, so the gate runner cannot be added after what it already does without changing it. It was left as it is. Start the existing program from a shell script, then run this again.`;
  }
  if (!state.executable && !hook.startedBySh) {
    return `${hook.shown} is not marked executable, so git does not run it. It was left as it is. Make it executable or remove it, then run this again.`;
  }
  const present = marked.problem === null && marked.found;
  const leave = earlyLeave(
    present ? lines.slice(0, marked.start).join("\n") : text
  );
  return leave === null ? null : unreachable(hook, leave, present);
}

/**
 * Plan the call in a hook file that is not there yet or already holds text.
 * @param hook - The hook file
 * @param state - What is in the file
 * @returns The plan
 */
function planCall(hook: ShellHook, state: FileState): ShellHookPlan {
  const { shown } = hook;
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
  const lines = text.split("\n");
  const refused =
    state.content === null
      ? null
      : refusal(hook, state, lines, findMarkedBlock(lines, hook.moment));
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
  const { shown } = hook;
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
  return planCall(hook, state);
}
