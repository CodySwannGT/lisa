/**
 * Keeping one project's manager, bot and token apart from every other
 * project's on the same machine.
 *
 * The manager's tmux session name and its Telegram state dir are both derived
 * from a project slug. A slug taken from the repository name alone collides
 * for two checkouts of one repository, or for two projects that share a
 * folder name, and the collision is silent: the second project's `start`
 * reports "already-running" about the first project's manager, which then
 * dispatches the wrong project's work with bypass permissions. So:
 * - the default slug carries a short hash of the real project root, and
 * - before treating a running session as ours, the CLI asks tmux where that
 *   session was started and compares real paths.
 * @module session-manager/isolation
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";

import { CliError, EXIT, run } from "./cli-runtime.mjs";
import { buildHasSession, buildSessionPath } from "./launch.mjs";

/** Characters of the repo name kept, so `<name>-<hash6>` fits in 56. */
const SLUG_BASE_LENGTH = 49;

/** Hex characters of the root hash in a default slug. */
const ROOT_HASH_LENGTH = 6;

/**
 * The real path of `dir`, or its plain resolution when it does not exist.
 * @param {string} dir - Directory
 * @returns {string} Absolute path with symlinks resolved where possible
 */
export function realpathOr(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * The default project slug: the repo (or folder) name plus a stable hash of
 * the real project root, `<name>-<hash6>`. The name is cut first so the hash
 * always survives the 56-character slug limit `buildDefaultBlock` applies.
 * @param {string} root - Absolute project root
 * @param {string | undefined} repoName - `github.repo`, when configured
 * @returns {string} Slug for `buildDefaultBlock`
 */
export function defaultProjectSlug(root, repoName) {
  const base = String(repoName ?? path.basename(root)).slice(
    0,
    SLUG_BASE_LENGTH
  );
  const hash = createHash("sha256")
    .update(realpathOr(root))
    .digest("hex")
    .slice(0, ROOT_HASH_LENGTH);
  return `${base}-${hash}`;
}

/**
 * Whether the manager's tmux session is running, and if so, that it is this
 * project's. A session started anywhere else (or one tmux cannot place) is
 * another project's manager under the same name, which is exit 2: neither
 * "already running" nor "stopped" would be true.
 * @param {{ root: string }} ctx - CLI context
 * @param {string} name - Manager session name
 * @param {Record<string, string | undefined>} env - Environment for tmux
 * @returns {{ running: boolean, missing: boolean }} `missing` when tmux is
 *   not on PATH
 */
export function probeOwnSession(ctx, name, env) {
  const probe = run("tmux", buildHasSession(name), { env });
  if (probe.missing) return { running: false, missing: true };
  // probe-direction: fail-closed — a failed has-session reads as "not
  // running", so `start` goes on to new-session, which tmux refuses for a
  // duplicate name; it never reports someone else's session as ours.
  if (probe.status !== 0) return { running: false, missing: false };
  const where = run("tmux", buildSessionPath(name), { env }).stdout.trim();
  if (where && realpathOr(where) === realpathOr(ctx.root)) {
    return { running: true, missing: false };
  }
  const place = where
    ? `was started in ${where}, not in ${ctx.root}`
    : `is running, but tmux cannot say where it was started`;
  throw new CliError(
    `tmux session "${name}" ${place}. Another project is using the same ` +
      `manager name: give this project its own sessionManager.name and ` +
      `notify.stateDir (init-config derives unique ones), or stop that ` +
      `project's manager from its own root.`,
    EXIT.SETUP
  );
}

/** How often the survival check asks tmux, in milliseconds. */
const SURVIVAL_POLL_MS = 250;

/**
 * Wait `ms` milliseconds.
 * @param {number} ms - Delay
 * @returns {Promise<void>} Resolves after the delay
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Whether a just-started manager session is still there after `settleMs`.
 *
 * tmux `new-session -d` succeeds as soon as the session exists, even when its
 * command (claude) exits a moment later on a bad argv; tmux then closes the
 * window and the session with it. So a check right after `new-session` proves
 * nothing: this asks `has-session -t =<name>` every 250 ms for the whole
 * window and returns false the first time the session is gone. Bounded by
 * `settleMs`, which the caller caps.
 * @param {string} name - Manager session name
 * @param {Record<string, string | undefined>} env - Environment for tmux
 * @param {number} settleMs - How long the session must survive
 * @returns {Promise<boolean>} True when it was there at every check
 */
export async function sessionSurvives(name, env, settleMs) {
  const checks = Math.max(1, Math.ceil(settleMs / SURVIVAL_POLL_MS));
  const step = settleMs / checks;
  for (let check = 0; check < checks; check += 1) {
    await sleep(step);
    if (run("tmux", buildHasSession(name), { env }).status !== 0) return false;
  }
  return true;
}
