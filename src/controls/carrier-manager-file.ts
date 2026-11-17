/**
 * Adding the carriers through a hook manager's own configuration file.
 *
 * Lefthook and the pre-commit framework write git's hook files themselves,
 * from one committed configuration. A line added to a hook file would be
 * overwritten the next time the manager installs, so the carrier is declared
 * in the configuration instead, where the manager will keep running it and
 * where the change is visible in a committed file.
 *
 * Declaring it is half of it. The manager only runs what it declares in a
 * checkout where its own hook is installed, so the command looks at the hook
 * git would run and says so when the manager is not behind it.
 * @module controls/carrier-manager-file
 */
import path from "node:path";

import { fileEdit, fileState } from "./carrier-edits.js";
import { callsRunnerItself, isReplacedByLisa } from "./carrier-shell-hook.js";
import {
  CARRIER_HOOKS,
  CARRIER_MOMENTS,
  STACK_HOOK,
  type CarrierEdit,
  type CarrierMoment,
  type PointPlan,
} from "./carrier-types.js";
import type { ManagerFileEdit } from "./carrier-yaml-lines.js";

/** One hook manager and its configuration file. */
export interface ManagerFile {
  /** Real path of the repository. */
  readonly root: string;
  /** The configuration file, from the repository root. */
  readonly file: string;
  /** Which manager it is. */
  readonly through: "lefthook" | "pre-commit";
  /** The manager's name in a sentence. */
  readonly label: string;
  /** The folder git runs hooks from in this checkout. */
  readonly hooksFolder: string;
  /** Adds the carrier for one moment to the file's content. */
  readonly add: (text: string, moment: CarrierMoment) => ManagerFileEdit;
  /** Recognises the manager's own hook among git's hooks. */
  readonly ownHook: RegExp;
  /** The command that installs the manager's hooks in a checkout. */
  readonly install: string;
}

/** The plan for a manager's file. */
export interface ManagerFilePlan {
  readonly points: readonly PointPlan[];
  readonly edits: readonly CarrierEdit[];
}

/** The file's content so far, and the points planned from it. */
interface Progress {
  readonly text: string;
  readonly points: readonly PointPlan[];
}

/**
 * Say why the manager does not run its configuration at one hook here.
 * @param manager - The manager
 * @param moment - The moment
 * @returns The reason, or `null` when the manager's hook is installed
 */
async function notInstalled(
  manager: ManagerFile,
  moment: CarrierMoment
): Promise<string | null> {
  const hook = CARRIER_HOOKS[moment];
  const state = await fileState(path.join(manager.hooksFolder, hook));
  const installed =
    state.content !== null &&
    state.executable &&
    manager.ownHook.test(state.content.toString("utf8"));
  return installed
    ? null
    : `${manager.label} is not switched on for the ${hook} hook in this checkout, so nothing runs what ${manager.file} declares for it. Run "${manager.install}", then run this again.`;
}

/**
 * Plan one moment on top of the file's content so far.
 * @param manager - The manager
 * @param progress - The content and points so far
 * @param moment - The moment
 * @param original - The file's content before this run
 * @returns The content and points with this moment added
 */
async function planMoment(
  manager: ManagerFile,
  progress: Progress,
  moment: CarrierMoment,
  original: string
): Promise<Progress> {
  const point = (
    call: PointPlan["call"],
    blocked: string | null,
    through: PointPlan["through"] = manager.through
  ): PointPlan => ({ blocked, call, moment, path: manager.file, through });
  if (callsRunnerItself(original, moment)) {
    return {
      points: [...progress.points, point("present", null, STACK_HOOK)],
      text: progress.text,
    };
  }
  const added: ManagerFileEdit = isReplacedByLisa(original)
    ? {
        problem:
          "it is replaced by Lisa on every update, so an entry added to it would be lost; this repository's project type has to call the gate runner itself",
      }
    : manager.add(progress.text, moment);
  if (added.problem !== null) {
    return {
      points: [
        ...progress.points,
        point(
          "absent",
          `Nothing was added to ${manager.file} for the ${CARRIER_HOOKS[moment]} hook: ${added.problem}`
        ),
      ],
      text: progress.text,
    };
  }
  // One entry may carry both moments. The second moment then finds it in the
  // content so far, but what is reported is how the point stood before the
  // run, so it is asked of the file as it was.
  const before =
    added.state === "present" && progress.text !== original
      ? manager.add(original, moment)
      : added;
  return {
    points: [
      ...progress.points,
      point(
        before.problem === null ? before.state : "added",
        await notInstalled(manager, moment)
      ),
    ],
    text: added.text,
  };
}

/**
 * Plan the carriers in a hook manager's configuration file.
 * @param manager - The manager and its file
 * @returns What each point becomes and the write that makes it so
 */
export async function wireManagerFile(
  manager: ManagerFile
): Promise<ManagerFilePlan> {
  const absolute = path.join(manager.root, manager.file);
  const state = await fileState(absolute);
  const original = state.content?.toString("utf8") ?? "";
  const planned = await CARRIER_MOMENTS.reduce<Promise<Progress>>(
    async (progress, moment) =>
      planMoment(manager, await progress, moment, original),
    Promise.resolve({ points: [], text: original })
  );
  const edit =
    planned.text === original
      ? null
      : fileEdit(
          {
            absolute,
            content: planned.text,
            executable: false,
            path: manager.file,
          },
          state
        );
  return { edits: edit === null ? [] : [edit], points: planned.points };
}
