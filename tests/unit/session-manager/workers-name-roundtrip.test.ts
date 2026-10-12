/**
 * Round-trip tests for worker names: every name `buildWorkerName` produces must
 * parse back to the same token, and `findLiveWorker` must find it by its ref.
 *
 * The failure this pins is quiet and expensive. A ref whose number has four or
 * more digits (`PROJ-1234`) once parsed with a lazy token as `PROJ`, so the
 * live-worker guard never fired and every cycle could start another worker on
 * the same item.
 * @module tests/unit/session-manager/workers-name-roundtrip
 */
import { describe, expect, it } from "vitest";

import {
  buildWorkerName,
  findLiveWorker,
  normalizeAgents,
  parseWorkerName,
  sanitizeRefToken,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs";

const NOW = new Date(2026, 9, 12, 15, 30);

const REFS = [
  "PROJ-1234",
  "PROJ-12",
  "PROJ-123456",
  "owner/repo#1234",
  "A-1",
  "X-1111-2222",
];

/**
 * Wrap a session name as one active `claude agents --json` row.
 * @param name - Session name
 * @returns Normalized rows
 */
function liveAgents(name: string) {
  return normalizeAgents([{ name, pid: 1, status: "busy" }]);
}

describe("worker name round-trip", () => {
  it.each(REFS)("parses %s back to its own token", ref => {
    const name = buildWorkerName(ref, NOW);
    expect(parseWorkerName(name)).toEqual({
      token: sanitizeRefToken(ref),
      stamp: "1012-1530",
      suffix: null,
    });
  });

  it.each(REFS)("keeps the token of %s with a collision suffix", ref => {
    const first = buildWorkerName(ref, NOW);
    const second = buildWorkerName(ref, NOW, [first]);
    expect(second).toBe(`${first}-2`);
    expect(parseWorkerName(second)).toEqual({
      token: sanitizeRefToken(ref),
      stamp: "1012-1530",
      suffix: 2,
    });
  });

  it.each(REFS)("finds the live worker for %s", ref => {
    const name = buildWorkerName(ref, NOW);
    expect(findLiveWorker(liveAgents(name), ref)?.name).toBe(name);
    expect(findLiveWorker(liveAgents(`${name}-2`), ref)?.name).toBe(
      `${name}-2`
    );
  });

  it("never lets PROJ-123 or PROJ answer for a PROJ-1234 worker", () => {
    const agents = liveAgents(buildWorkerName("PROJ-1234", NOW));
    expect(findLiveWorker(agents, "PROJ-123")).toBeNull();
    expect(findLiveWorker(agents, "PROJ")).toBeNull();
    expect(findLiveWorker(agents, "PROJ-12345")).toBeNull();
  });

  it("keeps a ref ending in -dddd-dddd distinct from its prefix", () => {
    const agents = liveAgents(buildWorkerName("X-1111-2222", NOW));
    expect(findLiveWorker(agents, "X")).toBeNull();
    expect(findLiveWorker(agents, "X-1111")).toBeNull();
  });
});
