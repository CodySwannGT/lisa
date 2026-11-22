/**
 * Reconciling the control register against what is installed.
 *
 * A register records what a team believes it enforces. The distance between
 * that record and what actually runs is where controls quietly disappear: a
 * hook file is deleted, a clone is never wired, someone adds a check to a
 * hook and tells nobody. This measures the distance in both directions and
 * changes nothing.
 *
 * - **Direction one** (`./reconcile-points.ts`): for every enforcement point
 *   the register claims, is something real there that runs the gate runner?
 * - **Direction two** (`./reconcile-hooks.ts`, `./reconcile-agent-hooks.ts`):
 *   for each command found in a Git or edit-time hook, does the register
 *   declare it at that moment?
 *
 * ## What is read
 *
 * The register is the one the declaration generates, the same register
 * every other control command works from; whether the committed file still
 * matches it is reported beside the result. The carriers are read through
 * `installCarriers` in check mode, with the agents named in the carrier record.
 * The hooks are read as text. The hosting platform is read only when the run asks for it, so a
 * plain run never leaves the machine.
 *
 * ## What comes back
 *
 * One result (`./reconcile-types.ts`), the same for the same inputs: no
 * clock, no random order. Findings are listed and are not a failure. The
 * only failures are surfaces that were needed and could not be read: the
 * register or the checkout's hooks (no result at all), or one hook file or
 * the platform (a result marked `incomplete` that says which).
 * @module controls/reconcile
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { AGENT_CARRIER_PATH } from "./carrier-agent-script.js";
import { AGENT_SURFACES } from "./carrier-agent-surfaces.js";
import { createCarrierGit, type CarrierGit } from "./carrier-git.js";
import { detectHookOwner } from "./carrier-owner.js";
import { readRecordedFiles } from "./carrier-owned-files.js";
import type { CarrierResult } from "./carrier-types.js";
import { installCarriers, type CarrierRun } from "./carriers.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
  type InScopeCriterion,
} from "./catalogue.js";
import type { CodingAgent } from "./coding-agents.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import type { MergeProtectionDependencies } from "./merge-protection-read.js";
import { readEditTimeHooks } from "./reconcile-agent-hooks.js";
import { auditFindings } from "./reconcile-audit-findings.js";
import { commandFindings, pointFindings } from "./reconcile-findings.js";
import { readHookCommands } from "./reconcile-hooks.js";
import {
  needsPlatform,
  readPlatform,
  type PlatformRead,
} from "./reconcile-platform.js";
import { reconcilePoints } from "./reconcile-points.js";
import { describeReconcile, surfacesOf } from "./reconcile-result.js";
import {
  RECONCILE_LIMITS,
  RECONCILE_SCHEMA_VERSION,
  type CommittedRegister,
  type ReconcileResult,
} from "./reconcile-types.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "./register.js";
import { CONTROL_REGISTER_PATH } from "./register-types.js";

/** The command's options. */
export interface ReconcileOptions {
  /** Also ask the hosting platform which checks it requires before a merge. */
  readonly platform?: boolean | undefined;
}

/** What a run needs from outside, each replaceable in a test. */
export interface ReconcileDependencies {
  /** Git. */
  readonly git?: CarrierGit;
  /** Generates the control register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Runs the carrier check of a checkout, writing nothing. */
  readonly checkCarriers?: (
    root: string,
    git: CarrierGit
  ) => Promise<CarrierRun>;
  /** The collaborators of the read of the hosting platform. */
  readonly platform?: MergeProtectionDependencies;
  /** The in-scope requirements, in catalogue order. */
  readonly criteria?: () => readonly InScopeCriterion[];
}

/** The result of a run, or why there is none. */
export type ReconcileRun =
  | { readonly problems: null; readonly result: ReconcileResult }
  | { readonly problems: readonly string[] };

/**
 * Read a file's text.
 * @param file - The file
 * @returns The text, or `null` when it cannot be read
 */
async function textOf(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Say why something could not be done, from whatever was thrown.
 * @param error - What was thrown
 * @returns The message
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the carrier check of a checkout.
 * @param root - Real path of the repository
 * @param git - Git
 * @param agents - Agents with recorded edit-time registrations
 * @param dependencies - Replaceable collaborators
 * @returns The check's result, or why there is none
 */
async function carrierCheck(
  root: string,
  git: CarrierGit,
  agents: readonly CodingAgent[],
  dependencies: ReconcileDependencies
): Promise<CarrierRun> {
  try {
    return await (
      dependencies.checkCarriers ??
      ((repository, using) =>
        installCarriers(
          repository,
          {
            check: true,
            ...(agents.length === 0
              ? {}
              : { agents: { from: "named", names: agents } }),
          },
          { git: using }
        ))
    )(root, git);
  } catch (error) {
    return { problems: [messageOf(error)] };
  }
}

/**
 * Read the hosting platform when the run asks for it and something in the
 * register depends on it.
 * @param root - Real path of the repository
 * @param generated - The generated register
 * @param options - The command's options
 * @param dependencies - Replaceable collaborators
 * @returns What became of the read
 */
async function platformRead(
  root: string,
  generated: Extract<ControlRegisterGeneration, { problems: null }>,
  options: ReconcileOptions,
  dependencies: ReconcileDependencies
): Promise<PlatformRead> {
  if (options.platform !== true || !needsPlatform(generated.register)) {
    return { asked: false };
  }
  try {
    return await readPlatform(root, generated.register, dependencies.platform);
  } catch (error) {
    return { answer: null, asked: true, detail: messageOf(error) };
  }
}

/**
 * Say whether the committed register is what the declaration generates.
 * @param committed - The committed file's text, or `null`
 * @param generated - The text the declaration generates
 * @returns `absent`, `current` or `stale`
 */
function committedState(
  committed: string | null,
  generated: string
): CommittedRegister {
  if (committed === null) return "absent";
  return committed === generated ? "current" : "stale";
}

/** Everything a comparison works from, once both sides could be read. */
interface Compared {
  readonly root: string;
  readonly git: CarrierGit;
  /** The register the declaration generates. */
  readonly generated: Extract<ControlRegisterGeneration, { problems: null }>;
  /** The result of the carrier check of this checkout. */
  readonly carriers: CarrierResult;
  readonly agentCarrier: boolean;
  readonly agents: readonly CodingAgent[];
  readonly options: ReconcileOptions;
  readonly dependencies: ReconcileDependencies;
}

/**
 * Compare a register with what is installed, in both directions.
 * @param compared - The register, the carrier check and the run's settings
 * @returns The result
 */
async function compare(compared: Compared): Promise<ReconcileResult> {
  const { dependencies, generated, git, root } = compared;
  const { register } = generated;
  const [facts, platform, committed, declaration, editTime] = await Promise.all(
    [
      detectHookOwner(root, git),
      platformRead(root, generated, compared.options, dependencies),
      textOf(path.join(root, CONTROL_REGISTER_PATH)),
      textOf(path.join(root, GATES_DECLARATION_PATH)),
      readEditTimeHooks(root, compared.agentCarrier, compared.agents, register),
    ]
  );
  const [points, gitHooks] = await Promise.all([
    reconcilePoints(register, {
      agentCarrier: compared.agentCarrier,
      carriers: compared.carriers,
      platform,
      read: shown =>
        textOf(path.isAbsolute(shown) ? shown : path.join(root, shown)),
      root,
      registrations: editTime.registrations,
    }),
    readHookCommands(root, facts, register),
  ]);
  const hooks = {
    commands: [...gitHooks.commands, ...editTime.commands],
    files: [...gitHooks.files, ...editTime.files],
    problems: [...gitHooks.problems, ...editTime.problems],
  };
  const findings = [
    ...pointFindings(register, points),
    ...commandFindings(hooks.commands),
  ];
  const state = committedState(committed, generated.text);
  const surfaces = surfacesOf({
    committed: state,
    hooks,
    needsPlatform: needsPlatform(register),
    platform,
  });
  return {
    schema_version: RECONCILE_SCHEMA_VERSION,
    ...describeReconcile(points, findings, surfaces),
    register: {
      committed: state,
      entries: register.entries.length,
      path: CONTROL_REGISTER_PATH,
    },
    hook_owner: facts.owner,
    surfaces,
    enforcement_points: points,
    hook_commands: hooks.commands,
    findings,
    audit_findings: auditFindings({
      criteria: (
        dependencies.criteria ??
        (() => inScopeCriteria(loadCriterionCatalogue()))
      )(),
      findings,
      points,
      register,
      sources: { declaration, register: committed },
    }),
    limits: RECONCILE_LIMITS,
  };
}

/**
 * Reconcile the control register of a repository against what is installed
 * in this checkout. Nothing is written and nothing that is found is run.
 * @param root - Real path of the repository
 * @param options - Whether to read the hosting platform as well
 * @param dependencies - Replaceable collaborators
 * @returns The result, or one line per reason no result could be produced
 */
export async function reconcileRepository(
  root: string,
  options: ReconcileOptions = {},
  dependencies: ReconcileDependencies = {}
): Promise<ReconcileRun> {
  const git = dependencies.git ?? createCarrierGit();
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) {
    return {
      problems: [
        `The control register could not be read from ${GATES_DECLARATION_PATH}, so there is nothing to compare what is installed with.`,
        ...generated.problems,
      ],
    };
  }
  const record = await readRecordedFiles(root);
  if (record.problem !== null) return { problems: [record.problem] };
  const agentCarrier = record.files.includes(AGENT_CARRIER_PATH);
  const agents = agentCarrier
    ? record.agents.filter(agent => AGENT_SURFACES[agent].refuses)
    : [];
  const carriers = await carrierCheck(root, git, agents, dependencies);
  if (carriers.problems !== null) {
    return {
      problems: [
        "The git hooks of this checkout could not be read, so what is installed is not known.",
        ...carriers.problems,
      ],
    };
  }
  return {
    problems: null,
    result: await compare({
      agentCarrier,
      agents,
      carriers: carriers.result,
      dependencies,
      generated,
      git,
      options,
      root,
    }),
  };
}
