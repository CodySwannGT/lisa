/** One absolute wall-clock deadline shared by every health collaborator. */
/* eslint-disable jsdoc/require-returns -- typed deadline helpers are self-describing */
import { performance } from "node:perf_hooks";

const MAX_DEADLINE_MS = 119_000;

/** Absolute monotonic deadline and cancellation signal. */
export class HealthDeadline {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly expired: Promise<void>;
  private readonly expiresAt: number;
  private readonly timer: NodeJS.Timeout;

  /**
   * Start a deadline immediately, before any project setup or detection.
   * @param requestedMs - Requested total budget
   */
  constructor(requestedMs: number) {
    const duration = Math.max(1, Math.min(requestedMs, MAX_DEADLINE_MS));
    this.signal = this.controller.signal;
    this.expiresAt = performance.now() + duration;
    this.expired = new Promise(resolve => {
      this.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    this.timer = setTimeout(() => this.controller.abort(), duration);
    this.timer.unref();
  }

  /** Remaining whole milliseconds available to a bounded command. */
  remainingMs(): number {
    return Math.max(0, Math.floor(this.expiresAt - performance.now()));
  }

  /**
   * Race one collaborator against the shared absolute deadline.
   * @param work - Lazy collaborator so expired work never starts
   * @param fallback - Value returned on timeout or collaborator failure
   * @returns Work result or fallback
   */
  async run<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    if (this.signal.aborted || this.remainingMs() === 0) return fallback;
    return Promise.race([
      work().catch(() => fallback),
      this.expired.then(() => fallback),
    ]);
  }

  /** Release the deadline timer after collection finishes. */
  close(): void {
    clearTimeout(this.timer);
  }
}
/* eslint-enable jsdoc/require-returns -- restore repository documentation defaults */
