// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** One Rails installer shared by startup, apply, doctor and health. */
import { lstat } from "node:fs/promises";
import path from "node:path";
import { inspectRailsHooks } from "./rails-hooks-inspection.mjs";
import { runHookCommand } from "./rails-hooks-command.mjs";

export { inspectRailsHooks } from "./rails-hooks-inspection.mjs";
export const RAILS_HOOK_INSTALL_COMMAND = "bundle exec lefthook install";
export const RAILS_HOOK_ENGINE_FILES = Object.freeze([
  "rails-hooks.mjs",
  "rails-hooks-inspection.mjs",
  "rails-hooks-command.mjs",
]);
const DEFAULT_INSTALL_BUDGET_MS = 30_000;
const CANCELLED_INSTALLATION = "installation timed out or was cancelled";

/**
 * Describe a failed install without echoing Bundler output or credentials.
 * @param {string} reason Bounded operator-readable cause.
 * @returns {{status: "failed", detail: string}} Actionable failure.
 */
function failed(reason) {
  return {
    status: "failed",
    detail: `Rails Git hooks: ${reason}; run ${RAILS_HOOK_INSTALL_COMMAND}.`,
  };
}

/**
 * Install only absent/invalid wrappers through the actual supported manager.
 * No package installation or interactive shell is part of this operation.
 * @param {string} projectRoot Host checkout (startup may pass a subdirectory).
 * @param {{timeoutMs?: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv}} [options] One total bounded operation.
 * @returns {Promise<{status: "not-applicable"|"already-installed"|"installed"|"failed", detail?: string}>} Outcome; callers keep startup/apply nonblocking on failure.
 */
export async function ensureRailsHooks(projectRoot, options = {}) {
  const budget = options.timeoutMs ?? DEFAULT_INSTALL_BUDGET_MS;
  if (!Number.isFinite(budget) || budget <= 0)
    return failed("invalid installation deadline");
  const deadline = Date.now() + budget;
  const remaining = () => Math.max(1, deadline - Date.now());
  const scope = {
    ...options,
    cwd: projectRoot,
    timeoutMs: remaining(),
    capture: true,
  };
  const top = await runHookCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    scope
  );
  const validRoot =
    top.code === 0 &&
    top.reason === null &&
    top.stdout.endsWith("\n") &&
    top.stdout.length > 1 &&
    !/[\n\r\0]/.test(top.stdout.slice(0, -1));
  const root = validRoot
    ? path.resolve(projectRoot, top.stdout.slice(0, -1))
    : projectRoot;
  try {
    const configuration = await lstat(path.join(root, "lefthook.yml"));
    if (!configuration.isFile() || configuration.isSymbolicLink())
      return failed("lefthook.yml is not a regular file");
  } catch (error) {
    if (error.code === "ENOENT") return { status: "not-applicable" };
    return failed("lefthook.yml could not be inspected");
  }
  if (!validRoot) return failed("Git checkout could not be read");
  if (Date.now() >= deadline || options.signal?.aborted)
    return failed(CANCELLED_INSTALLATION);
  const before = await inspectRailsHooks(root, {
    ...options,
    timeoutMs: remaining(),
  });
  if (before.status === "pass") return { status: "already-installed" };
  if (before.directory === undefined)
    return failed("Git hooks directory could not be read");
  if (Date.now() >= deadline || options.signal?.aborted)
    return failed(CANCELLED_INSTALLATION);
  const installed = await runHookCommand(
    "bundle",
    ["exec", "lefthook", "install"],
    {
      ...options,
      cwd: root,
      timeoutMs: remaining(),
    }
  );
  if (installed.code !== 0 || installed.reason !== null) {
    if (installed.reason === "ENOENT") return failed("Bundler is unavailable");
    if (["ETIMEDOUT", "ABORT_ERR"].includes(installed.reason))
      return failed(CANCELLED_INSTALLATION);
    const exitDetail =
      installed.code === null ? "" : ` (exit ${installed.code})`;
    return failed(`installation failed${exitDetail}`);
  }
  if (Date.now() >= deadline || options.signal?.aborted)
    return failed(CANCELLED_INSTALLATION);
  const after = await inspectRailsHooks(root, {
    ...options,
    timeoutMs: remaining(),
  });
  return after.status === "pass"
    ? { status: "installed" }
    : failed(
        `installation left missing or invalid hooks: ${after.drift.join(", ")}`
      );
}
