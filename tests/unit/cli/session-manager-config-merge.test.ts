/**
 * Parity between doctor's `sessionManager` merge and the runtime's.
 *
 * Doctor once merged the local block over the committed one shallowly (with
 * only `notify` one level deeper), while the runtime resolver merges every
 * plain object deeply. A local `capacity: { maxWorkers: 2 }` then erased the
 * committed `capacity` for doctor but not for the runtime, and a local
 * `repos.entries.web` erased `repos.root`, so doctor judged a block the
 * manager never runs with. `src/` cannot import the plugin script, so the
 * merge is copied and pinned here against the runtime's own resolver.
 * @module tests/unit/cli/session-manager-config-merge
 */
import { describe, expect, it } from "vitest";

import { mergeSessionManagerBlocks } from "../../../src/cli/session-manager-config-merge.js";
import { mergeConfigLayers } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";
import { resolveSessionManagerConfig } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/config.mjs";

const COMMITTED = {
  tracker: "github",
  sessionManager: {
    name: "repo-a-manager",
    capacity: { maxWorkers: 6, gbPerWorker: 3, reserveGb: 8 },
    repos: {
      root: "projects",
      entries: { api: { hints: ["NestJS", "migrations"] } },
    },
    notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-a" },
    trustedAuthorIds: ["1001", "1002"],
  },
};

const LOCAL = {
  sessionManager: {
    capacity: { maxWorkers: 2 },
    repos: { entries: { api: { hints: ["Nest"] }, web: { hints: ["Expo"] } } },
    notify: { stateDir: "~/.claude/channels/telegram-a-local" },
    trustedAuthorIds: ["1003"],
  },
};

describe("mergeSessionManagerBlocks", () => {
  it("returns undefined when neither file declares a block", () => {
    expect(mergeSessionManagerBlocks({}, undefined)).toBeUndefined();
    expect(mergeSessionManagerBlocks(undefined, undefined)).toBeUndefined();
  });

  it("matches the runtime merge on nested repos and capacity overrides", () => {
    const merged = mergeSessionManagerBlocks(COMMITTED, LOCAL);
    expect(merged).toEqual(
      mergeConfigLayers(COMMITTED.sessionManager, LOCAL.sessionManager)
    );
    const runtime = resolveSessionManagerConfig(COMMITTED, LOCAL);
    expect(merged?.capacity).toEqual({
      maxWorkers: 2,
      gbPerWorker: 3,
      reserveGb: 8,
    });
    expect(runtime?.capacity).toMatchObject(merged?.capacity as object);
    expect(merged?.repos).toEqual({
      root: "projects",
      entries: { api: { hints: ["Nest"] }, web: { hints: ["Expo"] } },
    });
    expect(runtime?.repos).toEqual(merged?.repos);
    expect(runtime?.notify).toEqual(merged?.notify);
    expect(runtime?.trustedAuthorIds).toEqual(["1003"]);
    expect(merged?.trustedAuthorIds).toEqual(["1003"]);
  });

  it("uses a block declared only in the local file", () => {
    expect(mergeSessionManagerBlocks({}, LOCAL)).toEqual(LOCAL.sessionManager);
  });

  it("drops prototype keys from parsed JSON", () => {
    const local = JSON.parse('{"sessionManager":{"__proto__":{"x":1}}}');
    expect(mergeSessionManagerBlocks(COMMITTED, local)).toEqual(
      COMMITTED.sessionManager
    );
  });
});
