/**
 * Who ran a cycle, so the tmux manager can hear about a second session
 * cycling in its project (CodySwannGT/lisa#4809).
 *
 * Only one session-manager loop should hand out work per project. #4496 left
 * the duplicate warning to the second session's own cycle, because the tmux
 * manager cannot see another session's `/loop`. An operator watching only the
 * manager's channel never heard about it. Now every `cycle` records
 * `cyclers[<identity>] = <ISO time>` in the ledger, and `status` reports as
 * `manager.otherCyclers` every recent cycler that is not the manager's own
 * tmux session, so the manager's cycle can warn too.
 *
 * Identity is `tmux:<session name>` when tmux names the caller's session
 * (the same probe `manager.self` uses), `pid:<parent pid>` outside tmux, and
 * `tmux-unknown:pid:<parent pid>` when that probe fails inside tmux. Nothing from
 * the environment and no credential is ever recorded. "Recent" is within
 * twice `sessionManager.interval`; older entries are pruned on every write so
 * the map stays small.
 * @module session-manager/cyclers
 */
import { requireConfig, run } from "./cli-runtime.mjs";
import { parseLoopInterval } from "./config.mjs";
import { buildCurrentSessionName } from "./launch.mjs";
import { updateLedger } from "./ledger.mjs";

/** Fallback when the interval does not parse: the config default, 5m. */
const DEFAULT_INTERVAL_SECONDS = 300;

/**
 * The tmux session the caller runs in, by asking tmux for the caller's own
 * `$TMUX_PANE` (#4496; see `buildCurrentSessionName` for why the pane is
 * always targeted). Nothing here throws.
 * @param {{ env: Record<string, string | undefined> }} ctx - CLI context
 * @returns {string | null | undefined} The session name; undefined outside
 *   tmux; null inside tmux when tmux cannot say which session it is
 */
export function callerSessionName(ctx) {
  if (!ctx.env.TMUX) return undefined;
  const argv = buildCurrentSessionName(ctx.env.TMUX_PANE);
  if (argv === null) return null;
  const probe = run("tmux", argv, { env: ctx.env });
  const current = probe.status === 0 ? probe.stdout.trim() : "";
  return current === "" ? null : current;
}

/** Prefix for an in-tmux cycle whose session tmux could not name. */
const UNRESOLVED_PREFIX = "tmux-unknown:";

/**
 * The identity a cycle records: `tmux:<session>` when tmux names the
 * caller's session, `pid:<parent pid>` outside tmux, and
 * `tmux-unknown:pid:<parent pid>` inside tmux when the probe fails. The last
 * may be the manager itself on a transient probe failure, so `otherCyclers`
 * never counts it as another session.
 * @param {{ env: Record<string, string | undefined> }} ctx - CLI context
 * @returns {string} Identity
 */
function cyclerIdentity(ctx) {
  const session = callerSessionName(ctx);
  if (typeof session === "string") return `tmux:${session}`;
  const pid = `pid:${process.ppid}`;
  return session === null ? `${UNRESOLVED_PREFIX}${pid}` : pid;
}

/**
 * How far back a cycle still counts as recent: twice the loop interval.
 * @param {{ interval?: string }} config - sessionManager block
 * @returns {number} Window in milliseconds
 */
function windowMs(config) {
  const seconds =
    parseLoopInterval(config.interval) ?? DEFAULT_INTERVAL_SECONDS;
  return 2 * seconds * 1000;
}

/**
 * The entries of a cyclers map recorded within the window before `now`.
 * An entry whose time does not parse is dropped.
 * @param {Record<string, string> | undefined} cyclers - Identity to ISO time
 * @param {number} nowMs - Now, in epoch milliseconds
 * @param {number} window - Window in milliseconds
 * @returns {[string, string][]} Recent `[identity, at]` pairs
 */
function recentEntries(cyclers, nowMs, window) {
  return Object.entries(cyclers ?? {}).filter(([, at]) => {
    const atMs = Date.parse(at);
    return Number.isFinite(atMs) && nowMs - atMs <= window;
  });
}

/**
 * Every recent cycler that is not the manager's own tmux session, newest
 * first, for `status` `manager.otherCyclers`. An unresolved in-tmux cycle is
 * left out: it may be the manager's own cycle on a failed probe.
 * @param {{ cyclers?: Record<string, string> }} ledger - Ledger
 * @param {{ name: string, interval?: string }} config - sessionManager block
 * @param {Date} now - Current time
 * @returns {{by: string, at: string}[]} Other recent cyclers
 */
export function otherCyclers(ledger, config, now) {
  const self = `tmux:${config.name}`;
  return recentEntries(ledger.cyclers, now.getTime(), windowMs(config))
    .filter(([by]) => by !== self && !by.startsWith(UNRESOLVED_PREFIX))
    .map(([by, at]) => ({ by, at }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * `cycle`: record that this session ran a cycle now, pruning entries older
 * than twice the interval. The skill runs it at the start of every cycle.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: {by: string, at: string} }>} What was recorded
 */
export async function cycle(ctx) {
  const config = requireConfig(ctx);
  const by = cyclerIdentity(ctx);
  const json = await updateLedger(ctx.root, { now: ctx.now }, (ledger, at) => {
    const kept = recentEntries(
      ledger.cyclers,
      Date.parse(at),
      windowMs(config)
    );
    const cyclers = { ...Object.fromEntries(kept), [by]: at };
    return { ledger: { ...ledger, cyclers }, result: { by, at } };
  });
  return { json };
}
