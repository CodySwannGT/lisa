/**
 * Validation of kind-keyed `sessionManager.operatorIds` and
 * `trustedAuthorIds` entries (CodySwannGT/lisa#4623).
 *
 * A `login:` / `id:` entry names one identity for every reader. An unknown
 * prefix or an empty value is refused, naming the entry, because a reader
 * would otherwise match it against nothing and silently drop a person. A
 * plain all-digit operator entry stays valid (its meaning is unchanged) but
 * draws a warning: the answer matcher reads it as a numeric id while the
 * queue and the claim read it as a login.
 * @module tests/unit/secrets/validate-config-operator-id-kinds
 */
import { describe, expect, it } from "vitest";

import {
  sessionManagerWarnings,
  validateSessionManager,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";

const BLOCK = {
  name: "demo-manager",
  notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-x" },
};

/** A legacy Jira Cloud accountId: digits, a colon, a canonical UUID. */
const LEGACY_ACCOUNT_ID = "557058:f58131cb-b67d-43c7-b30d-6b58d40bd077";

/** A Telegram bot token's shape: a bot id, a colon, a 35-character secret. */
const BOT_TOKEN = `1234567890:${"A".repeat(35)}`;

/** The wording every credential-scan refusal carries. */
const BOT_TOKEN_PROBLEM = "looks like a bot token";

describe("Scenario: Malformed entries are refused", () => {
  it.each([
    ["operatorIds", "user:583231", /unknown prefix "user:"/],
    ["operatorIds", "login:", /empty value/],
    ["trustedAuthorIds", "id:", /empty value/],
    ["trustedAuthorIds", "gh:4242", /unknown prefix "gh:"/],
  ])("refuses %s entry %j, naming it", (key, entry, why) => {
    const errors = validateSessionManager({ ...BLOCK, [key]: [entry] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`sessionManager.${key}`);
    expect(errors[0]).toContain(JSON.stringify(entry));
    expect(errors[0]).toMatch(why);
  });
});

describe("kind-keyed and plain entries are accepted", () => {
  it.each([
    [["login:583231", "id:99999"]],
    [["583231", "octocat"]],
    // A legacy `557058:<uuid>` accountId is accepted plain and id:-prefixed:
    // the credential scan exempts its UUID shape in the id lists
    // (CodySwannGT/lisa#4719).
    [[LEGACY_ACCOUNT_ID]],
    [[`id:${LEGACY_ACCOUNT_ID}`]],
    [["5b10ac8d82e05b22cc7d4ef5", "qm:a713c5e1-2d4f-4b8a-9c3e-1f2a3b4c5d6e"]],
  ])("accepts %j in both lists", ids => {
    expect(
      validateSessionManager({
        ...BLOCK,
        operatorIds: ids,
        trustedAuthorIds: ids,
      })
    ).toEqual([]);
  });

  it("accepts a backlogPickup whose first operator is kind-keyed", () => {
    expect(
      validateSessionManager({
        ...BLOCK,
        backlogPickup: true,
        operatorIds: ["login:octocat"],
      })
    ).toEqual([]);
  });
});

describe("a plain all-digit operator entry warns without failing", () => {
  it("names its two readings and the login: and id: forms", () => {
    const block = { ...BLOCK, operatorIds: ["583231"] };
    expect(validateSessionManager(block)).toEqual([]);
    const warnings = sessionManagerWarnings(block);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"583231"');
    expect(warnings[0]).toMatch(/numeric id/);
    expect(warnings[0]).toMatch(/login/);
    expect(warnings[0]).toContain('"login:583231"');
    expect(warnings[0]).toContain('"id:583231"');
  });

  it("warns for an all-digit entry with surrounding spaces, as the queue trims it", () => {
    const warnings = sessionManagerWarnings({
      ...BLOCK,
      operatorIds: [" 583231 "],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"login:583231"');
    // The answer matcher does not trim a plain entry, so it matches nobody.
    expect(warnings[0]).toMatch(
      /does not trim it, so it matches no comment author/
    );
    expect(warnings[0]).not.toMatch(/reads it as a numeric account id/);
  });

  it.each([
    [{ operatorIds: ["login:583231", "id:99999", "octocat"] }],
    // A trusted author is read as an id by every reader, so digits are not ambiguous there.
    [{ trustedAuthorIds: ["4242"] }],
    [{}],
  ])("does not warn for %j", extra => {
    expect(sessionManagerWarnings({ ...BLOCK, ...extra })).toEqual([]);
  });

  it("does not warn for an absent or malformed block", () => {
    expect(sessionManagerWarnings(undefined)).toEqual([]);
    expect(sessionManagerWarnings("on")).toEqual([]);
    expect(sessionManagerWarnings({ ...BLOCK, operatorIds: "583231" })).toEqual(
      []
    );
  });
});

describe("credential scan of the id lists (CodySwannGT/lisa#4719)", () => {
  it("accepts a legacy Jira accountId as a plain operator entry", () => {
    expect(
      validateSessionManager({
        name: "m",
        operatorIds: [LEGACY_ACCOUNT_ID],
        trustedAuthorIds: ["x"],
      })
    ).toEqual([]);
  });

  it("accepts a legacy Jira accountId as a plain trusted author", () => {
    expect(
      validateSessionManager({
        name: "m",
        operatorIds: ["id:1"],
        trustedAuthorIds: [LEGACY_ACCOUNT_ID],
      })
    ).toEqual([]);
  });

  it.each([
    ["operatorIds", ""],
    ["operatorIds", "id:"],
    ["operatorIds", "login:"],
    ["trustedAuthorIds", ""],
    ["trustedAuthorIds", "id:"],
    ["trustedAuthorIds", "login:"],
  ])("refuses a bot token in %s with prefix %j", (list, prefix) => {
    const errors = validateSessionManager({
      ...BLOCK,
      [list]: [`${prefix}${BOT_TOKEN}`],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`sessionManager.${list}[0]`);
    expect(errors[0]).toContain(BOT_TOKEN_PROBLEM);
    expect(errors[0]).not.toContain(BOT_TOKEN);
  });

  it("still refuses a UUID-shaped value outside the id lists", () => {
    const errors = validateSessionManager({
      name: "m",
      notify: { chat: LEGACY_ACCOUNT_ID },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("sessionManager.notify.chat");
    expect(errors[0]).toContain(BOT_TOKEN_PROBLEM);
    expect(errors[0]).not.toContain(LEGACY_ACCOUNT_ID);
  });

  // The exemption belongs to the top-level id lists only: a same-named key
  // nested elsewhere in the block is just another field to the scan.
  it.each([
    ["notify", "operatorIds"],
    ["notify", "trustedAuthorIds"],
  ])(
    "still refuses a UUID-shaped value in a nested %s.%s list",
    (parent, key) => {
      const errors = validateSessionManager({
        name: "m",
        operatorIds: ["id:1"],
        trustedAuthorIds: ["x"],
        [parent]: { [key]: [LEGACY_ACCOUNT_ID] },
      });
      const path = `sessionManager.${parent}.${key}[0]`;
      expect(errors.filter(e => e.includes(path))).toHaveLength(1);
      expect(errors.join("\n")).toContain(BOT_TOKEN_PROBLEM);
      expect(errors.join("\n")).not.toContain(LEGACY_ACCOUNT_ID);
    }
  );
});
