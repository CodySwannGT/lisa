/** Shared mechanical landing for lisa-drive-pr-to-merge and its CLI callers. */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env as processEnvironment } from "node:process";
import { captureCommand, type CaptureCommand } from "./starter-provenance.js";

/** Git writes stream their normal hooks; metadata reads remain bounded. */
export interface LandingCommands {
  readonly capture: CaptureCommand;
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string
  ) => Promise<void>;
}

/** Snapshot of the branch and every tracked/untracked pending change. */
export interface LandingSnapshot {
  readonly root: string;
  readonly head: string;
  readonly branch: string;
  readonly status: string;
}

/** A new, isolated branch owned by the landing operation. */
export interface PullRequestLanding {
  readonly project: string;
  readonly worktree: string;
  readonly directory: string;
  readonly head: string;
  readonly branch: string;
  readonly base: string;
  readonly repo: string;
}

/** Optional attribution supplied by the caller, never fabricated by the tool. */
export interface LandingAttribution {
  readonly workItem?: string;
  readonly coAuthor?: string;
}

/**
 * Execute normal Git hooks without a shell or an interactive prompt.
 * @param command - Executable name.
 * @param args - Separate command arguments.
 * @param cwd - Owning worktree.
 * @returns Completion after normal hooks finish.
 */
export const runLandingCommand: LandingCommands["run"] = async (
  command,
  args,
  cwd
) =>
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ["ignore", 2, 2],
      env: {
        ...processEnvironment,
        GIT_TERMINAL_PROMPT: "0",
        GH_PROMPT_DISABLED: "1",
        GIT_EDITOR: "true",
      },
      timeout: 30 * 60 * 1000,
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} failed (${signal ?? code}); its output is above.`
          )
        );
    });
  });

export const LANDING_COMMANDS: LandingCommands = {
  capture: captureCommand,
  run: runLandingCommand,
};

/**
 * Inspect the exact repository root; a parent repository is not a substitute.
 * @param project - Exact project root.
 * @param commands - Git metadata reader.
 * @returns Branch and working tree snapshot.
 */
export async function inspectLanding(
  project: string,
  commands = LANDING_COMMANDS
): Promise<LandingSnapshot> {
  const root = await realpath(project);
  const git = (args: readonly string[]) =>
    commands.capture("git", args, { cwd: root });
  if ((await realpath(await git(["rev-parse", "--show-toplevel"]))) !== root)
    throw new Error("Run starter sync at the repository root.");
  const branch = await git(["branch", "--show-current"]);
  if (!branch) throw new Error("Starter sync needs a checked-out branch.");
  return {
    root,
    branch,
    head: await git(["rev-parse", "HEAD"]),
    status: await git(["status", "--porcelain=v1", "--untracked-files=all"]),
  };
}

/**
 * Prepare the existing PR driver's isolated change-set worktree.
 * @param snapshot - Original checkout snapshot.
 * @param base - Destination branch.
 * @param commands - Git and GitHub operations.
 * @returns Existing PR or new isolated worktree.
 */
export async function preparePullRequest(
  snapshot: LandingSnapshot,
  base: string = snapshot.branch,
  commands = LANDING_COMMANDS
): Promise<PullRequestLanding | { readonly url: string }> {
  await commands.capture("git", ["check-ref-format", "--branch", base], {
    cwd: snapshot.root,
  });
  const repo = await commands.capture(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
    { cwd: snapshot.root }
  );
  const key = createHash("sha256")
    .update(`${base}\n${snapshot.head}`)
    .digest("hex")
    .slice(0, 12);
  const prefix = `chore/starter-sync-${key}-`;
  const branch = `${prefix}${randomUUID().slice(0, 8)}`;
  const existing: unknown = JSON.parse(
    await commands.capture(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repo,
        "--base",
        base,
        "--state",
        "open",
        "--json",
        "url,headRefName",
        "--limit",
        "1000",
      ],
      { cwd: snapshot.root }
    )
  );
  if (!Array.isArray(existing) || existing.length >= 1000)
    throw new Error("Could not read existing starter pull requests.");
  const match = existing.find(
    entry =>
      typeof entry?.headRefName === "string" &&
      entry.headRefName.startsWith(prefix)
  );
  if (match) {
    if (typeof match.url !== "string") throw new Error("Invalid PR URL.");
    return { url: match.url };
  }
  const directory = await mkdtemp(path.join(tmpdir(), "lisa-starter-sync-"));
  const worktree = path.join(directory, "worktree");
  try {
    await commands.run(
      "git",
      ["worktree", "add", "--no-track", "-b", branch, worktree, snapshot.head],
      snapshot.root
    );
    await bootstrapLanding(worktree, commands);
  } catch (error) {
    throw new Error(
      `Could not prepare starter sync; inspect existing branch ${branch}. Temporary directory: ${directory}`,
      { cause: error }
    );
  }
  return {
    project: snapshot.root,
    worktree,
    directory,
    head: snapshot.head,
    branch,
    base,
    repo,
  };
}

/**
 * Remove only a clean worktree that this operation created; never force it.
 * @param landing - Worktree owned by this operation.
 * @param commands - Git operations.
 */
export async function releasePullRequestWorktree(
  landing: PullRequestLanding,
  commands = LANDING_COMMANDS
): Promise<void> {
  const head = await commands.capture("git", ["rev-parse", "HEAD"], {
    cwd: landing.worktree,
  });
  await commands.run(
    "git",
    ["worktree", "remove", landing.worktree],
    landing.project
  );
  await rmdir(landing.directory);
  if (head === landing.head)
    await commands.run(
      "git",
      ["branch", "-d", landing.branch],
      landing.project
    );
}

/**
 * Commit only the declared change set after checking for unrelated changes.
 * @param before - Snapshot before applying changes.
 * @param paths - Files belonging to this change set.
 * @param title - Commit subject.
 * @param attribution - Caller supplied tracker and author.
 * @param commands - Git operations.
 * @returns Commit identifier, or undefined when already current.
 */
export async function commitLanding(
  before: LandingSnapshot,
  paths: readonly string[],
  title: string,
  attribution: LandingAttribution = {},
  commands = LANDING_COMMANDS
): Promise<string | undefined> {
  const after = await inspectLanding(before.root, commands);
  if (after.head !== before.head || after.branch !== before.branch)
    throw new Error(
      "The branch changed during starter sync; changes remain uncommitted."
    );
  const staged = await commands.capture(
    "git",
    ["diff", "--cached", "--name-only", "-z"],
    { cwd: before.root }
  );
  if (staged)
    throw new Error(
      "The index changed during starter sync; changes remain uncommitted."
    );
  const changed = await commands.capture(
    "git",
    [
      "ls-files",
      "--modified",
      "--deleted",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { cwd: before.root }
  );
  if (
    changed
      .split("\0")
      .filter(Boolean)
      .some(name => !paths.includes(name))
  )
    throw new Error(
      "Unrelated changes appeared during starter sync; nothing was committed."
    );
  if (!after.status) return undefined;
  const trailers = [
    attribution.workItem && `Work-Item: ${attribution.workItem}`,
    attribution.coAuthor && `Co-authored-by: ${attribution.coAuthor}`,
  ].filter(Boolean);
  if (
    [attribution.workItem, attribution.coAuthor].some(
      value => value !== undefined && /[\r\n]/.test(value)
    )
  )
    throw new Error("Commit attribution must contain single-line values.");
  await commands.run("git", ["add", "--", ...paths], before.root);
  await commands.run(
    "git",
    ["commit", "-m", [title, ...trailers].join("\n\n")],
    before.root
  );
  return await commands.capture("git", ["rev-parse", "HEAD"], {
    cwd: before.root,
  });
}

/**
 * Publish through the existing driver's mechanical path; never arm auto-merge.
 * @param landing - Clean change set worktree.
 * @param title - Pull request title.
 * @param body - Reviewable change description.
 * @param commands - Git and GitHub operations.
 * @returns Created pull request URL.
 */
export async function publishPullRequest(
  landing: PullRequestLanding,
  title: string,
  body: string,
  commands = LANDING_COMMANDS
): Promise<string> {
  const current = await inspectLanding(landing.worktree, commands);
  if (current.branch !== landing.branch || current.status)
    throw new Error(
      `Starter landing is no longer clean on ${landing.branch}; inspect ${landing.worktree}.`
    );
  await commands.run(
    "git",
    ["push", "origin", `HEAD:refs/heads/${landing.branch}`],
    landing.worktree
  );
  const bodyFile = path.join(landing.directory, "pull-request.md");
  await writeFile(bodyFile, body, { flag: "wx", mode: 0o600 });
  return await commands.capture(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      landing.repo,
      "--head",
      landing.branch,
      "--base",
      landing.base,
      "--title",
      title,
      "--body-file",
      bodyFile,
    ],
    { cwd: landing.worktree }
  );
}

/**
 * Reuse the native worktree bootstrap before requiring commit hooks to run.
 * @param worktree - Newly created worktree.
 * @param commands - Normal subprocess runner.
 */
async function bootstrapLanding(
  worktree: string,
  commands: LandingCommands
): Promise<void> {
  if (existsSync(path.join(worktree, "package.json"))) {
    const installer = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../plugins/lisa/hooks/install-pkgs.sh"
    );
    await commands.run("bash", [installer], worktree);
    if (
      !existsSync(path.join(worktree, "node_modules")) ||
      !statSync(path.join(worktree, "node_modules")).isDirectory()
    )
      throw new Error(
        "Worktree dependency bootstrap did not produce node_modules."
      );
  }
}
