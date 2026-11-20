/**
 * Every packument read the self-pin check makes ends at a deadline that covers
 * the body (CodySwannGT/lisa#5094).
 *
 * The read had no AbortSignal and no deadline, and in a real pre-push it held
 * one ESTABLISHED registry connection for about 74 minutes before failing
 * "network: terminated". These cases inject a registry that never answers and
 * one whose body never ends, and drive every timer the script arms by hand, so
 * no case touches the network or waits on a clock. Against the unbounded read
 * no timer is ever armed and the call never settles, which the driver reports
 * as a stall rather than hanging the run.
 * @module tests/unit/scripts/check-self-dependency-pin-deadline
 */
import { describe, expect, it } from "vitest";

import {
  awaitListed,
  checkSelfPin,
  newestInstallableVersion,
  PACKUMENT_ATTEMPT_TIMEOUT_MS,
  SELF_PACKAGE,
} from "../../../scripts/check-self-dependency-pin.mjs";

const REGISTRY = "https://registry.example.test";

/** The abbreviated install document's media type. */
const ABBREVIATED = "application/vnd.npm.install-v1+json";

/** How many event-loop turns the driver allows before calling a run stalled. */
const STALL_TURNS = 50;

/** Returned by the driver when the run never settled. */
const STALLED = "stalled";

/** One timer the script armed and the driver has not fired yet. */
interface ArmedTimer {
  /** What the script asked to run when the deadline passes. */
  readonly expire: () => void;
  /** The deadline the script asked for. */
  readonly ms: number;
}

/**
 * Deadline seams whose timers the test fires by hand.
 * @returns The seams to inject, the timers armed, and those cleared.
 */
function manualTimers(): {
  seams: {
    setAttemptTimer: (expire: () => void, ms: number) => ArmedTimer;
    clearAttemptTimer: (timer: ArmedTimer) => void;
  };
  armed: ArmedTimer[];
  cleared: ArmedTimer[];
} {
  const armed: ArmedTimer[] = [];
  const cleared: ArmedTimer[] = [];
  return {
    seams: {
      setAttemptTimer: (expire, ms) => {
        const timer = { expire, ms };
        armed.push(timer);
        return timer;
      },
      clearAttemptTimer: timer => {
        cleared.push(timer);
      },
    },
    armed,
    cleared,
  };
}

/**
 * Let a run proceed, firing each armed deadline once the run is parked on it.
 * @param run - The call under test.
 * @param armed - The timers the run arms, in order.
 * @returns The run's outcome, or {@link STALLED} if it never settled.
 */
async function settleOrStall<T>(
  run: Promise<T>,
  armed: readonly ArmedTimer[]
): Promise<T | typeof STALLED> {
  const state: { done: boolean; value?: T } = { done: false };
  void run.then(value => {
    state.done = true;
    state.value = value;
  });
  const fired = new Set<ArmedTimer>();
  for (let turn = 0; turn < STALL_TURNS; turn += 1) {
    await new Promise(resolve => setImmediate(resolve));
    if (state.done) return state.value as T;
    const next = armed.find(timer => !fired.has(timer));
    if (next !== undefined) {
      fired.add(next);
      next.expire();
    }
  }
  return STALLED;
}

/**
 * A promise that settles only when the signal aborts, as fetch does.
 * @param signal - The request's signal, if any.
 * @returns A promise rejecting with an AbortError on abort.
 */
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = (): void => {
      reject(new DOMException("This operation was aborted", "AbortError"));
    };
    if (signal?.aborted === true) abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * A registry whose packument never answers at all.
 * @returns The fetch stand-in and the accept headers it was asked for.
 */
function neverAnswers(): { fetchImpl: typeof fetch; accepts: string[] } {
  const accepts: string[] = [];
  const impl = (_url: string, init?: RequestInit): Promise<never> => {
    accepts.push(
      String((init?.headers as Record<string, string> | undefined)?.accept)
    );
    return untilAborted(init?.signal ?? undefined);
  };
  return { fetchImpl: impl as unknown as typeof fetch, accepts };
}

/**
 * A registry that sends packument headers and then never finishes the body.
 * @returns The fetch stand-in and how many body reads were started.
 */
function bodyNeverEnds(): { fetchImpl: typeof fetch; bodyReads: number[] } {
  const bodyReads: number[] = [];
  const impl = async (_url: string, init?: RequestInit): Promise<unknown> => ({
    ok: true,
    status: 200,
    json: (): Promise<never> => {
      bodyReads.push(1);
      return untilAborted(init?.signal ?? undefined);
    },
  });
  return { fetchImpl: impl as unknown as typeof fetch, bodyReads };
}

/** A manifest declaring the self pin. */
const MANIFEST = { devDependencies: { [SELF_PACKAGE]: "^4.0.0" } };

/** An injected sleep that does not wait. */
const noSleep = async (): Promise<void> => undefined;

describe("the self-pin packument read is bounded (#5094)", () => {
  it("ends each attempt at its deadline when the registry never answers", async () => {
    const { seams, armed, cleared } = manualTimers();
    const { fetchImpl, accepts } = neverAnswers();
    const outcome = await settleOrStall(
      checkSelfPin({
        manifest: MANIFEST,
        registry: REGISTRY,
        fetchImpl,
        sleep: noSleep,
        attemptTimeoutMs: 25,
        ...seams,
      }),
      armed
    );
    expect(outcome).toMatchObject({
      verdict: "unprovable",
      detail: `network: attempt exceeded 25ms deadline (${REGISTRY}/${SELF_PACKAGE})`,
    });
    expect(accepts).toEqual([ABBREVIATED, ABBREVIATED, ABBREVIATED]);
    expect(armed.map(timer => timer.ms)).toEqual([25, 25, 25]);
    expect(cleared).toEqual(armed);
  });

  it("ends each attempt at its deadline when the body never ends", async () => {
    const { seams, armed, cleared } = manualTimers();
    const { fetchImpl, bodyReads } = bodyNeverEnds();
    const outcome = await settleOrStall(
      checkSelfPin({
        manifest: MANIFEST,
        registry: REGISTRY,
        fetchImpl,
        sleep: noSleep,
        ...seams,
      }),
      armed
    );
    expect(outcome).toMatchObject({
      verdict: "unprovable",
      detail: `network: attempt exceeded ${String(PACKUMENT_ATTEMPT_TIMEOUT_MS)}ms deadline (${REGISTRY}/${SELF_PACKAGE})`,
    });
    expect(bodyReads).toHaveLength(3);
    expect(armed).toHaveLength(3);
    expect(cleared).toEqual(armed);
  });

  it("bounds the newest-installable read the same way", async () => {
    const { seams, armed } = manualTimers();
    const { fetchImpl } = bodyNeverEnds();
    const outcome = await settleOrStall(
      newestInstallableVersion({
        registry: REGISTRY,
        fetchImpl,
        sleep: noSleep,
        ...seams,
      }),
      armed
    );
    expect(outcome).toMatchObject({ version: null });
    expect(JSON.stringify(outcome)).toContain("attempt exceeded");
    expect(armed).toHaveLength(3);
  });

  it("bounds every awaited-listed read and keeps to the poll budget", async () => {
    const { seams, armed, cleared } = manualTimers();
    const { fetchImpl, bodyReads } = bodyNeverEnds();
    const outcome = await settleOrStall(
      awaitListed({
        version: "7.0.0",
        registry: REGISTRY,
        fetchImpl,
        polls: 2,
        sleep: noSleep,
        ...seams,
      }),
      armed
    );
    expect(outcome).toMatchObject({ listed: false });
    expect(JSON.stringify(outcome)).toContain("attempt exceeded");
    expect(bodyReads).toHaveLength(4);
    expect(armed).toHaveLength(4);
    expect(new Set(cleared)).toEqual(new Set(armed));
  });
});
