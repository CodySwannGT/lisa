/** Explicit standards-proof capture orchestration. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectType } from "../core/config.js";
import { getPackageVersion } from "../cli/version.js";
import { readConfinedDetectedStacks } from "../cli/ui-detected-stacks.js";
import { readConfinedMergedConfig } from "../cli/ui-confined-project-read.js";
import {
  STANDARDS_PROOF_ARTIFACT,
  type StandardsProof,
  type StandardsProofResult,
} from "./contract.js";
import {
  readStandardsGitState,
  requireStandardsBaseCommit,
  type StandardsGitState,
} from "./git-state.js";
import {
  resolveStandardsCheckPlan,
  type StandardsCheckPlan,
  type StandardsCheckSpec,
} from "./registry.js";
import { writeStandardsProof } from "./storage.js";
import { hasPositiveTestEvidence } from "./test-evidence.js";

const execFileAsync = promisify(execFile);
const MAX_CHECK_OUTPUT_BYTES = 1024 * 1024;

/** Bounded result from one standards command invocation. */
export interface StandardsCommandOutcome {
  readonly exitCode: number;
  readonly output: string;
}

/** Injectable boundaries for focused capture verification. */
export interface StandardsCaptureDependencies {
  readonly readGitState: typeof readStandardsGitState;
  readonly requireBaseCommit: typeof requireStandardsBaseCommit;
  readonly readProjectTypes: (root: string) => Promise<readonly ProjectType[]>;
  readonly readConfig: typeof readConfinedMergedConfig;
  readonly resolvePlan: typeof resolveStandardsCheckPlan;
  readonly runCommand: (
    root: string,
    check: StandardsCheckSpec
  ) => Promise<StandardsCommandOutcome>;
  readonly writeProof: typeof writeStandardsProof;
  readonly lisaVersion: () => string;
  readonly now: () => Date;
  readonly onProgress: (message: string) => void;
}

const DEFAULT_DEPENDENCIES: StandardsCaptureDependencies = {
  readGitState: readStandardsGitState,
  requireBaseCommit: requireStandardsBaseCommit,
  readProjectTypes: readConfinedDetectedStacks,
  readConfig: readConfinedMergedConfig,
  resolvePlan: resolveStandardsCheckPlan,
  runCommand: runStandardsCommand,
  writeProof: writeStandardsProof,
  lisaVersion: getPackageVersion,
  now: () => new Date(),
  onProgress: message => process.stdout.write(`${message}\n`),
};

/**
 * Run every current applicable check and publish proof only after all pass and
 * every bound input remains unchanged. This establishes automated standards
 * conformance; it does not claim empirical product verification.
 * @param projectRoot - Supported project repository
 * @param dependencies - Injectable process boundaries
 * @returns Strict proof written for the unchanged artifact
 */
export async function captureStandardsProof(
  projectRoot: string,
  dependencies: Partial<StandardsCaptureDependencies> = {}
): Promise<StandardsProof> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const before = await observeBoundInputs(projectRoot, deps);
  if (!before.git.clean) {
    throw new Error(
      "Standards proof requires a clean tracked, staged, submodule, and nonignored worktree."
    );
  }
  await deps.requireBaseCommit(before.git.root);
  const results: StandardsProofResult[] = [];
  for (const check of before.plan.checks) {
    deps.onProgress(`standards-proof: running ${check.id}`);
    const startedAt = deps.now().toISOString();
    const outcome = await deps.runCommand(before.git.root, check);
    const completedAt = deps.now().toISOString();
    if (outcome.exitCode !== 0) {
      throw new Error(`Standards check failed: ${check.id}.`);
    }
    if (
      check.testEvidence !== undefined &&
      !hasPositiveTestEvidence(check.testEvidence, outcome.output)
    ) {
      throw new Error(
        `Standards check did not prove any executed tests: ${check.id}.`
      );
    }
    // eslint-disable-next-line functional/immutable-data -- bounded ordered check ledger is private until validation and atomic publication
    results.push(
      Object.freeze({
        check: check.id,
        category: check.category,
        status: "pass",
        startedAt,
        completedAt,
      })
    );
  }
  const after = await observeBoundInputs(before.git.root, deps);
  assertUnchanged(before, after);
  // eslint-disable-next-line code-organization/enforce-statement-order -- capture time must be read only after unchanged-input validation
  const capturedAt = deps.now().toISOString();
  // eslint-disable-next-line code-organization/enforce-statement-order -- immutable proof assembly intentionally follows unchanged-input validation
  const proof = {
    schemaVersion: 1,
    artifact: STANDARDS_PROOF_ARTIFACT,
    lisaVersion: deps.lisaVersion(),
    registryDigest: before.plan.registryDigest,
    configDigest: before.plan.configDigest,
    repository: {
      identity: before.git.identity,
      head: before.git.head,
      tree: before.git.tree,
    },
    projectTypes: before.projectTypes,
    applicableChecks: before.plan.checks.map(check => check.id),
    capturedAt,
    results,
  } as const;
  return (await deps.writeProof(before.git.root, proof, deps.now())).proof;
}

/** Stack, configuration, registry, and Git inputs bound into one proof. */
type BoundInputs = Readonly<{
  git: StandardsGitState;
  projectTypes: readonly ProjectType[];
  plan: StandardsCheckPlan;
}>;

/**
 * Capture the exact stack/config/registry/git state around command execution.
 * @param projectRoot - Supported project repository
 * @param deps - Injectable process boundaries
 * @returns Current proof-bound inputs
 */
async function observeBoundInputs(
  projectRoot: string,
  deps: StandardsCaptureDependencies
): Promise<BoundInputs> {
  const git = await deps.readGitState(projectRoot);
  const [projectTypes, config] = await Promise.all([
    deps.readProjectTypes(git.root),
    deps.readConfig(git.root),
  ]);
  const plan = await deps.resolvePlan(git.root, projectTypes, config);
  return Object.freeze({ git, projectTypes, plan });
}

/**
 * Reject any before/after drift before storage mutation.
 * @param before - Inputs observed before quality commands
 * @param after - Inputs observed after quality commands
 */
function assertUnchanged(before: BoundInputs, after: BoundInputs): void {
  if (!after.git.clean) {
    throw new Error("Repository changed while standards checks were running.");
  }
  const scalarPairs = [
    ["identity", before.git.identity, after.git.identity],
    ["HEAD", before.git.head, after.git.head],
    ["tree", before.git.tree, after.git.tree],
    ["registry", before.plan.registryDigest, after.plan.registryDigest],
    ["config", before.plan.configDigest, after.plan.configDigest],
  ] as const;
  const changed = scalarPairs.find(([_label, left, right]) => left !== right);
  if (changed !== undefined) {
    throw new Error(
      `Standards proof input changed during capture: ${changed[0]}.`
    );
  }
  if (
    JSON.stringify(before.projectTypes) !== JSON.stringify(after.projectTypes)
  ) {
    throw new Error("Standards proof project types changed during capture.");
  }
  if (
    JSON.stringify(before.plan.checks) !== JSON.stringify(after.plan.checks)
  ) {
    throw new Error("Standards proof check plan changed during capture.");
  }
}

/**
 * Execute one fixed argv with a deadline, no shell, and bounded private output.
 * @param root - Canonical project repository
 * @param check - Fixed registry check to execute
 * @returns Exit status and bounded private output
 */
export async function runStandardsCommand(
  root: string,
  check: StandardsCheckSpec
): Promise<StandardsCommandOutcome> {
  const [command, ...args] = check.argv;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: root,
      timeout: check.timeoutMs,
      maxBuffer: MAX_CHECK_OUTPUT_BYTES,
      encoding: "utf8",
      env: {
        ...getProcessEnvironment(),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
        GIT_CONFIG: undefined,
        GIT_CONFIG_PARAMETERS: undefined,
        GIT_CONFIG_COUNT: undefined,
        GIT_OBJECT_DIRECTORY: undefined,
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_IMPLICIT_WORK_TREE: undefined,
        GIT_GRAFT_FILE: undefined,
        GIT_INDEX_FILE: undefined,
        GIT_NO_REPLACE_OBJECTS: undefined,
        GIT_REPLACE_REF_BASE: undefined,
        GIT_PREFIX: undefined,
        GIT_SHALLOW_FILE: undefined,
        GIT_COMMON_DIR: undefined,
        GIT_OPTIONAL_LOCKS: "0",
        CI: "1",
        VERIFY_BASE_SHA: undefined,
        VERIFY_HEAD_SHA: undefined,
        VERIFY_BASE_REF: undefined,
        VERIFY_CHANGE_TYPES: undefined,
        VERIFY_LABELS: undefined,
        VERIFY_PR_NUMBER: undefined,
        VERIFY_GITHUB_REPOSITORY: undefined,
        VERIFY_GITHUB_TOKEN: undefined,
        ...check.environment,
      },
    });
    return Object.freeze({ exitCode: 0, output: `${stdout}\n${stderr}` });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: string | number;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };
    if (failure.code === "ENOENT") {
      throw new Error(
        `Required standards tool is unavailable for ${check.id}.`
      );
    }
    if (failure.killed === true) {
      throw new Error(`Standards check timed out: ${check.id}.`);
    }
    return Object.freeze({
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      output: `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
    });
  }
}

/**
 * Read the explicit CLI process environment for child quality commands.
 * @returns Current process environment
 */
function getProcessEnvironment(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- explicit operator command must inherit the configured project toolchain
  return process.env;
}
