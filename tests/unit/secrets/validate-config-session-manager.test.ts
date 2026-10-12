/**
 * Contract tests for the opt-in `sessionManager` config block.
 *
 * The block configures a loop that starts bypass-permissions sessions and a
 * bot that relays answers into them, so a malformed field is not cosmetic: a
 * bad name strands the tmux session, a missing state dir shares one bot across
 * projects, and a token in committed config leaks the keys to a shell. Each
 * case turns one of those into a doctor-time message instead.
 *
 * Split from `validate-config.test.ts` to keep each file under the line cap.
 * @module tests/unit/secrets/validate-config-session-manager
 */
import { describe, expect, it } from "vitest";

import {
  parseLoopInterval,
  validateSessionManager,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";

describe("sessionManager block", () => {
  /** The smallest block a project can run with: name plus where the bot lives. */
  const minimal = {
    name: "repo-a-manager",
    notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-x" },
  };

  /** A fully spelled-out multi-repo block, every field at a legal value. */
  const full = {
    ...minimal,
    interval: "5m",
    repos: {
      root: "projects",
      entries: {
        api: { hints: ["NestJS", "migrations"] },
        web: { hints: ["Expo"] },
      },
    },
    capacity: {
      maxWorkers: 6,
      gbPerWorker: 3,
      reserveGb: 8,
      cpuFraction: 0.75,
      maxLoadPerCore: 1.5,
    },
    stall: { noOutputMinutes: 60, maxAttempts: 3, requestionHours: 4 },
    trustedAuthorIds: ["octocat"],
  };

  it("accepts an absent block, because the manager is opt-in", () => {
    expect(validateSessionManager(undefined)).toEqual([]);
    expect(validateSessionManager(null)).toEqual([]);
  });

  it("accepts a minimal block and a fully specified one", () => {
    expect(validateSessionManager(minimal)).toEqual([]);
    expect(validateSessionManager(full)).toEqual([]);
  });

  it("rejects a block that is not an object", () => {
    expect(validateSessionManager("on")[0]).toMatch(/must be an object/i);
    expect(validateSessionManager([])[0]).toMatch(/must be an object/i);
  });

  it.each([
    ["has a space", "bad name"],
    ["has uppercase", "Repo-Manager"],
    ["starts with a dash", "-manager"],
    ["contains a dot tmux would rewrite", "repo.manager"],
    ["is too long", "a".repeat(65)],
    ["is not a string", 42],
  ])("rejects a name that %s", (_label, name) => {
    const problems = validateSessionManager({ ...minimal, name });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/sessionManager\.name/);
  });

  it("rejects a missing name, since workers address the manager by it", () => {
    const { name: _name, ...noName } = minimal;
    expect(validateSessionManager(noName)[0]).toMatch(/sessionManager\.name/);
  });

  it.each(["5", "five minutes", "0m", "-5m", "5 m", "1w", 5])(
    "rejects the unparseable interval %j",
    interval => {
      const problems = validateSessionManager({ ...minimal, interval });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/sessionManager\.interval/);
    }
  );

  it.each(["30s", "5m", "2h", "1d"])("accepts the interval %s", interval => {
    expect(validateSessionManager({ ...minimal, interval })).toEqual([]);
  });

  it("rejects a repos.entries key without hints", () => {
    const problems = validateSessionManager({
      ...minimal,
      repos: { root: "projects", entries: { api: {} } },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/sessionManager\.repos\.entries\["api"\]/);
    expect(problems[0]).toMatch(/hints/);
  });

  it.each([
    ["an empty hints array", { api: { hints: [] } }],
    ["a non-string hint", { api: { hints: ["ok", 3] } }],
    ["hints that are not an array", { api: { hints: "NestJS" } }],
  ])("rejects %s", (_label, entries) => {
    const problems = validateSessionManager({
      ...minimal,
      repos: { entries },
    });
    expect(problems[0]).toMatch(/hints/);
  });

  it("rejects a repo key that is not one safe path segment", () => {
    const problems = validateSessionManager({
      ...minimal,
      repos: { entries: { "../escape": { hints: ["x"] } } },
    });
    expect(problems[0]).toMatch(/safe path segment/i);
  });

  it("rejects a repos.root that could leave the project", () => {
    for (const root of ["../elsewhere", "/abs/path", ""]) {
      const problems = validateSessionManager({
        ...minimal,
        repos: { root, entries: { api: { hints: ["x"] } } },
      });
      expect(problems[0]).toMatch(/sessionManager\.repos\.root/);
    }
  });

  it("rejects a repos block with no entries", () => {
    const problems = validateSessionManager({
      ...minimal,
      repos: { root: "projects", entries: {} },
    });
    expect(problems[0]).toMatch(/entries/);
  });

  it.each([
    ["maxWorkers", 0],
    ["maxWorkers", -1],
    ["maxWorkers", 2.5],
    ["gbPerWorker", 0],
    ["gbPerWorker", "3"],
    ["reserveGb", -1],
    ["maxLoadPerCore", 0],
  ])("rejects capacity.%s = %j", (key, value) => {
    const problems = validateSessionManager({
      ...minimal,
      capacity: { [key]: value },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      new RegExp(`sessionManager\\.capacity\\.${key}`)
    );
  });

  it("accepts a zero memory reserve", () => {
    expect(
      validateSessionManager({ ...minimal, capacity: { reserveGb: 0 } })
    ).toEqual([]);
  });

  it.each([0, -0.5, 1.01, Number.NaN])(
    "rejects capacity.cpuFraction = %j",
    cpuFraction => {
      const problems = validateSessionManager({
        ...minimal,
        capacity: { cpuFraction },
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/cpuFraction/);
    }
  );

  it("accepts cpuFraction of exactly 1", () => {
    expect(
      validateSessionManager({ ...minimal, capacity: { cpuFraction: 1 } })
    ).toEqual([]);
  });

  it.each([
    ["noOutputMinutes", -1],
    ["requestionHours", -0.5],
    ["maxAttempts", -1],
    ["maxAttempts", 0],
    ["maxAttempts", 1.5],
    ["noOutputMinutes", "60"],
  ])("rejects stall.%s = %j", (key, value) => {
    const problems = validateSessionManager({
      ...minimal,
      stall: { [key]: value },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`sessionManager\\.stall\\.${key}`));
  });

  it("rejects a notify provider other than telegram", () => {
    const problems = validateSessionManager({
      ...minimal,
      notify: { ...minimal.notify, provider: "slack" },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/sessionManager\.notify\.provider/);
  });

  it("rejects a missing notify.stateDir, and a missing notify block", () => {
    const noDir = validateSessionManager({
      ...minimal,
      notify: { provider: "telegram" },
    });
    expect(noDir).toHaveLength(1);
    expect(noDir[0]).toMatch(/sessionManager\.notify\.stateDir/);

    const { notify: _notify, ...noNotify } = minimal;
    expect(validateSessionManager(noNotify)[0]).toMatch(
      /sessionManager\.notify\.stateDir/
    );
  });

  it("rejects a field whose value looks like a bot token, without echoing it", () => {
    const token = `123456789:${"A".repeat(35)}`;
    const problems = validateSessionManager({
      ...minimal,
      notify: { ...minimal.notify, chat: token },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/sessionManager\.notify\.chat/);
    expect(problems[0]).toMatch(/token/i);
    expect(problems[0]).not.toContain(token);
  });

  it.each(["token", "botToken", "apiKey", "secret", "password"])(
    "rejects a credential-named field %s anywhere in the block",
    key => {
      const problems = validateSessionManager({
        ...minimal,
        notify: { ...minimal.notify, [key]: "x" },
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/token|secret|credential/i);
      expect(problems[0]).toContain(key);
    }
  );

  it("rejects a trustedAuthorIds that is not a list of ids", () => {
    const problems = validateSessionManager({
      ...minimal,
      trustedAuthorIds: "octocat",
    });
    expect(problems[0]).toMatch(/trustedAuthorIds/);
  });
});

describe("parseLoopInterval", () => {
  it.each([
    ["30s", 30],
    ["5m", 300],
    ["2h", 7200],
    ["1d", 86_400],
  ])("parses %s to %d seconds", (text, seconds) => {
    expect(parseLoopInterval(text)).toBe(seconds);
  });

  it.each(["", "0m", "5", "m", "5 m", "1.5h", undefined, 5])(
    "returns null for %j",
    text => {
      expect(parseLoopInterval(text)).toBeNull();
    }
  );
});
