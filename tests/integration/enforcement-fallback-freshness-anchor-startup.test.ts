/**
 * The optional anchor must not acquire an unbounded setup phase before its
 * independent timer. Faults reach the released second Bash or group census
 * while the outer dispatcher and genuine file-backed guards remain intact.
 * @module tests/integration/enforcement-fallback-freshness-anchor-startup
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanupScratchRoots } from "../helpers/enforcement-fallback-fixtures.js";
import { observeDeadline } from "../helpers/freshness-deadline-fixture.js";
import { SELECTED_GUARDS } from "../helpers/host-guard-freshness-fixtures.js";

const EARLY_PARENT_EXIT = "early-parent-exit";
const MATCHING_TEMPLATE = "matches installed template";

afterEach(cleanupScratchRoots);

describe("optional freshness anchor startup", () => {
  it.each([
    ["missing-handshake", false],
    ["missing-handshake", true],
    ["partial-handshake", false],
    ["partial-handshake", true],
    ["group-absent", false],
    ["group-absent", true],
    [EARLY_PARENT_EXIT, false],
    [EARLY_PARENT_EXIT, true],
  ] as const)(
    "fails closed and drains owned startup for %s, allowed=%s",
    async (mode, allowed) => {
      const result = await observeDeadline(mode, allowed);
      expect(result.phases).toEqual([mode]);
      expect(result.timedOut).toBe(false);
      expect(result.status).toBe(allowed ? 0 : 2);
      expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
      if (mode !== EARLY_PARENT_EXIT) {
        expect(result.entered).toBe(false);
        expect(result.helperPids).toEqual([]);
      }
      // Early controller exit may race producer entry; neither path may leak
      // or accept incomplete facts. Cleanup is observed before fixture teardown.
      expect(result.survivingPids).toEqual([]);
      expect(result.diagnosticScratchLeaves).toEqual([]);
      expect(result.stateUnchanged).toBe(true);
      expect(result.foreignSentinelUnchanged).toBe(true);
      expect(result.output).toContain("host content unknown");
      expect(result.output).not.toContain("9.9.9");
      expect(result.output).not.toContain(MATCHING_TEMPLATE);
    }
  );

  it.each([
    ["anchor-startup", false],
    ["anchor-startup", true],
    ["anchor-qualification", false],
    ["anchor-qualification", true],
  ] as const)(
    "preserves every real guard for %s, allowed=%s",
    async (mode, allowed) => {
      const result = await observeDeadline(mode, allowed);
      expect(result.entered).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.status).toBe(allowed ? 0 : 2);
      expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
      expect(result.diagnosticMs).not.toBeNull();
      expect(result.diagnosticMs).toBeLessThanOrEqual(3_000);
      expect(result.survivingPids).toEqual([]);
      expect(result.diagnosticScratchLeaves).toEqual([]);
      expect(result.stateUnchanged).toBe(true);
      expect(result.foreignSentinelUnchanged).toBe(true);
      // Removing the old startup boundary legitimately yields complete facts.
      expect(result.output).toContain("4.72.7");
      expect(result.output).toContain("4.33.1");
      expect(result.output).toContain(MATCHING_TEMPLATE);
      expect(result.phases).toEqual([]);
    }
  );

  it.each([false, true])(
    "keeps intact complete evidence and genuine allowed=%s sibling",
    async allowed => {
      const result = await observeDeadline("normal", allowed);
      expect(result.entered).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.status).toBe(allowed ? 0 : 2);
      expect(result.guards).toEqual(SELECTED_GUARDS.map(name => `${name}.sh`));
      expect(result.stateUnchanged).toBe(true);
      expect(result.survivingPids).toEqual([]);
      expect(result.diagnosticScratchLeaves).toEqual([]);
      expect(result.output).toContain(MATCHING_TEMPLATE);
      expect(result.output).toContain("4.72.7");
      expect(result.output).toContain("4.33.1");
    }
  );
});
