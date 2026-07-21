/** Bounded, no-shell Git observation for standards proof freshness. */
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024;

/** Exact repository state bound into a proof. */
export interface StandardsGitState {
  readonly root: string;
  readonly identity: string;
  readonly head: string;
  readonly tree: string;
  readonly clean: boolean;
}

/**
 * Read canonical identity, commit/tree objects, and complete nonignored dirt.
 * Git optional locks and fsmonitor are disabled because UI observation must be
 * read-only and safe to repeat.
 * @param projectRoot - Path within the repository
 * @returns Bounded repository state
 */
export async function readStandardsGitState(
  projectRoot: string
): Promise<StandardsGitState> {
  const requested = await realpath(projectRoot);
  const root = await realpath(
    await git(requested, ["rev-parse", "--show-toplevel"])
  );
  const remoteNames = (await git(root, ["remote"], true))
    .split("\n")
    .map(value => value.trim())
    .filter(Boolean);
  const remoteUrls = remoteNames.includes("origin")
    ? (await git(root, ["remote", "get-url", "--all", "origin"]))
        .split("\n")
        .map(value => value.trim())
        .filter(Boolean)
    : [];
  if (remoteUrls.length !== 1) {
    throw new Error(
      remoteUrls.length === 0
        ? "Repository origin is missing."
        : "Repository origin is ambiguous."
    );
  }
  const [head, tree, status] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["rev-parse", "HEAD^{tree}"]),
    git(
      root,
      [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
        "--",
        ".",
        ":(exclude).lisa/standards/latest.json",
      ],
      true
    ),
  ]);
  return Object.freeze({
    root,
    identity: normalizeGitRemoteIdentity(remoteUrls[0]!),
    head,
    tree,
    clean: status.length === 0,
  });
}

/**
 * Require a parent commit for the non-vacuous threshold-ratchet comparison.
 * @param projectRoot - Canonical repository root
 * @returns Parent commit object identifier
 */
export async function requireStandardsBaseCommit(
  projectRoot: string
): Promise<string> {
  try {
    return await git(projectRoot, ["rev-parse", "HEAD^"]);
  } catch {
    throw new Error(
      "Standards proof requires a parent commit for threshold comparison."
    );
  }
}

/**
 * Normalize HTTPS, SSH URL, and SCP-like remotes to host[:port]/owner/repo.
 * Credentials are never retained and default transport ports are removed.
 * @param remote - One configured origin URL
 * @returns Stable lowercase repository identity
 */
export function normalizeGitRemoteIdentity(remote: string): string {
  const trimmed = remote.trim();
  const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/u.exec(trimmed);
  if (scp && !trimmed.includes("://")) {
    return finishIdentity(scp[1]!, scp[2]!);
  }
  const parsed = parseRemoteUrl(trimmed);
  if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) {
    throw new Error("Repository origin uses an unsupported protocol.");
  }
  const defaultPort =
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80") ||
    ((parsed.protocol === "ssh:" || parsed.protocol === "git:") &&
      parsed.port === "22");
  const authority = `${parsed.hostname}${
    parsed.port && !defaultPort ? `:${parsed.port}` : ""
  }`;
  return finishIdentity(authority, parsed.pathname);
}

/**
 * Complete and validate a normalized repository identity.
 * @param authority - Lower-level remote host and optional non-default port
 * @param pathname - Remote repository path
 * @returns Normalized stable repository identity
 */
function finishIdentity(authority: string, pathname: string): string {
  const normalizedPath = pathname
    .split("/")
    .filter(Boolean)
    .join("/")
    .replace(/\.git$/iu, "")
    .toLowerCase();
  const normalizedAuthority = authority.toLowerCase();
  if (
    normalizedAuthority.length === 0 ||
    normalizedPath.length === 0 ||
    normalizedPath.includes("..") ||
    !normalizedPath.includes("/")
  ) {
    throw new Error("Repository origin does not identify an owner/repository.");
  }
  return `${normalizedAuthority}/${normalizedPath}`;
}

/**
 * Parse one URL without retaining credentials in any result.
 * @param remote - Remote URL candidate
 * @returns Parsed URL object
 */
function parseRemoteUrl(remote: string): URL {
  try {
    return new URL(remote);
  } catch {
    throw new Error("Repository origin is not a supported Git remote URL.");
  }
}

/**
 * Run one bounded read-only Git command without shell interpolation.
 * @param cwd - Repository working directory
 * @param args - Fixed Git arguments
 * @param allowEmpty - Whether an empty stdout value is valid
 * @returns Trimmed bounded stdout
 */
async function git(
  cwd: string,
  args: readonly string[],
  allowEmpty = false
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        ...args,
      ],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        encoding: "utf8",
        env: {
          ...getProcessEnvironment(),
          GIT_OPTIONAL_LOCKS: "0",
          GIT_DIR: undefined,
          GIT_WORK_TREE: undefined,
          GIT_INDEX_FILE: undefined,
        },
      }
    );
    const output = stdout.trim();
    if (!allowEmpty && output.length === 0) {
      throw new Error("Git returned no repository state.");
    }
    return output;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Repository ")) {
      throw error;
    }
    throw new Error("Git repository state could not be observed.");
  }
}

/**
 * Read the CLI environment at one reviewable process boundary.
 * @returns Current process environment
 */
function getProcessEnvironment(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- Git must inherit the operator toolchain while clearing repository redirects
  return process.env;
}
