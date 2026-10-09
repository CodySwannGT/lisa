/**
 * A stalled optional process must not hold real enforcement or promote partial
 * evidence. These are reaching CLI controls with a calibrated completion
 * watchdog and an unscaled three-second optional-boundary assertion.
 * @module tests/integration/enforcement-fallback-freshness-deadline
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanupScratchRoots } from "../helpers/enforcement-fallback-fixtures.js";
import { observeDeadline } from "../helpers/freshness-deadline-fixture.js";
import type { DeadlineObservation } from "../helpers/freshness-deadline-fixture.js";
import { SELECTED_GUARDS } from "../helpers/host-guard-freshness-fixtures.js";

afterEach(cleanupScratchRoots);

const UNKNOWN = "host content unknown";

/**
 * Check production cleanup before the broad fixture teardown runs.
 * @param result Actual completed dispatcher observation.
 */
function expectDiagnosticCleanup(result: DeadlineObservation): void {
  expect(result.diagnosticScratchLeaves).toEqual([]);
  expect(result.output).not.toContain("unbound variable");
}

describe("optional freshness diagnostic deadline", () => {
  it("reaches a stalled helper and still dispatches all real guards with the original refusal", async () => {
    const result = await observeDeadline();
    expectDiagnosticCleanup(result);
    expect(result.entered).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(2);
    expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
    expect(result.diagnosticMs).toBeLessThanOrEqual(3_000);
    expect(result.survivingPids).toEqual([]);
    expect(result.stateUnchanged).toBe(true);
    expect(result.output).toContain(UNKNOWN);
    expect(result.output).not.toContain("installed 9.9.9");
  });

  it.each([false, true])(
    "preserves real complete helper and allowed=%s controls",
    async allowed => {
      const result = await observeDeadline("normal", allowed);
      expectDiagnosticCleanup(result);
      expect(result.entered).toBe(true);
      expect(result.status).toBe(allowed ? 0 : 2);
      expect(result.timedOut).toBe(false);
      expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
      expect(result.survivingPids).toEqual([]);
      expect(result.stateUnchanged).toBe(true);
      expect(result.output).toContain("4.72.7");
      expect(result.output).toContain("4.33.1");
      expect(result.output).toContain("matches installed template");
    }
  );

  it("preserves a genuine allowed command after a stalled optional helper", async () => {
    const result = await observeDeadline("stall", true);
    expectDiagnosticCleanup(result);
    expect(result.entered).toBe(true);
    expect(result.status).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
    expect(result.diagnosticMs).toBeLessThanOrEqual(3_000);
    expect(result.survivingPids).toEqual([]);
    expect(result.output).not.toContain("9.9.9");
  });

  it.each([
    "missing-runner",
    "failed",
    "incomplete",
    "duplicate",
    "malformed",
    "unknown",
    "trailing",
    "unsafe-tmp",
  ])(
    "discards %s machinery or incomplete facts without changing genuine refusal",
    async mode => {
      const result = await observeDeadline(mode);
      expectDiagnosticCleanup(result);
      expect(result.entered).toBe(
        !["missing-runner", "unsafe-tmp"].includes(mode)
      );
      expect(result.status).toBe(2);
      expect(result.timedOut).toBe(false);
      expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
      expect(result.output).toContain(UNKNOWN);
      expect(result.output).not.toContain("9.9.9");
      expect(result.survivingPids).toEqual([]);
      expect(result.stateUnchanged).toBe(true);
      expect(result.foreignSentinelUnchanged).toBe(true);
    }
  );

  it("remains bounded when ps fails after actual helper startup", async () => {
    const result = await observeDeadline("post-start-ps-failure");
    expectDiagnosticCleanup(result);
    expect(result.entered).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(2);
    expect(result.diagnosticMs).toBeLessThanOrEqual(3_000);
    expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
    expect(result.survivingPids).toEqual([]);
    expect(result.output).toContain(UNKNOWN);
  });

  it("drains a background descendant after a complete successful helper", async () => {
    const result = await observeDeadline("surviving-child");
    expectDiagnosticCleanup(result);
    expect(result.entered).toBe(true);
    expect(result.status).toBe(2);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("matches installed template");
    expect(result.output).toContain("4.72.7");
    expect(result.survivingPids).toEqual([]);
    expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
  });
});
