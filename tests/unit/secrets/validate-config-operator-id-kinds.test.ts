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
    // A plain legacy `557058:<uuid>` accountId is token-shaped to the
    // credential scan (a separate, older refusal); its id: form is not.
    [["id:557058:f58131cb-b67d-43c7-b30d-6b58d40bd077"]],
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
