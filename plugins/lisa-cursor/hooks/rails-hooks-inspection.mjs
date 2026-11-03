// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Safe read-only inspection at the hooks directory Git actually resolves. */
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { runHookCommand } from "./rails-hooks-command.mjs";

export const RAILS_HOOK_NAMES = Object.freeze([
  "commit-msg",
  "pre-commit",
  "pre-push",
  "prepare-commit-msg",
]);
const MAX_HOOK_BYTES = 512 * 1024;

/**
 * Read an executable regular wrapper without following links or special files.
 * @param {string} directory Canonical Git-selected directory.
 * @param {string} name Fixed hook basename.
 * @returns {Promise<boolean>} Whether the wrapper is installed.
 */
async function validWrapper(directory, name) {
  const file = path.join(directory, name);
  try {
    const before = await lstat(file);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (before.mode & 0o100) === 0 ||
      before.size > MAX_HOOK_BYTES ||
      !(await realpath(file)).startsWith(`${directory}${path.sep}`)
    )
      return false;
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        (opened.mode & 0o100) === 0 ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size > MAX_HOOK_BYTES
      )
        return false;
      const buffer = Buffer.alloc(opened.size + 1);
      let count = 0;
      while (count < buffer.length) {
        const part = await handle.read(
          buffer,
          count,
          buffer.length - count,
          count
        );
        if (part.bytesRead === 0) break;
        count += part.bytesRead;
      }
      const after = await handle.stat();
      return (
        count <= MAX_HOOK_BYTES &&
        count === opened.size &&
        count === after.size &&
        (after.mode & 0o100) !== 0 &&
        new TextDecoder("utf8", { fatal: true })
          .decode(buffer.subarray(0, count))
          .toLowerCase()
          .includes("lefthook")
      );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/**
 * Observe actual installed hooks, including a worktree's shared directory.
 * The Git-selected directory is the narrow authority for these four reads;
 * ordinary health project-file confinement is not widened.
 * @param {string} projectRoot Host checkout.
 * @param {{timeoutMs?: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv}} [options] Shared deadline/cancellation.
 * @returns {Promise<{status: "pass"|"fail", drift: string[], directory?: string}>} Installation state.
 */
export async function inspectRailsHooks(projectRoot, options = {}) {
  const budget = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + budget;
  if (!Number.isFinite(budget) || budget <= 0 || options.signal?.aborted)
    return { status: "fail", drift: ["Git hooks inspection was cancelled"] };
  const result = await runHookCommand(
    "git",
    ["rev-parse", "--git-path", "hooks"],
    {
      ...options,
      cwd: projectRoot,
      timeoutMs: budget,
      capture: true,
    }
  );
  if (
    result.code !== 0 ||
    result.reason !== null ||
    !result.stdout.endsWith("\n") ||
    /[\n\r\0]/.test(result.stdout.slice(0, -1)) ||
    result.stdout.length <= 1
  )
    return { status: "fail", drift: ["Git hooks directory unavailable"] };
  const selected = path.resolve(projectRoot, result.stdout.slice(0, -1));
  let directory;
  try {
    directory = await realpath(selected);
    if (!(await lstat(directory)).isDirectory())
      throw new Error("Not a directory");
  } catch {
    return {
      status: "fail",
      drift: [...RAILS_HOOK_NAMES],
      directory: selected,
    };
  }
  const missing = await Promise.all(
    RAILS_HOOK_NAMES.map(async name =>
      (await validWrapper(directory, name)) ? undefined : name
    )
  );
  const drift = missing.filter(name => name !== undefined);
  if (Date.now() >= deadline || options.signal?.aborted)
    return {
      status: "fail",
      drift: ["Git hooks inspection timed out or was cancelled"],
      directory,
    };
  return { status: drift.length === 0 ? "pass" : "fail", drift, directory };
}
