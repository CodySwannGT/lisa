/**
 * Hand a hook the event a coding agent hands it: the event on standard input,
 * written through a pipe by a process of its own, which closes its end when
 * it is done (CodySwannGT/lisa#5067).
 *
 * Not through `spawnSync`'s `input`, because on macOS that hand-off sometimes
 * never ends. Measured on an 18-core Mac with Node 22.22.0 and no load added,
 * one child at a time, a hook of `cat >/dev/null; echo … >&2; exit 2`:
 *
 * | event | `spawnSync` `input` hung | this hand-off hung |
 * |---|---|---|
 * | 200 bytes | 0 of 4,300 | — |
 * | 65,600 bytes | 11 of 4,300 | — |
 * | 1 MiB | 27 of 10,700 | 0 of 4,300 |
 *
 * A hung run sat for the whole timeout against a 6-15ms median, with nothing
 * on standard error. Caught in the act, the hook's `cat` was asleep reading a
 * unix socket whose other end was still open in the Node parent. Both ends
 * showed empty send and receive queues, and the parent was idle in `kevent`
 * inside `spawnSync`'s loop. Nothing was in flight and the end of input never
 * came. That is the `ETIMEDOUT` that hit the carrier suite's "reads … whole
 * event" cases in real pre-push runs at only a 1.26-1.40x measured slowdown,
 * always at the full budget and always with empty output. Making the event
 * smaller does not avoid it, as the 65,600-byte row shows.
 *
 * A writer that exits closes its end however the parent's loop behaves, so
 * the hook always reaches the end of the event.
 * @module tests/support/agent-event-handoff
 */
import { type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

/**
 * The agent's side of the hand-off, as a shell runs it: write the event file
 * into a pipe the hook reads as standard input, and record in a second file
 * when that write fails because the hook closed its end first.
 *
 * `$1` is the event file, `$2` the file that records a failed write, and `$3`
 * the hook command. SIGPIPE is ignored on the writer's side only, so a hook
 * that exits unread turns into a failed write the caller can see, and the hook
 * itself runs with the signal dispositions it would have under the agent.
 */
const AGENT_HANDOFF =
  '{ trap "" PIPE; cat "$1" 2>/dev/null || : >"$2"; } | /bin/sh -c "$3"';

/** One hook to start, and the event to hand it. */
export interface EventHandoff {
  /** Names the hook in a diagnostic. */
  readonly label: string;
  /** The hook command, for a POSIX shell. */
  readonly command: string;
  /** Where the hook starts. */
  readonly cwd: string;
  /** The hook's whole environment. */
  readonly env: NodeJS.ProcessEnv;
  /** The event, written to the hook as JSON. */
  readonly event: unknown;
}

/**
 * Start a hook with an event on standard input, the way an agent does.
 *
 * A hook that exits without reading the whole event fails the call, as it
 * fails the agent's write. That is certain only for an event larger than the
 * pipe buffer; a smaller one fits the pipe before the hook exits.
 * @param handoff - The hook and its event
 * @returns The finished hook
 */
export function handOffEvent(handoff: EventHandoff): SpawnSyncReturns<string> {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-agent-event-"));
  try {
    const eventFile = path.join(folder, "event.json");
    const unread = path.join(folder, "unread");
    writeFileSync(eventFile, JSON.stringify(handoff.event));
    const hook = boundedSpawnSync({
      label: handoff.label,
      command: "/bin/sh",
      args: ["-c", AGENT_HANDOFF, "agent", eventFile, unread, handoff.command],
      cwd: handoff.cwd,
      env: handoff.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (existsSync(unread)) {
      throw new Error(
        `${handoff.label} exited with status ${String(hook.status)} before ` +
          `reading the whole event: the agent's write failed because the hook ` +
          `had closed its standard input. A hook must read its event before ` +
          `it answers, or the agent's write fails with EPIPE ` +
          `(CodySwannGT/lisa#5057).`
      );
    }
    return hook;
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
}
