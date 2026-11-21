/**
 * Installing the carriers that call the gate runner, in any repository.
 *
 * A declared check only governs a repository when something runs it. On a
 * supported project type the stack's hooks do. Everywhere else nothing does,
 * so this is the step that makes git run the gate runner at commit and at
 * push, through whoever already owns the repository's hooks. Asked to, it
 * also makes each coding agent run it after the agent writes a file, through
 * the hook settings that agent reads from the repository.
 *
 * ## What a run does
 *
 * It plans everything first and writes afterwards, in this order: the gate
 * runner under `scripts/`, Lisa's hook scripts, the record of those files,
 * the ignore entry for the runner's push timings, and last the call that
 * makes git, or an agent, start a hook. `--check` stops after the plan. A
 * second run plans nothing, so it writes nothing.
 *
 * It never replaces a file it did not write. When one is in the way of the
 * runner or of a hook script, nothing at all is written: a hook that called
 * a runner that is not there would stop every commit.
 *
 * A file the run has no permission to change is found while planning, and
 * is a blocked point like any other, so the writes that are made are ones
 * that can be. If a write fails all the same, the run gives no result and
 * says which writes it had already made; it does not undo them.
 *
 * ## Adding a kind of carrier
 *
 * {@link CARRIER_PLANNERS} lists what is planned. A new kind is one more
 * planner that returns its own points, scripts and writes; the runner, the
 * record and the result are shared.
 * @module controls/carriers
 */
import path from "node:path";

import {
  applyCarrierEdits,
  blockedFolder,
  fileEdit,
  fileState,
  isWritable,
  notWritable,
} from "./carrier-edits.js";
import { AGENT_PLACED_PATHS, planAgentCarriers } from "./carrier-agents.js";
import { credentialProblemIn, withoutCredentials } from "./secret-scan-json.js";
import { createCarrierGit, type CarrierGit } from "./carrier-git.js";
import { planGitHookCarriers } from "./carrier-git-hooks.js";
import { planIgnore } from "./carrier-ignore.js";
import {
  carrierRecordText,
  EACH_CHECKOUT,
  planOwnedFiles,
  readRecordedFiles,
} from "./carrier-owned-files.js";
import { describeCarrierRun } from "./carrier-result.js";
import { runnerFiles } from "./carrier-runner-files.js";
import { resolveRoster, type AgentSelection } from "./carrier-roster.js";
import {
  CARRIER_RECORD_PATH,
  CARRIER_RUNNER_PATH,
  CARRIER_SCHEMA_VERSION,
  NO_HOOK_SURFACE,
  STACK_HOOK,
  type CarrierEdit,
  type CarrierResult,
  type FileEdit,
  type KindPlan,
  type PlacedFile,
} from "./carrier-types.js";
import type { CodingAgent } from "./coding-agents.js";

/** What a planner is told about the run beyond the repository. */
interface CarrierPlanContext {
  /** The coding agents the run carries; empty when it carries none. */
  readonly agents: readonly CodingAgent[];
}

/**
 * Plans every point of one kind of carrier, or answers `null` when the run
 * has no point of that kind.
 */
type CarrierPlanner = (
  root: string,
  git: CarrierGit,
  context: CarrierPlanContext
) => Promise<KindPlan | null>;

/**
 * Plan the edit-time carriers of the coding agents a run carries.
 * @param root - Real path of the repository
 * @param _git - Not used: an agent's hook is not a hook of the repository's
 * @param context - What the run carries
 * @returns The plan, or `null` for a run that carries no agent
 */
function planAgentHookCarriers(
  root: string,
  _git: CarrierGit,
  context: CarrierPlanContext
): Promise<KindPlan | null> {
  return context.agents.length === 0
    ? Promise.resolve(null)
    : planAgentCarriers(root, context.agents);
}

/** Every kind of carrier a run plans, in the order the result lists them. */
const CARRIER_PLANNERS: readonly CarrierPlanner[] = [
  planGitHookCarriers,
  planAgentHookCarriers,
];

/** The command's options. */
export interface InstallCarriersOptions {
  /** Write nothing: report what a run would write. */
  readonly check?: boolean;
  /**
   * Also carry the edit-time moment for coding agents: the ones the
   * repository's `harness` setting names, or the ones named here. Left out,
   * the run carries commit and push only, exactly as it always did.
   */
  readonly agents?: AgentSelection;
}

/** What a run needs from outside, each replaceable in a test. */
export interface CarrierDependencies {
  /** Git. */
  readonly git?: CarrierGit;
  /** Reads the runner and its files from the Lisa package. */
  readonly runnerFiles?: () => Promise<readonly PlacedFile[]>;
}

/** The result of a run, or why there is none. */
export type CarrierRun =
  | { readonly problems: null; readonly result: CarrierResult }
  | {
      readonly problems: readonly string[];
      /**
       * What the run had already written when it stopped, as each is named
       * in a result. Left off, or empty, when it stopped before any write.
       */
      readonly written?: readonly string[];
    };

/** The writes for what the carriers share, or why nothing may be written. */
type SharedPlan =
  | { readonly problem: null; readonly edits: readonly FileEdit[] }
  | { readonly problem: string };

/**
 * Plan the record of what a run places.
 * @param root - Real path of the repository
 * @param files - Every file the run places, from the repository root
 * @returns The write, that none is needed, or what is in the way
 */
async function planRecord(
  root: string,
  files: readonly string[]
): Promise<SharedPlan> {
  const folder = await blockedFolder(root, CARRIER_RECORD_PATH);
  if (folder !== null) {
    return {
      problem: `${folder} is not an ordinary folder (it may be a link), so nothing in it was read or written. Replace it with an ordinary folder, then run this again.`,
    };
  }
  const absolute = path.join(root, CARRIER_RECORD_PATH);
  const content = carrierRecordText(files);
  const problem = credentialProblemIn(CARRIER_RECORD_PATH, content);
  if (problem !== null) return { problem };
  const edit = fileEdit(
    {
      absolute,
      content,
      executable: false,
      path: CARRIER_RECORD_PATH,
    },
    await fileState(absolute)
  );
  return { edits: edit === null ? [] : [edit], problem: null };
}

/**
 * Plan everything the carriers share: the runner, the carrier scripts, the
 * record of both, and the ignore entry.
 * @param root - Real path of the repository
 * @param git - Git
 * @param files - The runner's files and the carrier scripts
 * @returns The writes in order, or one sentence saying why nothing may be
 *   written
 */
async function planShared(
  root: string,
  git: CarrierGit,
  files: readonly PlacedFile[]
): Promise<SharedPlan> {
  const recorded = await readRecordedFiles(root);
  if (recorded.problem !== null) return recorded;
  const placed = files.map(file => file.path);
  // A run that carries fewer agents than an earlier one, or none, leaves the
  // earlier one's files where they are and still being started. They stay in
  // the record, so a later run can still tell them from the repository's own.
  const kept = recorded.files.filter(
    file => AGENT_PLACED_PATHS.includes(file) && !placed.includes(file)
  );
  const [owned, record, ignore] = await Promise.all([
    planOwnedFiles(root, files, recorded.files),
    planRecord(root, [...placed, ...kept]),
    planIgnore(root, git),
  ]);
  if (owned.problem !== null) return owned;
  if (record.problem !== null) return record;
  if (ignore.problem !== null) return ignore;
  const edits = [
    ...owned.edits,
    ...record.edits,
    ...(ignore.edit === null ? [] : [ignore.edit]),
  ];
  const [readOnly] = await unwritable(edits);
  return readOnly === undefined
    ? { edits, problem: null }
    : {
        problem: `${notWritable(readOnly)}, and every carrier needs it, so nothing was written. Make it writable, then run this again.`,
      };
}

/**
 * Find the files among some writes that this user may not change.
 * @param edits - The writes
 * @returns The files, as they are named to a person, in order
 */
async function unwritable(
  edits: readonly CarrierEdit[]
): Promise<readonly string[]> {
  const files = edits.flatMap(edit => (edit.kind === "file" ? [edit] : []));
  const writable = await Promise.all(
    files.map(file => isWritable(file.absolute))
  );
  return files.flatMap((file, index) =>
    writable[index] === true ? [] : [file.path]
  );
}

/**
 * Take out of a plan every write this user may not make, and block the
 * points that needed it.
 *
 * Found here, a read-only hook file is one blocked point with a sentence,
 * and the rest of the run goes ahead. Found while writing, it would stop the
 * run halfway.
 * @param plan - The plan of one kind of carrier
 * @returns The plan with only writes that can be made
 */
async function withoutUnwritable(plan: KindPlan): Promise<KindPlan> {
  const readOnly = new Set(await unwritable(plan.edits));
  if (readOnly.size === 0) return plan;
  return {
    ...plan,
    edits: plan.edits.filter(edit => !readOnly.has(edit.path)),
    points: plan.points.map(point =>
      point.path !== null &&
      readOnly.has(point.path) &&
      point.call !== "present"
        ? {
            ...point,
            blocked:
              point.blocked ??
              `${notWritable(point.path)}, so it was left as it is. Make it writable, then run this again.`,
            call: "absent",
          }
        : point
    ),
  };
}

/**
 * The carrier scripts of every plan in which something calls one.
 * @param plans - The plan of every kind of carrier
 * @returns The scripts to place; none when every point is blocked before
 *   anything is written, or is already carried by a project type's own hook
 */
function calledScripts(plans: readonly KindPlan[]): readonly PlacedFile[] {
  return plans.flatMap(plan =>
    plan.points.some(
      point =>
        point.through !== STACK_HOOK &&
        // An agent with no hook starts nothing: its plan is a note in the
        // gates declaration, which needs neither a script nor the runner.
        point.through !== NO_HOOK_SURFACE &&
        point.call !== "absent"
    )
      ? plan.scripts
      : []
  );
}

/**
 * Make the writes of a run, unless it only checks.
 * @param root - Real path of the repository
 * @param edits - The writes, in order
 * @param git - Git, for a setting
 * @param check - Whether nothing may be written
 * @returns `null` when every write was made or none was asked for; when one
 *   failed, the run that has no result, with what it had already written
 */
async function madeWrites(
  root: string,
  edits: readonly CarrierEdit[],
  git: CarrierGit,
  check: boolean
): Promise<CarrierRun | null> {
  if (check) return null;
  const applied = await applyCarrierEdits(root, edits, git);
  return applied.failed === null
    ? null
    : {
        problems: [applied.failed.why],
        written: applied.written.map(edit => edit.path),
      };
}

/**
 * Install the carriers of one repository, or under `check` say what a run
 * would write.
 * @param root - Real path of the repository
 * @param options - Whether to check instead of write
 * @param dependencies - Replaceable collaborators
 * @returns The result, or why none could be produced
 */
export async function installCarriers(
  root: string,
  options: InstallCarriersOptions = {},
  dependencies: CarrierDependencies = {}
): Promise<CarrierRun> {
  const git = dependencies.git ?? createCarrierGit();
  if ((await git.topLevel(root)) !== root) {
    return {
      problems: [
        `${root} is not the top folder of a git repository. Carriers are git hooks, so give the top folder of the repository to install them in.`,
      ],
    };
  }
  const read =
    options.agents === undefined
      ? null
      : await resolveRoster(root, options.agents);
  if (read !== null && read.problems !== null) {
    return { problems: read.problems };
  }
  const roster = read === null ? null : read.roster;
  const planned = await Promise.all(
    CARRIER_PLANNERS.map(planner =>
      planner(root, git, { agents: roster?.agents ?? [] })
    )
  );
  const plans = await Promise.all(
    planned.flatMap(plan => (plan === null ? [] : [withoutUnwritable(plan)]))
  );
  const scripts = calledScripts(plans);
  const runner =
    scripts.length === 0
      ? []
      : await (dependencies.runnerFiles ?? runnerFiles)();
  const shared: SharedPlan =
    scripts.length === 0
      ? { edits: [], problem: null }
      : await planShared(root, git, [...runner, ...scripts]);
  const edits =
    shared.problem === null
      ? [...shared.edits, ...plans.flatMap(plan => plan.edits)]
      : [];
  const failed = await madeWrites(root, edits, git, options.check === true);
  if (failed !== null) return failed;
  const described = describeCarrierRun({
    check: options.check === true,
    edits,
    plans,
    runnerFiles: runner.map(file => file.path),
    runnerNeeded: scripts.length > 0,
    scripts: scripts.map(file => file.path),
    stopped: shared.problem,
  });
  return {
    problems: null,
    result: {
      schema_version: CARRIER_SCHEMA_VERSION,
      ...described,
      runner: {
        files: withoutCredentials(runner.map(file => file.path)),
        path: CARRIER_RUNNER_PATH,
        ...described.runner,
      },
      record: CARRIER_RECORD_PATH,
      each_checkout: EACH_CHECKOUT,
      ...(roster === null ? {} : { roster }),
    },
  };
}
