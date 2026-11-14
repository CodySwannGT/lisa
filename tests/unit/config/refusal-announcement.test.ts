/** A refused run says so at the top of its transcript and again at the foot. */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  POOL_WORKER_ENV,
  announceRefusal,
  armRefusalSummary,
  renderRefusalNotice,
  renderRefusalSummary,
} from "../../../src/configs/vitest/refusal-announcement.js";

const REASON = "coverage.include matched no files";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * Remove and return the exit listeners registered since `before`.
 * @param before - Listeners present beforehand
 * @returns The listeners added since, now detached
 */
function detachExitListenersSince(
  before: ReadonlySet<unknown>
): readonly (() => void)[] {
  const added = process
    .listeners("exit")
    .filter(listener => !before.has(listener));
  for (const listener of added) process.off("exit", listener);
  return added as (() => void)[];
}

/**
 * The exit listeners `fn` adds, removed again so they never fire for real.
 * @param fn - Code that may register exit listeners
 * @returns The listeners it added
 */
function exitListenersAddedBy(fn: () => void): readonly (() => void)[] {
  const before = new Set<unknown>(process.listeners("exit"));
  fn();
  return detachExitListenersSince(before);
}

describe("renderRefusalNotice", () => {
  it("names the reason and says the zeroes below are not a verdict", () => {
    const notice = renderRefusalNotice(REASON);
    expect(notice).toContain("TEST RUN REFUSED TO START");
    expect(notice).toContain(REASON);
    expect(notice).toContain("not a verdict on the code");
  });
});

describe("renderRefusalSummary", () => {
  it("is exactly one line carrying the reason", () => {
    const summary = renderRefusalSummary(REASON);
    expect(summary.endsWith("\n")).toBe(true);
    expect(summary.trimEnd().split("\n")).toHaveLength(1);
    expect(summary).toContain("NO VERDICT");
    expect(summary).toContain(`Reason: ${REASON}`);
  });
});

describe("armRefusalSummary", () => {
  it("writes the summary line when the process exits", () => {
    const write = vi.fn();
    const added = exitListenersAddedBy(() => armRefusalSummary(REASON, write));
    expect(added).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
    added[0]?.();
    expect(write).toHaveBeenCalledWith(renderRefusalSummary(REASON));
  });
});

describe("announceRefusal", () => {
  it("prints the banner now and arms the summary from the main process", () => {
    vi.stubEnv(POOL_WORKER_ENV, undefined);
    const writeNotice = vi.fn();
    const added = exitListenersAddedBy(() =>
      announceRefusal(REASON, writeNotice)
    );
    expect(writeNotice).toHaveBeenCalledWith(renderRefusalNotice(REASON));
    expect(added).toHaveLength(1);
  });

  it("says nothing from a pool worker, which cannot refuse a run", () => {
    vi.stubEnv(POOL_WORKER_ENV, "1");
    const writeNotice = vi.fn();
    const added = exitListenersAddedBy(() =>
      announceRefusal(REASON, writeNotice)
    );
    expect(writeNotice).not.toHaveBeenCalled();
    expect(added).toHaveLength(0);
  });

  it("is what this test process is: a pool worker", () => {
    expect(process.env[POOL_WORKER_ENV]).toBeDefined();
  });
});
