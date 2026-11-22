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
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  HOST_LISA_ENTRY,
  SELF_LISA_ENTRY,
  buildPortableLearningsMergeDriverCommand,
  classifyLearningsDriverCommand,
} from "./learnings-merge-driver-command.js";
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
   * An explicit, already shell-quoted way to invoke the Lisa CLI, registered
   * in the pre-#4640 `<invocation> merge-learnings …` form. Tests use it to
   * point the driver at a specific CLI. Omitted, the command is the
   * worktree-portable one, which resolves Lisa relative to whichever worktree
   * git is merging in.
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
 * The worktree-relative path of the Lisa entry this project runs.
 *
 * Relative to the TOP of the worktree, because that is git's cwd when it runs
 * a driver — so a project nested below the repository root carries its
 * prefix. Inside the Lisa repository itself the entry is its own build;
 * everywhere else it is the installed package.
 * @param projectRoot - Project directory being registered
 * @returns Entry such as `./node_modules/@codyswann/lisa/dist/index.js`
 */
async function resolvePortableEntry(projectRoot: string): Promise<string> {
  const prefix = await tryGit(["rev-parse", "--show-prefix"], projectRoot);
  const relative = prefix.ok ? prefix.stdout : "";
  const entry = (await isLisaRepository(projectRoot))
    ? SELF_LISA_ENTRY
    : HOST_LISA_ENTRY;
  return `./${path.posix.join(relative, entry)}`;
}

/**
 * Whether the project is Lisa's own repository.
 * @param projectRoot - Project directory being registered
 * @returns True when package.json names `@codyswann/lisa`
 */
async function isLisaRepository(projectRoot: string): Promise<boolean> {
  try {
    const manifest: unknown = JSON.parse(
      await readFile(path.join(projectRoot, "package.json"), "utf8")
    );
    return (
      typeof manifest === "object" &&
      manifest !== null &&
      "name" in manifest &&
      manifest.name === "@codyswann/lisa"
    );
  } catch {
    return false;
  }
}

/**
 * The detail reported when a registration is written.
 *
 * Names the command it replaced, so `lisa apply` tells the operator that an
 * absolute registration — one that breaks when its checkout is removed — was
 * migrated, rather than reporting an indistinguishable "registered".
 * @param previous - Previously registered command, when there was one
 * @returns Single-line, operator-facing detail
 */
function installedDetail(previous: string | undefined): string {
  if (previous === undefined || previous === "") {
    return `registered the ${LEARNINGS_MERGE_DRIVER_NAME} merge driver`;
  }
  const kind =
    classifyLearningsDriverCommand(previous).kind === "absolute"
      ? "absolute"
      : "previous";
  return `replaced the ${LEARNINGS_MERGE_DRIVER_NAME} merge driver's ${kind} registration '${previous}' with a worktree-portable command`;
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
 * Registration state of the driver command for one checkout.
 *
 * `unregistered` is the state this whole module exists to make visible: the
 * `.gitattributes` mapping is committed, so every clone believes the ledger is
 * union-merged, while the command that performs the union lives only in local
 * git config. A clone that never ran apply is degraded, not broken — and says
 * nothing about it.
 */
export type MergeDriverRegistration =
  | "registered"
  | "unregistered"
  | "not-a-repository"
  | "git-unavailable";

/**
 * Report whether the driver command is registered for this checkout.
 *
 * Read-only, and deliberately scope-agnostic: registration is written to local
 * config, but git resolves a merge driver from any config scope, so a global
 * registration counts. Asking with `--local` would report a working driver as
 * missing.
 * @param projectRoot - Project directory to inspect
 * @returns Closed registration state
 */
export async function probeLearningsMergeDriverRegistration(
  projectRoot: string
): Promise<MergeDriverRegistration> {
  const probe = await probeRepository(projectRoot);
  if (probe !== "repository") {
    // Both non-repository outcomes are already registration states; narrowing
    // hands them through unchanged rather than restating the literals.
    return probe;
  }
  const current = await tryGit(["config", "--get", DRIVER_KEY], projectRoot);
  return current.ok && current.stdout !== "" ? "registered" : "unregistered";
}

/** A registered driver command and the worktree it resolves against. */
export interface RegisteredLearningsDriver {
  /** The command as `git config --get` returns it. */
  readonly command: string;
  /** Top of this worktree: git's cwd when it runs the driver here. */
  readonly worktreeTop: string;
}

/**
 * Read the registered driver command, for checks that must know whether it
 * can actually run here rather than merely whether it is set.
 * @param projectRoot - Project directory to inspect
 * @returns The command and worktree top, or undefined when unset
 */
export async function readLearningsMergeDriverRegistration(
  projectRoot: string
): Promise<RegisteredLearningsDriver | undefined> {
  const current = await tryGit(["config", "--get", DRIVER_KEY], projectRoot);
  const top = await tryGit(["rev-parse", "--show-toplevel"], projectRoot);
  if (!current.ok || current.stdout === "" || !top.ok) {
    return undefined;
  }
  return { command: current.stdout, worktreeTop: top.stdout };
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
  const desired =
    dependencies.invocation === undefined
      ? buildPortableLearningsMergeDriverCommand(
          await resolvePortableEntry(projectRoot)
        )
      : buildLearningsMergeDriverCommand(dependencies.invocation);
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
    detail: installedDetail(current.ok ? current.stdout : undefined),
  };
}
