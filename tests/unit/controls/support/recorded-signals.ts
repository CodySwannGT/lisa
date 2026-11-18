/**
 * A stand-in for a process's signals, for suites about what
 * `lisa controls attest` does when it is told to stop
 * (CodySwannGT/lisa#4996).
 *
 * Nothing is ever sent to the process running the suite. A signal is
 * "delivered" by calling whoever is listening, and a signal the code under
 * test sends on is only written down.
 * @module tests/unit/controls/support/recorded-signals
 */
import {
  TERMINATION_SIGNALS,
  type SignalSource,
  type TerminationSignal,
} from "../../../../src/controls/commands/attest-interruption.js";

/** Signals that are only written down, never sent. */
export interface RecordedSignals extends SignalSource {
  /** Every signal sent to this process, in order. */
  readonly raised: TerminationSignal[];
  /** Deliver a signal to whoever is listening for it. */
  readonly deliver: (signal: TerminationSignal) => void;
  /** How many listeners there are over all the signals that end a run. */
  readonly listeners: () => number;
}

/**
 * Build a stand-in for the process's signals.
 * @returns The stand-in
 */
export function recordedSignals(): RecordedSignals {
  const listening = new Map<TerminationSignal, (() => void)[]>();
  const raised: TerminationSignal[] = [];
  const at = (signal: TerminationSignal): (() => void)[] =>
    listening.get(signal) ?? [];
  return {
    raised,
    on: (signal, listener) => {
      listening.set(signal, [...at(signal), listener]);
    },
    off: (signal, listener) => {
      listening.set(
        signal,
        at(signal).filter(kept => kept !== listener)
      );
    },
    raise: signal => {
      raised.push(signal);
    },
    deliver: signal => {
      [...at(signal)].forEach(listener => {
        listener();
      });
    },
    listeners: () =>
      TERMINATION_SIGNALS.reduce(
        (total, signal) => total + at(signal).length,
        0
      ),
  };
}

/**
 * Count this process's own listeners for the signals that end a run.
 * @returns The number of listeners over all of them
 */
export function processSignalListeners(): number {
  return TERMINATION_SIGNALS.reduce(
    (total, signal) => total + process.listenerCount(signal),
    0
  );
}
