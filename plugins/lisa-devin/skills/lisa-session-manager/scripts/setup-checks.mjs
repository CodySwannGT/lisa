/**
 * Read-only facts setup needs before it asks the operator for anything:
 * which worker directories Claude Code already trusts, and whether a
 * scheduled intake loop is still running alongside the manager.
 *
 * Both used to be manual (CodySwannGT/lisa#4465). Setup asked the operator to
 * open `claude` in every worker directory to accept workspace trust, even
 * where Claude Code had already recorded it; and it only warned that
 * `intake-tickets` / `intake-repair` compete with the manager, leaving the
 * agent to dig through run logs to find out whether either was alive.
 *
 * Neither check writes anything, and neither answers a trust prompt.
 * @module session-manager/setup-checks
 */
import * as nodeFs from "node:fs";
import path from "node:path";

/** The scheduled loops that compete with the manager for the same items. */
export const COMPETING_LOOPS = Object.freeze([
  "intake-tickets",
  "intake-repair",
]);

/** A loop counts as recent when it ran within at least this long. */
const MIN_RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * Where Claude Code keeps its global state, including per-directory trust:
 * `$CLAUDE_CONFIG_DIR/.claude.json` when that is set, else `~/.claude.json`.
 * @param {{ env?: Record<string, string | undefined>, homedir: string }} input
 *   - Environment and home directory
 * @returns {string} Absolute path
 */
export function claudeStateFile({ env = {}, homedir }) {
  const configDir = env.CLAUDE_CONFIG_DIR;
  return configDir
    ? path.join(configDir, ".claude.json")
    : path.join(homedir, ".claude.json");
}

/**
 * Whether Claude Code has recorded workspace trust for each directory.
 *
 * `true` and `false` come from Claude Code's own record
 * (`projects[<dir>].hasTrustDialogAccepted`). A directory and the key Claude
 * Code recorded can name the same place through different symlinks (macOS
 * `/var` is `/private/var`), so a key matches when the two realpaths agree;
 * only keys with the same final segment are resolved, so a large state file
 * costs a handful of realpath calls. `unknown` means the record could not be
 * read, so the operator still has to check that directory by hand.
 * @param {{ dirs: string[], env?: Record<string, string | undefined>,
 *   homedir: string, fs?: Pick<typeof nodeFs, "readFileSync" | "realpathSync"> }}
 *   input - Worker directories, environment, home directory and fs seam
 * @returns {{ file: string, dirs: Array<{ dir: string,
 *   trusted: true | false | "unknown" }> }} One row per directory
 */
export function trustStatus({ dirs, env, homedir, fs = nodeFs }) {
  const file = claudeStateFile({ env, homedir });
  let projects = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    projects =
      parsed && typeof parsed.projects === "object" ? parsed.projects : {};
  } catch {
    projects = null;
  }
  const realpath = dir => {
    try {
      return fs.realpathSync(dir);
    } catch {
      return dir;
    }
  };
  const entryFor = dir => {
    if (Object.hasOwn(projects, dir)) return projects[dir];
    const target = realpath(dir);
    const key = Object.keys(projects).find(
      candidate =>
        path.basename(candidate) === path.basename(dir) &&
        realpath(candidate) === target
    );
    return key === undefined ? undefined : projects[key];
  };
  return {
    file,
    dirs: dirs.map(dir => {
      if (projects === null) return { dir, trusted: "unknown" };
      return { dir, trusted: entryFor(dir)?.hasTrustDialogAccepted === true };
    }),
  };
}

/**
 * The last parseable record of a loop's run log, or null.
 * @param {string} file - `.lisa/automations/runs/<loop>.jsonl`
 * @param {Pick<typeof nodeFs, "readFileSync">} fs - Filesystem seam
 * @returns {{ ts: string, outcome: string | null } | null} Last record
 */
function lastRunRecord(file, fs) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n").filter(line => line.trim());
  for (const line of lines.reverse()) {
    try {
      const record = JSON.parse(line);
      if (
        typeof record?.ts === "string" &&
        !Number.isNaN(Date.parse(record.ts))
      ) {
        return { ts: record.ts, outcome: record.outcome ?? null };
      }
    } catch {
      // A torn or foreign line: keep looking further back.
    }
  }
  return null;
}

/**
 * How long a loop may go without a recorded run and still count as live:
 * twice the time the manager gives a silent worker before giving up on it
 * (`stall.noOutputMinutes × stall.maxAttempts`), and never under a day.
 * @param {{ noOutputMinutes?: number, maxAttempts?: number } | undefined} stall
 *   - The manager's stall settings
 * @returns {number} Milliseconds
 */
export function recentWindowMs(stall) {
  const minutes = (stall?.noOutputMinutes ?? 60) * (stall?.maxAttempts ?? 3);
  return Math.max(MIN_RECENT_MS, 2 * minutes * 60 * 1000);
}

/**
 * What this project's own run logs say about each competing intake loop.
 *
 * A loop with a recent recorded run is probably still scheduled and will
 * compete with the manager. A stale or missing log is evidence, not proof,
 * that it stopped: the runtime's scheduler (claude.ai routines, Codex
 * automations, GitHub Actions) is the authority, and setup lists it too.
 * @param {{ root: string, now: Date, stall?: object,
 *   fs?: Pick<typeof nodeFs, "readFileSync"> }} input - Project root, the
 *   current time, the manager's stall settings and fs seam
 * @returns {{ windowHours: number, loops: Array<{ loop: string,
 *   log: string, lastRun: { ts: string, outcome: string | null } | null,
 *   recent: boolean }> }} One row per competing loop
 */
export function coexistence({ root, now, stall, fs = nodeFs }) {
  const windowMs = recentWindowMs(stall);
  return {
    windowHours: windowMs / 3_600_000,
    loops: COMPETING_LOOPS.map(loop => {
      const log = path.join(
        root,
        ".lisa",
        "automations",
        "runs",
        `${loop}.jsonl`
      );
      const lastRun = lastRunRecord(log, fs);
      const recent =
        lastRun !== null && now.getTime() - Date.parse(lastRun.ts) <= windowMs;
      return { loop, log, lastRun, recent };
    }),
  };
}
