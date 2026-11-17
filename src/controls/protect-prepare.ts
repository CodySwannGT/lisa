/**
 * Everything `lisa controls protect` can know before it asks the hosting
 * platform anything: the register, the checks it derives, where the
 * repository is hosted, and the one door its requests will go through.
 *
 * None of this sends a request. A run whose register asks nothing of merge
 * protection, or whose repository is not on github.com, ends here without
 * ever reaching the platform.
 * @module controls/protect-prepare
 */
import {
  deriveRequiredChecks,
  droppedChecks,
  hasWorkflowFolder,
  type DerivedProtection,
} from "./protect-derive.js";
import { requirementOf, type Requirement } from "./protect-live.js";
import {
  loadProtectionModules,
  type GhRunner,
  type ProtectionModules,
} from "./protect-modules.js";
import { detectPlatform, readOriginUrl } from "./protect-platform.js";
import { recordRequests, type RequestLog } from "./protect-requests.js";
import { GITHUB_PLATFORM, type PlatformFacts } from "./protect-types.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "./register.js";

/** The command's options. */
export interface ProtectOptions {
  /** Allow a change to be sent. Off by default. */
  readonly apply?: boolean | undefined;
  /** The branch to protect; the repository's default branch when left out. */
  readonly branch?: string | undefined;
  /** The ruleset that should hold the checks, when there is a choice. */
  readonly ruleset?: string | undefined;
}

/** What the run needs from outside, each replaceable in a test. */
export interface ProtectDependencies {
  /** Sends one request to the platform. The real `gh` by default. */
  readonly gh?: GhRunner;
  /** Reads the address of the `origin` remote. */
  readonly readRemoteUrl?: (root: string) => Promise<string | null>;
  /** Generates the control register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Loads the shipped ruleset scripts. */
  readonly loadModules?: () => Promise<ProtectionModules>;
}

/** Everything known before the platform is asked anything. */
export interface Prepared {
  readonly root: string;
  readonly options: ProtectOptions;
  readonly modules: ProtectionModules;
  readonly derived: DerivedProtection;
  readonly requirement: Requirement;
  /** The repository's `policy` block, as the declaration reader returned it. */
  readonly policy: unknown;
  readonly platform: PlatformFacts;
  readonly log: RequestLog;
}

/** What was gathered, or one line per reason the run cannot go on. */
export type Preparation =
  | { readonly problems: null; readonly prepared: Prepared }
  | { readonly problems: readonly string[] };

/** A branch name that can be put in a request path and a sentence. */
const BRANCH_NAME = /^[\w.][\w./-]*$/u;

/**
 * Gather everything that can be known without asking the platform.
 * @param root - Real path of the repository
 * @param options - The command's options
 * @param dependencies - Replaceable collaborators
 * @returns What was gathered, or one line per problem
 */
export async function prepare(
  root: string,
  options: ProtectOptions,
  dependencies: ProtectDependencies
): Promise<Preparation> {
  if (options.branch !== undefined && !BRANCH_NAME.test(options.branch)) {
    return {
      problems: [
        `--branch takes a branch name such as main; "${options.branch}" is not one.`,
      ],
    };
  }
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) return { problems: generated.problems };
  const modules = await (dependencies.loadModules ?? loadProtectionModules)();
  const declaration = modules.gates.readGates(root);
  const platform = detectPlatform(
    await (dependencies.readRemoteUrl ?? readOriginUrl)(root),
    declaration.gates
  );
  const derived = deriveRequiredChecks({
    register: generated.register,
    gates: declaration.gates,
    modules,
    dropped: droppedChecks(declaration.config),
    canReportWorkflowChecks:
      platform.name === GITHUB_PLATFORM
        ? await hasWorkflowFolder(root)
        : undefined,
  });
  return {
    problems: null,
    prepared: {
      root,
      options,
      modules,
      derived,
      requirement: requirementOf(derived.checks, declaration.config, modules),
      policy: declaration.policy,
      platform,
      log: recordRequests(dependencies.gh ?? modules.reconcile.ghRunner),
    },
  };
}
