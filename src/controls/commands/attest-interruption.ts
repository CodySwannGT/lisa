/**
 * Removing a run's temporary folder when the run is told to stop.
 *
 * `lisa controls attest` builds a copy of the repository in a temporary
 * folder and removes it when the run is over. A run that is interrupted
 * never gets to "over", so the folder is also removed from a signal handler:
 * `SIGINT` (Ctrl-C), `SIGTERM` (the polite kill) and `SIGHUP` (the terminal
 * went away).
 *
 * The handler does three things and nothing else: it removes the folder, it
 * takes itself off every signal, and it sends the same signal to this process
 * again. With no handler left, that second signal ends the process the way
 * the first would have, so whoever is waiting sees an interrupted run and
 * not a clean exit.
 *
 * ## When the handler runs
 *
 * A proof spends most of its time waiting for a check to finish, and this
 * process cannot act on a signal while it waits. Ctrl-C at a terminal reaches
 * the check as well, which ends it, so the folder is removed at once. A
 * signal sent to this process alone is acted on when the check that is
 * running returns, which is no later than that proof's time limit.
 *
 * A handler that is never taken off would keep changing how the process
 * answers signals after the run, so {@link TerminationWatch.release} is
 * called on every way out.
 * @module controls/commands/attest-interruption
 */
import { rmSync, writeSync } from "node:fs";

/** The signals that end a run, in the order they are listened for. */
export const TERMINATION_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** One signal that ends a run. */
export type TerminationSignal = (typeof TERMINATION_SIGNALS)[number];

/** The file descriptor a line for the operator is written to. */
const STDERR = 2;

/** How often removing the folder is tried again when it is busy. */
const REMOVE_RETRIES = 5;

/** Where signals come from and go to, replaceable in a test. */
export interface SignalSource {
  /** Start listening for a signal. */
  readonly on: (signal: TerminationSignal, listener: () => void) => void;
  /** Stop listening for a signal. */
  readonly off: (signal: TerminationSignal, listener: () => void) => void;
  /** Send a signal to this process. */
  readonly raise: (signal: TerminationSignal) => void;
}

/** This process's own signals. */
export const PROCESS_SIGNALS: SignalSource = {
  on: (signal, listener) => {
    process.on(signal, listener);
  },
  off: (signal, listener) => {
    process.off(signal, listener);
  },
  raise: signal => {
    process.kill(process.pid, signal);
  },
};

/** A folder being watched over until the run lets go of it. */
export interface TerminationWatch {
  /** Stop listening. Safe to call more than once. */
  readonly release: () => void;
}

/** What watching a folder needs from outside, replaceable in a test. */
export interface TerminationOptions {
  /** Where signals come from; this process's own when left out. */
  readonly signals?: SignalSource;
  /** Tells the operator one line; standard error when left out. */
  readonly say?: (line: string) => void;
}

/**
 * Write one line for the operator without waiting and without ever throwing.
 * A line that cannot be written is dropped: the folder matters more.
 * @param line - The line
 */
function sayNow(line: string): void {
  try {
    writeSync(STDERR, `${line}\n`);
  } catch {
    // Standard error is closed or full. There is nobody to tell.
  }
}

/**
 * Remove a folder now, and say whether that worked.
 * @param folder - The folder
 * @returns Why it is still there, or `null` when it is gone
 */
function removeNow(folder: string): string | null {
  try {
    rmSync(folder, {
      force: true,
      maxRetries: REMOVE_RETRIES,
      recursive: true,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Remove a folder if this process is told to stop, then let the signal end
 * the process as it would have.
 * @param folder - The run's temporary folder; it need not exist yet
 * @param options - Where signals come from and where a line is said
 * @returns The watch; release it when the run is over
 */
export function removeOnTermination(
  folder: string,
  options: TerminationOptions = {}
): TerminationWatch {
  const signals = options.signals ?? PROCESS_SIGNALS;
  const say = options.say ?? sayNow;
  const listeners = TERMINATION_SIGNALS.map(signal => ({
    signal,
    listener: (): void => {
      const left = removeNow(folder);
      say(
        left === null
          ? "attest: interrupted. The temporary copy the proofs ran in was removed. Your repository was not changed."
          : `attest: interrupted. The temporary copy the proofs ran in could not be removed (${left}). Your repository was not changed. Remove this folder by hand: ${folder}`
      );
      release();
      signals.raise(signal);
    },
  }));
  /** Stop listening for every signal. */
  function release(): void {
    listeners.forEach(({ signal, listener }) => {
      signals.off(signal, listener);
    });
  }
  listeners.forEach(({ signal, listener }) => {
    signals.on(signal, listener);
  });
  return { release };
}
