/**
 * Contract tests for the session manager's config module.
 *
 * Every other session-manager module reads its settings through
 * `resolveSessionManagerConfig`, and every worker's launch directory comes from
 * `resolveRepoDir`. A default that drifts from the documented one, or a repo
 * key that resolves outside the project, would silently size the fleet wrong or
 * start a yolo-mode worker in the wrong checkout.
 * @module tests/unit/session-manager/config
 */
import { describe, expect, it } from "vitest";

import {
  SESSION_MANAGER_DEFAULTS,
  parseLoopInterval,
  resolveSessionManagerConfig,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/config.mjs";

/** The manager name every fixture uses. */
const NAME = "repo-a-manager";

/** A notify block every valid fixture shares. */
const NOTIFY = {
  provider: "telegram",
  stateDir: "~/.claude/channels/telegram-repo-a",
};

/**
 * Resolve, failing the test rather than the type checker when the block is
 * unexpectedly absent.
 * @param args - Same arguments as `resolveSessionManagerConfig`.
 * @returns The resolved block.
 */
function mustResolve(...args: Parameters<typeof resolveSessionManagerConfig>) {
  const resolved = resolveSessionManagerConfig(...args);
  if (!resolved) throw new Error("expected a resolved sessionManager block");
  return resolved;
}

describe("SESSION_MANAGER_DEFAULTS", () => {
  it("matches the documented defaults", () => {
    expect(SESSION_MANAGER_DEFAULTS).toEqual({
      interval: "5m",
      capacity: {
        maxWorkers: 6,
        gbPerWorker: 3,
        reserveGb: 8,
        cpuFraction: 0.75,
        maxLoadPerCore: 1.5,
      },
      stall: { noOutputMinutes: 60, maxAttempts: 3, requestionHours: 4 },
      notify: { provider: "telegram" },
    });
  });

  it("is frozen, so no caller can change another caller's defaults", () => {
    expect(Object.isFrozen(SESSION_MANAGER_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(SESSION_MANAGER_DEFAULTS.capacity)).toBe(true);
    expect(Object.isFrozen(SESSION_MANAGER_DEFAULTS.stall)).toBe(true);
  });
});

describe("resolveSessionManagerConfig", () => {
  it("returns null when neither file declares the block (opt-in)", () => {
    expect(resolveSessionManagerConfig({ tracker: "github" })).toBeNull();
    expect(resolveSessionManagerConfig({}, {})).toBeNull();
    expect(resolveSessionManagerConfig(undefined, undefined)).toBeNull();
  });

  it("fills every documented default around a minimal block", () => {
    const resolved = mustResolve({
      sessionManager: { name: NAME, notify: NOTIFY },
    });
    expect(resolved).toEqual({
      name: NAME,
      interval: "5m",
      repos: null,
      capacity: {
        maxWorkers: 6,
        gbPerWorker: 3,
        reserveGb: 8,
        cpuFraction: 0.75,
        maxLoadPerCore: 1.5,
      },
      stall: { noOutputMinutes: 60, maxAttempts: 3, requestionHours: 4 },
      notify: NOTIFY,
      trustedAuthorIds: null,
      operatorIds: null,
    });
  });

  it("lets a declared value win over its default, one key at a time", () => {
    const resolved = mustResolve({
      sessionManager: {
        name: NAME,
        interval: "10m",
        capacity: { maxWorkers: 2 },
        stall: { maxAttempts: 5 },
        notify: NOTIFY,
      },
    });
    expect(resolved.interval).toBe("10m");
    expect(resolved.capacity).toEqual({
      maxWorkers: 2,
      gbPerWorker: 3,
      reserveGb: 8,
      cpuFraction: 0.75,
      maxLoadPerCore: 1.5,
    });
    expect(resolved.stall).toEqual({
      noOutputMinutes: 60,
      maxAttempts: 5,
      requestionHours: 4,
    });
  });

  it("merges local over global per key, not per block", () => {
    const global = {
      sessionManager: {
        name: NAME,
        interval: "5m",
        capacity: { maxWorkers: 6, reserveGb: 16 },
        notify: NOTIFY,
      },
    };
    const local = {
      sessionManager: {
        capacity: { maxWorkers: 2 },
        notify: { stateDir: "~/.claude/channels/telegram-mine" },
      },
    };
    const resolved = mustResolve(global, local);
    expect(resolved.name).toBe(NAME);
    expect(resolved.capacity.maxWorkers).toBe(2);
    expect(resolved.capacity.reserveGb).toBe(16);
    expect(resolved.notify).toEqual({
      provider: "telegram",
      stateDir: "~/.claude/channels/telegram-mine",
    });
  });

  it("resolves a block declared only in the local file", () => {
    const resolved = mustResolve(
      { tracker: "github" },
      { sessionManager: { name: NAME, notify: NOTIFY } }
    );
    expect(resolved?.name).toBe(NAME);
  });

  it("defaults repos.root to projects and replaces hints arrays wholesale", () => {
    const resolved = mustResolve(
      {
        sessionManager: {
          name: NAME,
          notify: NOTIFY,
          repos: {
            entries: {
              api: { hints: ["NestJS", "API"] },
              web: { hints: ["Expo"] },
            },
          },
        },
      },
      {
        sessionManager: {
          repos: { entries: { api: { hints: ["migrations"] } } },
        },
      }
    );
    expect(resolved.repos).toEqual({
      root: "projects",
      entries: {
        api: { hints: ["migrations"] },
        web: { hints: ["Expo"] },
      },
    });
  });

  it("never mutates its inputs", () => {
    const global = {
      sessionManager: {
        name: NAME,
        capacity: { maxWorkers: 6 },
        notify: { ...NOTIFY },
      },
    };
    const local = { sessionManager: { capacity: { maxWorkers: 1 } } };
    const before = JSON.stringify([global, local]);
    resolveSessionManagerConfig(global, local);
    expect(JSON.stringify([global, local])).toBe(before);
  });

  it("ignores prototype-polluting keys", () => {
    const local = JSON.parse(
      '{"sessionManager":{"__proto__":{"polluted":true},"capacity":{"__proto__":{"polluted":true}}}}'
    );
    const resolved = mustResolve(
      { sessionManager: { name: NAME, notify: NOTIFY } },
      local
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((resolved as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      (resolved.capacity as Record<string, unknown>).polluted
    ).toBeUndefined();
  });
});

describe("re-exports", () => {
  it("exposes the validator's interval parser", () => {
    expect(parseLoopInterval("5m")).toBe(300);
  });
});
