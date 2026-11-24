/**
 * How a relay for hold releases is written in project settings
 * (CodySwannGT/lisa#5190): where the entry is accepted, where it is refused,
 * and the spellings that must never be read as one.
 *
 * A relay is named exactly as `relay:<account id>`, only in
 * `sessionManager.trustedReleaseIds`, beside at least one person. The same
 * value behind another prefix or a space is refused and is never a relay; an
 * account listed both as a person and as a relay is refused.
 * @module tests/unit/session-manager/relay-entry-validation
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

afterEach(() => removeSandboxes());

const PERSON = "4242";
const RELAY = "9001";
const RELAY_ENTRY = `relay:${RELAY}`;
const REASON = "recurring-spend";
const MARKER = "[lisa-human-gate-release]";
const HOLD = `Waiting on a spend decision.\n<!-- [lisa-human-gate] reason=${REASON} -->`;
const RELAYED = `${MARKER} relayed-for=${PERSON} reason=${REASON}`;
const BLOCKED_PLAN = "blocked-plan";
const SKIP = "skip-human-gate";
const WITH_RELAY = { trustedReleaseIds: [`id:${PERSON}`, RELAY_ENTRY] };
const MINIMAL = { name: "repo-a-manager", notify: { provider: "none" } };

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
 * Plan a Blocked, held item whose only comment is from the relay account.
 * @param keys - `sessionManager` keys
 * @param body - The relay's comment
 * @returns The planned action
 */
function planRelayed(keys: Record<string, unknown>, body = RELAYED): string {
  const result = runCli(configure(makeSandbox(), keys), [BLOCKED_PLAN], {
    input: JSON.stringify({
      labels: [],
      body: HOLD,
      comments: [{ authorId: RELAY, authorType: "Bot", body }],
      edges: [],
    }),
  });
  if (result.status !== 0)
    throw new Error(`blocked-plan exited ${result.status}`);
  return result.json.action;
}

describe("a relay written another way", () => {
  it.each([
    ["behind id:", `id:${RELAY_ENTRY}`],
    ["with a space in front", ` ${RELAY_ENTRY}`],
    ["behind id: and a space", `id: ${RELAY_ENTRY}`],
  ])("is never a relay %s, in either list", (_name, entry) => {
    expect(planRelayed({ trustedAuthorIds: [PERSON, entry] })).toBe(SKIP);
    expect(planRelayed({ trustedReleaseIds: [`id:${PERSON}`, entry] })).toBe(
      SKIP
    );
    expect(releaseComparableValues([`id:${PERSON}`, entry])).toEqual([PERSON]);
  });

  it.each([
    ["trustedAuthorIds", `id:${RELAY_ENTRY}`],
    ["trustedAuthorIds", ` ${RELAY_ENTRY}`],
    ["operatorIds", `id:${RELAY_ENTRY}`],
    ["trustedReleaseIds", ` ${RELAY_ENTRY}`],
  ])("is refused by validation in %s (%j)", (key, entry) => {
    const problems = validateSessionManager({
      ...MINIMAL,
      [key]: [`id:${PERSON}`, entry],
    });
    expect(problems.join(" ")).toContain(
      "reads as a relay: entry written another way"
    );
    // The refusal never repeats the entry's value.
    expect(problems.join(" ")).not.toContain(RELAY);
  });

  it("is refused when the same account is listed as a person and as a relay", () => {
    const keys = {
      trustedReleaseIds: [`id:${PERSON}`, `id:${RELAY}`, RELAY_ENTRY],
    };
    const problems = validateSessionManager({ ...MINIMAL, ...keys });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sessionManager.trustedReleaseIds[1]");
    expect(problems[0]).toContain(
      "names the same account as a person and as a relay"
    );
    // And the relay still cannot name itself.
    expect(
      planRelayed(keys, `${MARKER} relayed-for=${RELAY} reason=${REASON}`)
    ).toBe(SKIP);
  });
});

describe("relay entries", () => {
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
    expect(validateSessionManager({ ...MINIMAL, ...WITH_RELAY })).toEqual([]);
  });

  it.each([
    ["operatorIds", { operatorIds: [RELAY_ENTRY] }],
    ["trustedAuthorIds", { trustedAuthorIds: [RELAY_ENTRY] }],
  ])("are refused in %s, in words a reader can follow", (key, keys) => {
    const problems = validateSessionManager({ ...MINIMAL, ...keys });
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
        ...MINIMAL,
        trustedReleaseIds: list,
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("names a relay but no person");
    }
  );
});
