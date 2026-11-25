/**
 * The session manager honors a hold release relayed by an automation account
 * the project named (CodySwannGT/lisa#5190).
 *
 * The queue, the blocked-item plan and the orphan sweep each decide whether a
 * held item is released. All three take who may release from
 * `sessionManager.trustedReleaseIds`, and all three must give the same answer
 * for a relayed release: yes when the list names the posting account as
 * `relay:<id>` and the line names a trusted person from the same list, no in
 * every other case. How the entry is written and validated is covered in
 * `relay-entry-validation.test.ts`.
 * @module tests/unit/session-manager/relay-hold-release
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateSessionManager } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";
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
const HELD = "human-gated";
const ORG = "example-org";
const REPO = "demo-repo";
const BOT = "Bot";

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
      planWith({ authorId: RELAY, authorType: BOT, body: RELAYED }, WITH_RELAY)
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
        { authorId: RELAY, authorType: BOT, body: RELAYED },
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
        planWith({ authorId: RELAY, authorType: BOT, body }, WITH_RELAY)
      ).toBe(SKIP);
  });

  it("keeps the hold when another account posts the relayed form", () => {
    expect(
      planWith({ authorId: "5555", authorType: BOT, body: RELAYED }, WITH_RELAY)
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
        { authorId: RELAY, authorType: BOT, body: RELAYED },
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
        github: { org: ORG, repo: REPO },
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
    expect(result.json.excluded).toEqual([{ ref: LINEAR, reason: HELD }]);
  });
});

describe("queue on GitHub", () => {
  const ISSUES =
    "repos/example-org/demo-repo/issues?state=open&labels=status%3Aready&per_page=100";
  const COMMENTS = "repos/example-org/demo-repo/issues/1/comments?per_page=100";
  const GITHUB_REF = "example-org/demo-repo#1";

  /**
   * Run the real queue CLI against a stubbed GitHub with one held issue
   * carrying the relay's release. GitHub ids are numbers.
   * @param keys - `sessionManager` keys
   * @returns CLI result
   */
  function queue(keys: Record<string, unknown>) {
    const sandbox = makeSandbox({
      sessionManager: {
        name: "relay-queue-github",
        operatorIds: [PERSON],
        trustedAuthorIds: ["123"],
        ...keys,
      },
      extraConfig: {
        humanGate: { mode: "strict" },
        github: { org: ORG, repo: REPO },
      },
    });
    const routes = path.join(sandbox.root, "gh-routes.json");
    writeJson(routes, [
      {
        match: ISSUES,
        body: [[{ number: 1, title: "Held", body: HOLD, user: { id: 123 } }]],
      },
      {
        match: COMMENTS,
        body: [
          [
            {
              body: RELAYED,
              user: { id: Number(RELAY), login: "agent[bot]", type: BOT },
            },
          ],
        ],
      },
    ]);
    return runCli(
      sandbox,
      ["queue", "--tracker", "github", "--label", "status:ready"],
      { env: { STUB_GH_ROUTES: routes } }
    );
  }

  it("dispatches an issue released through the configured relay", () => {
    const result = queue(WITH_RELAY);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([
      expect.objectContaining({ ref: GITHUB_REF }),
    ]);
    expect(result.json.excluded).toEqual([]);
  });

  it("keeps the hold without the relay entry", () => {
    const result = queue(WITHOUT_RELAY);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([]);
    expect(result.json.excluded).toEqual([{ ref: GITHUB_REF, reason: HELD }]);
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
            org: ORG,
            repo: REPO,
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
            comments: [{ body: RELAYED, author: { id: RELAY, type: BOT } }],
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
