import { AsyncLocalStorage } from "node:async_hooks";
import { TestRunner } from "vitest";

import { publishTimedInvocation } from "./timed-invocation.js";

/** Timing fields read from Vitest's native deadline, in its own clock domain. */
interface NativeDeadline {
  readonly startTime: number;
  readonly endTime: number;
  remaining(): number;
}

/**
 * Read the deadline assigned by Vitest 5's timed test and hook wrapper.
 * The installed runtime sets and restores this property across each native
 * invocation. Keep that state local to each asynchronous chain.
 */
export default class ChildBudgetTestRunner extends TestRunner {
  readonly #deadlines = new AsyncLocalStorage<NativeDeadline | undefined>();

  /**
   * Publish native clock observations without replacing the native timer.
   * @param config - The resolved Vitest runner configuration
   */
  constructor(config: ConstructorParameters<typeof TestRunner>[0]) {
    super(config);
    publishTimedInvocation(() => {
      const deadline = this.#deadlines.getStore();
      return (
        deadline && {
          startedAtMs: deadline.startTime,
          timeoutMs: deadline.endTime - deadline.startTime,
          nowMs: deadline.endTime - deadline.remaining(),
        }
      );
    });
  }

  /**
   * Read the current deadline before Vitest replaces it with a nested one.
   * @returns The deadline Vitest will restore when the nested invocation ends
   */
  get _deadline(): NativeDeadline | undefined {
    return this.#deadlines.getStore();
  }

  /**
   * Record the deadline the native wrapper assigns or restores.
   * @param deadline - The active Vitest deadline, if one exists
   */
  set _deadline(deadline: NativeDeadline | undefined) {
    this.#deadlines.enterWith(deadline);
  }
}
