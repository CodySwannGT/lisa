/**
 * The session manager honors a hold release relayed by an automation account
 * the project named (CodySwannGT/lisa#5190).
 *
 * The queue, the blocked-item plan and the orphan sweep each decide whether a
 * held item is released. All three take who may release from
 * `sessionManager.trustedReleaseIds`, and all three must give the same answer
 * for a relayed release: yes when the list names the posting account as
 * `relay:<id>` and the line names a trusted person from the same list, no in
 * every other case. Config validation says where a relay entry belongs.
 * @module tests/unit/session-manager/relay-hold-release
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  idComparableValues,
  parseIdEntry,
  releaseComparableValues,
} from "../../../plugins/src/base/scripts/operator-id-kinds.mjs";
import {
  classifyIdEntry,
  validateSessionManager,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";
import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
  type Sandbox,
} from "./support/cli-harness.js";
import { runStubOnly } from "./support/human-sandbox.js";

afterEach(() => removeSandboxes());

const PERSON = "4242";
const RELAY = "9001";
const RELAY_ENTRY = `relay:${RELAY}`;
const REASON = "recurring-spend";
const MARKER = "[lisa-human-gate-release]";
const HOLD = `Waiting on a spend decision.\n<!-- [lisa-human-gate] reason=${REASON} -->`;
const RELAYED = `${MARKER} relayed-for=${PERSON} reason=${REASON}\nThe operator approved this in chat.`;
const DIRECT = `${MARKER} reason=${REASON}`;
const BLOCKED_PLAN = "blocked-plan";
const RELEASE = "release";
const SKIP = "skip-human-gate";
const WITH_RELAY = { trustedReleaseIds: [`id:${PERSON}`, RELAY_ENTRY] };
const WITHOUT_RELAY = { trustedReleaseIds: [`id:${PERSON}`] };

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

describe("blocked-plan", () => {
  /**
   * Plan a Blocked, held item carrying one comment.
   * @param comment - The comment on the item
   * @param keys - `sessionManager` keys
   * @returns The planned action
   */
  function planWith(comment: unknown, keys: Record<string, unknown>): string {
    const result = runCli(configure(makeSandbox(), keys), [BLOCKED_PLAN], {
      input: JSON.stringify({
        labels: [],
        body: HOLD,
        comments: [comment],
        edges: [
          {
            ref: "<TEAM>-1",
            contained: true,
            blockerState: "closed",
            blockerReason: "completed",
          },
        ],
      }),
    });
    if (result.status !== 0)
      throw new Error(`blocked-plan exited ${result.status}`);
    return result.json.action;
  }

  it("releases on a relayed release from the configured relay, bot or not", () => {
    expect(
      planWith(
        { authorId: RELAY, authorType: "Bot", body: RELAYED },
        WITH_RELAY
      )
    ).toBe(RELEASE);
    expect(
      planWith(
        { authorId: RELAY, authorType: "User", body: RELAYED },
        WITH_RELAY
      )
    ).toBe(RELEASE);
  });

  it("keeps the hold when the project named no relay", () => {
    expect(
      planWith(
        { authorId: RELAY, authorType: "Bot", body: RELAYED },
        WITHOUT_RELAY
      )
    ).toBe(SKIP);
  });

  it("keeps the hold when the relay names nobody, a stranger, or itself", () => {
    for (const body of [
      DIRECT,
      `${MARKER} relayed-for=7777 reason=${REASON}`,
      `${MARKER} relayed-for=${RELAY} reason=${REASON}`,
    ])
      expect(
        planWith({ authorId: RELAY, authorType: "Bot", body }, WITH_RELAY)
      ).toBe(SKIP);
  });

  it("keeps the hold when another account posts the relayed form", () => {
    expect(
      planWith(
        { authorId: "5555", authorType: "Bot", body: RELAYED },
        WITH_RELAY
      )
    ).toBe(SKIP);
  });

  it("still releases on the person's own comment", () => {
    expect(
      planWith(
        { authorId: PERSON, authorType: "User", body: DIRECT },
        WITH_RELAY
      )
    ).toBe(RELEASE);
  });

  it("never takes a relay named in trustedAuthorIds, where only authors belong", () => {
    // With no release list, the author list is the fallback for PEOPLE. A
    // relay written there is not carried over, and validation says where it
    // belongs.
    expect(
      planWith(
        { authorId: RELAY, authorType: "Bot", body: RELAYED },
        { trustedAuthorIds: [PERSON, RELAY_ENTRY] }
      )
    ).toBe(SKIP);
    expect(
      planWith(
        { authorId: PERSON, authorType: "User", body: DIRECT },
        { trustedAuthorIds: [PERSON, RELAY_ENTRY] }
      )
    ).toBe(RELEASE);
    expect(
      validateSessionManager({
        name: "repo-a-manager",
        notify: { provider: "none" },
        trustedAuthorIds: [PERSON, RELAY_ENTRY],
      }).join(" ")
    ).toContain("belongs only in sessionManager.trustedReleaseIds");
  });
});

describe("queue", () => {
  const LINEAR = "DEMO-1";

  /**
   * Run the real queue CLI with one held Linear issue.
   * @param comment - Native comment on the issue
   * @param keys - `sessionManager` keys
   * @returns CLI result
   */
  function queue(comment: unknown, keys: Record<string, unknown>) {
    const sandbox = makeSandbox({
      sessionManager: {
        name: "relay-queue",
        operatorIds: [PERSON],
        trustedAuthorIds: ["trusted-author"],
        ...keys,
      },
      extraConfig: {
        humanGate: { mode: "strict" },
        github: { org: "example-org", repo: "demo-repo" },
      },
    });
    const input = path.join(sandbox.root, "queue.json");
    writeJson(input, {
      complete: true,
      pages: 1,
      items: [
        {
          identifier: LINEAR,
          title: "Ready issue",
          description: HOLD,
          labels: { nodes: [] },
          creator: { id: "trusted-author" },
          comments: { nodes: [comment] },
        },
      ],
    });
    return runCli(sandbox, ["queue", "--tracker", "linear", "--input", input]);
  }

  it("dispatches an item released through the relay, which Linear marks as a bot", () => {
    const result = queue(
      { body: RELAYED, user: { id: RELAY }, botActor: { id: "app-1" } },
      WITH_RELAY
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([
      expect.objectContaining({ ref: LINEAR }),
    ]);
    expect(result.json.excluded).toEqual([]);
  });

  it("keeps the hold without the relay entry", () => {
    const result = queue(
      { body: RELAYED, user: { id: RELAY }, botActor: { id: "app-1" } },
      WITHOUT_RELAY
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([]);
    expect(result.json.excluded).toEqual([
      { ref: LINEAR, reason: "human-gated" },
    ]);
  });
});

describe("orphan-plan", () => {
  const READY = "status:ready";
  const NEEDED = "human-needed";
  const REF = "example-org/demo-repo#5";

  /**
   * Plan one held item that carries a relayed release.
   * @param keys - `sessionManager` keys
   * @returns Refs the sweep keeps held
   */
  function keptHolds(keys: Record<string, unknown>): string[] {
    const sandbox = configure(
      makeSandbox({
        extraConfig: {
          github: {
            org: "example-org",
            repo: "demo-repo",
            labels: {
              build: {
                ready: READY,
                claimed: "status:in-progress",
                blocked: "status:blocked",
                human_needed: NEEDED,
              },
            },
          },
        },
      }),
      keys
    );
    const result = runStubOnly(sandbox, ["orphan-plan"], {
      input: JSON.stringify({
        complete: true,
        items: [],
        holds: [
          {
            ref: REF,
            labels: [READY, NEEDED],
            assignees: [],
            updatedAt: "2026-01-01T00:00:00Z",
            body: `<!-- [lisa-human-gate] reason=${REASON} -->`,
            comments: [{ body: RELAYED, author: { id: RELAY, type: "Bot" } }],
          },
        ],
      }),
    });
    expect(result.status).toBe(0);
    return result.json.holds.keep.map((hold: { ref: string }) => hold.ref);
  }

  it("lets go of a hold released through the configured relay", () => {
    expect(keptHolds(WITH_RELAY)).toEqual([]);
  });

  it("keeps the hold when the project named no relay", () => {
    expect(keptHolds(WITHOUT_RELAY)).toEqual([REF]);
  });
});

describe("relay entries", () => {
  const minimal = {
    name: "repo-a-manager",
    notify: { provider: "none" },
  };

  it("parse as their own kind, in the parser and in the validator's copy", () => {
    expect(parseIdEntry(RELAY_ENTRY)).toEqual({ kind: "relay", value: RELAY });
    expect(classifyIdEntry(RELAY_ENTRY)).toBe("relay");
    expect(parseIdEntry("relay:")).toMatchObject({ kind: "invalid" });
    expect(classifyIdEntry("relay:")).toBe("empty-value");
  });

  it("are never a person: people readers drop them, the release reader keeps them marked", () => {
    const entries = [`id:${PERSON}`, RELAY_ENTRY, "login:octocat"];
    expect(idComparableValues(entries)).toEqual([PERSON]);
    expect(releaseComparableValues(entries)).toEqual([PERSON, RELAY_ENTRY]);
    expect(releaseComparableValues(undefined)).toEqual([]);
  });

  it("are accepted in trustedReleaseIds beside a person", () => {
    expect(validateSessionManager({ ...minimal, ...WITH_RELAY })).toEqual([]);
  });

  it.each([
    ["operatorIds", { operatorIds: [RELAY_ENTRY] }],
    ["trustedAuthorIds", { trustedAuthorIds: [RELAY_ENTRY] }],
  ])("are refused in %s, in words a reader can follow", (key, keys) => {
    const problems = validateSessionManager({ ...minimal, ...keys });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`sessionManager.${key}[0]`);
    expect(problems[0]).toContain(
      "belongs only in sessionManager.trustedReleaseIds"
    );
    expect(problems[0]).toContain("It is not a person");
  });

  it.each([
    ["alone", [RELAY_ENTRY]],
    ["beside only a login", [RELAY_ENTRY, "login:octocat"]],
  ])(
    "are reported when %s, because nobody can be relayed for",
    (_name, list) => {
      const problems = validateSessionManager({
        ...minimal,
        trustedReleaseIds: list,
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("names a relay but no person");
    }
  );
});
