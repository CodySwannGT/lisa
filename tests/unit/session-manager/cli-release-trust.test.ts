/**
 * Who may release a human hold is its own list (CodySwannGT/lisa#4895).
 *
 * `sessionManager.trustedAuthorIds` used to answer two questions: whose item
 * text may reach a bypass-permissions worker, and who may discharge a human
 * gate. A project that had to remove the key to dispatch integration-filed
 * items silently lost every hold releaser. `trustedReleaseIds` now answers the
 * second question and falls back to `trustedAuthorIds` when unset, so a
 * project that never declares it behaves exactly as before.
 * @module tests/unit/session-manager/cli-release-trust
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HUMAN_GATE_MARKER,
  formatHumanGateRelease,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import { trustedReleaseEntries } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/config.mjs";
import { validateSessionManager } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";
import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
  type Sandbox,
} from "./support/cli-harness.js";

afterEach(() => removeSandboxes());

const RELEASER = "4242";
const REASON = "design-call";
const BLOCKED_PLAN = "blocked-plan";
const RELEASE = "release";
const SKIP = "skip-human-gate";
const TRUST_SENTRY = "integration:sentry";

/** A Blocked item held for a person, released by RELEASER, edges shipped. */
const HELD_ITEM = {
  labels: [],
  body: `Waiting on design.\n<!-- ${HUMAN_GATE_MARKER} reason=${REASON} -->`,
  comments: [
    {
      authorId: RELEASER,
      authorType: "User",
      body: formatHumanGateRelease({ reason: REASON, decision: "go" }),
    },
  ],
  edges: [
    {
      ref: "<TEAM>-1",
      contained: true,
      blockerState: "closed",
      blockerReason: "completed",
    },
  ],
};

/**
 * Merge keys into the sandbox's `sessionManager` block.
 * @param sandbox - Project sandbox
 * @param keys - Keys to set
 * @returns The same sandbox
 */
function configure(sandbox: Sandbox, keys: Record<string, unknown>): Sandbox {
  const file = path.join(sandbox.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  writeJson(file, {
    ...config,
    sessionManager: { ...config.sessionManager, ...keys },
  });
  return sandbox;
}

/**
 * Plan the held item under the given trust keys.
 * @param keys - `sessionManager` keys
 * @returns The planned action
 */
function planWith(keys: Record<string, unknown>): string {
  const result = runCli(configure(makeSandbox(), keys), [BLOCKED_PLAN], {
    input: JSON.stringify(HELD_ITEM),
  });
  if (result.status !== 0) {
    throw new Error(`blocked-plan exited ${result.status}`);
  }
  return result.json.action;
}

describe("blocked-plan with trustedReleaseIds", () => {
  it("releases on a trustedReleaseIds person who is no trusted author", () => {
    expect(
      planWith({
        trustedAuthorIds: [TRUST_SENTRY],
        trustedReleaseIds: [`id:${RELEASER}`],
      })
    ).toBe(RELEASE);
  });

  it("keeps the hold once trustedReleaseIds replaces a releaser", () => {
    expect(
      planWith({
        trustedAuthorIds: [RELEASER],
        trustedReleaseIds: ["id:9999"],
      })
    ).toBe(SKIP);
  });

  it("still releases from trustedAuthorIds when trustedReleaseIds is unset", () => {
    expect(planWith({ trustedAuthorIds: [RELEASER] })).toBe(RELEASE);
  });

  it("never lets an integration: entry release a hold", () => {
    expect(planWith({ trustedAuthorIds: ["integration:4242"] })).toBe(SKIP);
  });
});

describe("trustedReleaseEntries", () => {
  it("prefers trustedReleaseIds, falls back to trustedAuthorIds, else none", () => {
    expect(
      trustedReleaseEntries({
        trustedAuthorIds: ["a"],
        trustedReleaseIds: ["b"],
      })
    ).toEqual(["b"]);
    expect(
      trustedReleaseEntries({
        trustedAuthorIds: ["a"],
        trustedReleaseIds: null,
      })
    ).toEqual(["a"]);
    expect(trustedReleaseEntries(null)).toEqual([]);
  });
});

describe("validateSessionManager trust lists", () => {
  const minimal = {
    name: "repo-a-manager",
    notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-x" },
  };

  it("accepts integration: in trustedAuthorIds", () => {
    expect(
      validateSessionManager({
        ...minimal,
        trustedAuthorIds: ["id:4242", TRUST_SENTRY],
      })
    ).toEqual([]);
  });

  it("accepts a valid trustedReleaseIds", () => {
    expect(
      validateSessionManager({
        ...minimal,
        trustedReleaseIds: ["id:4242", "login:octocat"],
      })
    ).toEqual([]);
  });

  it.each([
    ["trustedReleaseIds", { trustedReleaseIds: [TRUST_SENTRY] }],
    ["operatorIds", { operatorIds: [TRUST_SENTRY] }],
  ])("refuses integration: in %s", (key, keys) => {
    const problems = validateSessionManager({ ...minimal, ...keys });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`sessionManager.${key}[0]`);
    expect(problems[0]).toContain("belongs only in");
  });

  it("refuses an empty trustedReleaseIds and a non-list one", () => {
    expect(
      validateSessionManager({ ...minimal, trustedReleaseIds: [] })[0]
    ).toMatch(/trustedReleaseIds must name at least one person/);
    expect(
      validateSessionManager({ ...minimal, trustedReleaseIds: "4242" })[0]
    ).toMatch(/trustedReleaseIds must be an array/);
  });

  it("says that removing trustedAuthorIds also removes hold release", () => {
    const [problem] = validateSessionManager({
      ...minimal,
      trustedAuthorIds: [],
    });
    expect(problem).toContain("who may release a human hold");
    expect(problem).toContain("integration:<service>");
  });

  it("scans trustedReleaseIds for a pasted bot token", () => {
    const token = `123456789:${"A".repeat(35)}`;
    const problems = validateSessionManager({
      ...minimal,
      trustedReleaseIds: [`id:${token}`],
    });
    expect(problems.join("\n")).toMatch(/looks like a bot token/);
    expect(problems.join("\n")).not.toContain(token);
  });
});
