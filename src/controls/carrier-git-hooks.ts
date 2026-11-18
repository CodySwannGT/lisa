/**
 * Planning the commit and push carriers: git hooks, added through whoever
 * owns hooks in the repository.
 *
 * Each owner gets the call in its own way, so the owner keeps working and
 * keeps running what it ran before:
 *
 * - Husky, a folder named by `core.hooksPath`, and git's own hooks folder:
 *   a few marked lines at the end of the owner's hook file.
 * - Lefthook and the pre-commit framework: an entry in the manager's
 *   committed configuration.
 * - Nothing: Lisa's own hook folder becomes the hooks folder, by setting
 *   `core.hooksPath` in this checkout. That setting is not committed, so
 *   every other checkout has to run the command once as well.
 *
 * The owner also decides whether the push carrier can tell the runner what
 * is being pushed, because only some owners hand it everything git wrote on
 * the hook's standard input:
 *
 * | Who starts the push carrier | Standard input it gets | The runner is told |
 * | --- | --- | --- |
 * | git itself (`core.hooksPath` is Lisa's folder) | everything git wrote | what is pushed |
 * | Lefthook, with `use_stdin` | everything git wrote | what is pushed |
 * | lines after a hook's own content (Husky, a hooks folder, git's own) | none: what is above may have read some | nothing, so every part runs |
 * | the pre-commit framework | none: the framework hands a hook an empty one | nothing it can use, so every part runs |
 * @module controls/carrier-git-hooks
 */
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import { HOOKS_PATH_SETTING, type CarrierGit } from "./carrier-git.js";
import { lefthookWith } from "./carrier-lefthook.js";
import { wireManagerFile } from "./carrier-manager-file.js";
import {
  detectHookOwner,
  HUSKY_FOLDER,
  isWithin,
  type HookFacts,
} from "./carrier-owner.js";
import { preCommitWith } from "./carrier-pre-commit.js";
import {
  carrierCallLine,
  carrierScript,
  carrierScriptPath,
} from "./carrier-script.js";
import { wireShellHook, type ShellHook } from "./carrier-shell-hook.js";
import {
  CARRIER_HOOKS,
  CARRIER_HOOKS_FOLDER,
  CARRIER_MOMENTS,
  type CarrierEdit,
  type CarrierMoment,
  type KindPlan,
  type PlacedFile,
  type PointPlan,
} from "./carrier-types.js";

/** The file Husky 9 starts every hook through. Earlier versions have none. */
const HUSKY_STARTER = `${HUSKY_FOLDER}/_/h`;

/** The points of a plan and the writes behind them. */
interface Wiring {
  readonly points: readonly PointPlan[];
  readonly edits: readonly CarrierEdit[];
}

/**
 * The carrier scripts, as files to place.
 * @returns One script per moment
 */
function carrierScripts(): readonly PlacedFile[] {
  return CARRIER_MOMENTS.map(moment => ({
    content: carrierScript(moment),
    executable: true,
    path: carrierScriptPath(moment),
  }));
}

/**
 * Plan every moment the same way, with no write.
 * @param owner - Who owns the hooks
 * @param call - How the call stands
 * @param blocked - Why the points are blocked, or `null`
 * @param pathOf - The file or setting that holds each call
 * @returns One point per moment
 */
function everyMoment(
  owner: PointPlan["through"],
  call: PointPlan["call"],
  blocked: string | null,
  pathOf: (moment: CarrierMoment) => string
): readonly PointPlan[] {
  return CARRIER_MOMENTS.map(moment => ({
    blocked,
    call,
    moment,
    path: pathOf(moment),
    through: owner,
  }));
}

/**
 * Plan the call in one shell hook file per moment.
 * @param hookFor - The hook file of each moment
 * @returns The points and the writes
 */
async function shellHooks(
  hookFor: (moment: CarrierMoment) => ShellHook
): Promise<Wiring> {
  const plans = await Promise.all(
    CARRIER_MOMENTS.map(moment => wireShellHook(hookFor(moment)))
  );
  return {
    edits: plans.flatMap(plan => plan.edits),
    points: plans.map(plan => plan.point),
  };
}

/**
 * Plan the calls where Husky owns the hooks.
 * @param root - Real path of the repository
 * @param facts - What was found out about hooks
 * @returns The points and the writes
 */
async function throughHusky(root: string, facts: HookFacts): Promise<Wiring> {
  const startedBySh =
    (await pathKind(path.join(root, HUSKY_STARTER))) === "file";
  return shellHooks(moment => ({
    file: path.join(root, HUSKY_FOLDER, CARRIER_HOOKS[moment]),
    moment,
    notSwitchedOn: facts.hooksPathSet
      ? null
      : `Husky is not switched on in this checkout (${HOOKS_PATH_SETTING} is not set), so git does not run ${HUSKY_FOLDER}/${CARRIER_HOOKS[moment]} here. Install the project's dependencies so that Husky's own setup runs, then run this again.`,
    root,
    startedBySh,
    through: "husky",
  }));
}

/**
 * Plan the calls in a hooks folder that holds one script per hook.
 * @param root - Real path of the repository
 * @param facts - What was found out about hooks
 * @param owner - Whether the folder is the repository's own or git's
 * @returns The points and the writes
 */
async function throughHooksFolder(
  root: string,
  facts: HookFacts,
  owner: "hooks-path" | "git-hooks"
): Promise<Wiring> {
  const hookFile = (moment: CarrierMoment): string =>
    path.join(facts.hooksFolder, CARRIER_HOOKS[moment]);
  if (owner === "hooks-path" && !isWithin(root, facts.hooksFolder)) {
    return {
      edits: [],
      points: CARRIER_MOMENTS.map(moment => ({
        blocked: `Git runs this repository's hooks from ${facts.hooksFolder}, which is outside the repository (${HOOKS_PATH_SETTING}), and this command writes nothing outside it. Add this line to ${hookFile(moment)} by hand, after the existing checks: ${carrierCallLine(moment)}`,
        call: "absent",
        moment,
        path: hookFile(moment),
        through: owner,
      })),
    };
  }
  return shellHooks(moment => ({
    file: hookFile(moment),
    moment,
    notSwitchedOn: null,
    root,
    startedBySh: false,
    through: owner,
  }));
}

/**
 * Plan the calls through a hook manager's configuration file.
 * @param root - Real path of the repository
 * @param facts - What was found out about hooks
 * @param file - The manager's configuration file
 * @returns The points and the writes
 */
function throughManager(
  root: string,
  facts: HookFacts,
  file: string
): Promise<Wiring> {
  return facts.owner === "lefthook"
    ? wireManagerFile({
        add: lefthookWith,
        file,
        hooksFolder: facts.hooksFolder,
        install: "lefthook install",
        label: "Lefthook",
        ownHook: /lefthook/iu,
        root,
        through: "lefthook",
      })
    : wireManagerFile({
        add: preCommitWith,
        file,
        hooksFolder: facts.hooksFolder,
        install:
          "pre-commit install --hook-type pre-commit --hook-type pre-push",
        label: "The pre-commit framework",
        ownHook: /pre[-_]commit/iu,
        root,
        through: "pre-commit",
      });
}

/**
 * Plan the calls for whoever owns the hooks.
 * @param root - Real path of the repository
 * @param facts - What was found out about hooks
 * @returns The points and the writes
 */
function wiringFor(root: string, facts: HookFacts): Promise<Wiring> {
  const setting = (): string => HOOKS_PATH_SETTING;
  if (facts.owner === "husky") return throughHusky(root, facts);
  if (facts.owner === "hooks-path" || facts.owner === "git-hooks") {
    return throughHooksFolder(root, facts, facts.owner);
  }
  if (facts.managerFile !== null) {
    return throughManager(root, facts, facts.managerFile);
  }
  return Promise.resolve(
    facts.owner === "lisa"
      ? { edits: [], points: everyMoment("lisa", "present", null, setting) }
      : {
          edits: [
            {
              action: "set",
              kind: "setting",
              path: HOOKS_PATH_SETTING,
              value: CARRIER_HOOKS_FOLDER,
            },
          ],
          points: everyMoment("none", "added", null, setting),
        }
  );
}

/**
 * Plan the commit and push carriers of one repository.
 * @param root - Real path of the repository
 * @param git - Git
 * @returns Who owns the hooks, what each point becomes, and the writes
 */
export async function planGitHookCarriers(
  root: string,
  git: CarrierGit
): Promise<KindPlan> {
  const facts = await detectHookOwner(root, git);
  const wiring = await wiringFor(root, facts);
  return {
    ...wiring,
    kind: "git-hook",
    owner: facts.owner,
    scripts: carrierScripts(),
  };
}
