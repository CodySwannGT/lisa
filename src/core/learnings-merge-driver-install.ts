/**
 * Machine-local registration of the project-learnings union merge driver.
 *
 * Git never reads a driver command from the repository — that would let a
 * cloned repository execute arbitrary code on `git merge` — so the command must
 * be written into local git config on each machine. This module is the single
 * implementation behind both registration paths: the `EnsureLearningsMergeDriver`
 * migration that runs on every `lisa apply`, and the explicit
 * `lisa install-merge-driver` command an operator can re-run by hand.
 * @module core/learnings-merge-driver-install
 */
import {
  LEARNINGS_MERGE_DRIVER_DESCRIPTION,
  LEARNINGS_MERGE_DRIVER_NAME,
  buildLearningsMergeDriverCommand,
} from "./learnings-merge-driver.js";

const GIT_COMMAND_ENV: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
const DRIVER_KEY = `merge.${LEARNINGS_MERGE_DRIVER_NAME}.driver`;
const NAME_KEY = `merge.${LEARNINGS_MERGE_DRIVER_NAME}.name`;
const NOT_REGISTERED = "merge driver not registered";

/** Raw outcome of one git invocation. */
type GitRun =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly missingGit: boolean };

/** Why a directory may or may not accept a driver registration. */
type RepositoryProbe = "repository" | "not-a-repository" | "git-unavailable";
const NO_REPO: RepositoryProbe = "not-a-repository";

/**
 * Outcome of one registration attempt.
 *
 * `skipped` and `failed` are deliberately distinct: a directory that is not a
 * git repository is a benign, expected non-event, while a git-config write that
 * genuinely failed must not be reported as success — an operator who ran
 * `lisa install-merge-driver` and saw exit 0 would believe the ledger is
 * protected when it is not.
 */
export interface MergeDriverInstallResult {
  /** Registered now, already correct, benignly inapplicable, or a real failure. */
  readonly kind: "installed" | "unchanged" | "skipped" | "failed";
  /** Single-line, operator-facing explanation. */
  readonly detail: string;
}

/** Injectable collaborators for {@link installLearningsMergeDriver}. */
export interface MergeDriverInstallDependencies {
  /**
   * How to invoke the Lisa CLI. Defaults to this process's own runtime and
   * entry script, which is what makes the registration self-locating: whichever
   * Lisa is running the install is the Lisa the driver will call.
   */
  readonly invocation?: string;
}

/**
 * Run a fixed git command with arguments, never through a shell.
 *
 * `execFile` (not `exec`) keeps every argument a literal — the driver command
 * contains `%` placeholders and may contain spaces, and shell quoting is an
 * avoidable failure mode. `child_process` is imported dynamically to match the
 * house pattern that keeps the static command-path lint satisfied.
 * @param args - Literal git arguments
 * @param cwd - Working directory to run in
 * @returns Trimmed stdout, or undefined when the command exits non-zero
 */
async function tryGit(args: readonly string[], cwd: string): Promise<GitRun> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run("git", [...args], {
      cwd,
      env: GIT_COMMAND_ENV,
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    return { ok: false, missingGit: code === "ENOENT" };
  }
}

/**
 * Probe whether this directory is a registrable git working tree.
 *
 * Distinguishes a missing git binary from a real non-repository. The pinned
 * PATH is deliberate hardening, but on a host where git lives outside it, an
 * undifferentiated failure would tell the operator "not a git repository" about
 * a directory that plainly is one.
 * @param projectRoot - Project directory to inspect
 * @returns Closed probe outcome
 */
async function probeRepository(projectRoot: string): Promise<RepositoryProbe> {
  const result = await tryGit(
    ["rev-parse", "--is-inside-work-tree"],
    projectRoot
  );
  if (!result.ok) {
    return result.missingGit ? "git-unavailable" : NO_REPO;
  }
  return result.stdout === "true" ? "repository" : NO_REPO;
}

/**
 * Quote one path for the POSIX shell that git runs a merge driver through.
 *
 * Single quotes, not double: git executes `merge.<name>.driver` via `sh`, where
 * `$`, a backtick, and a backslash stay special inside double quotes. A path
 * containing `$` would silently expand to nothing and the driver would fail to
 * launch; a backtick would run a command substitution. Inside single quotes the
 * shell treats every byte literally, so only an embedded single quote needs
 * handling — closed, escaped, and reopened as `'\''`.
 * @param value - Raw filesystem path
 * @returns Shell-safe single-quoted token
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Resolve how to re-invoke the currently running Lisa CLI.
 *
 * Uses `process.execPath` as the runtime rather than a hardcoded `node`, so a
 * checkout running under Bun registers a Bun-executable command and a published
 * package running under Node registers a Node one. Returns undefined when the
 * entry script is unknown: registering a command that can never launch is worse
 * than leaving git on its default driver, which at least fails visibly.
 * @returns Shell-safe `<runtime> <entry script>` invocation, when resolvable
 */
function resolveLisaInvocation(): string | undefined {
  const entry = process.argv[1];
  if (entry === undefined || entry === "") {
    return undefined;
  }
  return `${shellQuote(process.execPath)} ${shellQuote(entry)}`;
}

/**
 * Whether this directory is a git working tree the driver can be registered in.
 *
 * Strictly read-only, so callers that must not mutate — a migration's
 * `applies()` check and its dry-run path — can ask the question without
 * writing anything.
 * @param projectRoot - Project directory to inspect
 * @returns True when the directory is inside a git working tree
 */
export async function canInstallLearningsMergeDriver(
  projectRoot: string
): Promise<boolean> {
  return (await probeRepository(projectRoot)) === "repository";
}

/**
 * Register the union merge driver in one project's local git config.
 *
 * Idempotent and safe outside a git repository: a non-repository directory is
 * skipped rather than failing an apply.
 * @param projectRoot - Project directory to register the driver in
 * @param dependencies - Injectable collaborators for tests
 * @returns Structured registration outcome
 */
export async function installLearningsMergeDriver(
  projectRoot: string,
  dependencies: MergeDriverInstallDependencies = {}
): Promise<MergeDriverInstallResult> {
  const probe = await probeRepository(projectRoot);
  if (probe === "git-unavailable") {
    return {
      kind: "failed",
      detail: `git executable not found — ${NOT_REGISTERED} (install git, then re-run \`lisa install-merge-driver\`)`,
    };
  }
  if (probe === NO_REPO) {
    return {
      kind: "skipped",
      detail: "not a git repository — nothing to register",
    };
  }
  const invocation = dependencies.invocation ?? resolveLisaInvocation();
  if (invocation === undefined) {
    return {
      kind: "failed",
      detail: `could not resolve the Lisa entry point — ${NOT_REGISTERED}`,
    };
  }
  const desired = buildLearningsMergeDriverCommand(invocation);
  const current = await tryGit(
    ["config", "--local", "--get", DRIVER_KEY],
    projectRoot
  );
  if (current.ok && current.stdout === desired) {
    return {
      kind: "unchanged",
      detail: `${LEARNINGS_MERGE_DRIVER_NAME} merge driver already registered`,
    };
  }
  await tryGit(
    ["config", "--local", NAME_KEY, LEARNINGS_MERGE_DRIVER_DESCRIPTION],
    projectRoot
  );
  const set = await tryGit(
    ["config", "--local", DRIVER_KEY, desired],
    projectRoot
  );
  if (!set.ok) {
    return {
      kind: "failed",
      detail: `could not write local git config — ${NOT_REGISTERED}`,
    };
  }
  return {
    kind: "installed",
    detail: `registered the ${LEARNINGS_MERGE_DRIVER_NAME} merge driver`,
  };
}
