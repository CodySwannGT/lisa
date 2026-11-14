/**
 * The kind-keyed id entry grammar for `sessionManager.operatorIds` and
 * `trustedAuthorIds` (CodySwannGT/lisa#4623).
 *
 * One config value used to mean two things: an all-digit entry was a numeric
 * id to the answer matcher but a login to the queue and the claim. `login:`
 * and `id:` entries name one identity for every reader; a plain entry keeps
 * exactly today's meaning. The validator ships standalone (no import of the
 * shared module), so its local copy of the grammar is pinned to the shared
 * one on a table of entries here.
 * @module tests/unit/scripts/operator-id-kinds
 */
import { describe, expect, it } from "vitest";

import {
  idComparableValues,
  parseIdEntry,
} from "../../../plugins/src/base/scripts/operator-id-kinds.mjs";
import { classifyIdEntry } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";

const PLAIN = "plain";
const UNKNOWN_PREFIX = "unknown-prefix";
const EMPTY_VALUE = "empty-value";

/** Every entry shape the grammar distinguishes, with its expected kind. */
const TABLE: readonly [string, string][] = [
  ["login:583231", "login"],
  ["id:99999", "id"],
  ["integration:sentry", "integration"],
  ["integration:", EMPTY_VALUE],
  ["id:557058:f58131cb-b67d-43c7-b30d-6b58d40bd077", "id"],
  ["583231", PLAIN],
  ["octocat", PLAIN],
  ["557058:f58131cb-b67d-43c7-b30d-6b58d40bd077", PLAIN],
  ["5b10ac8d82e05b22cc7d4ef5", PLAIN],
  ["qm:a713c5e1-2d4f-4b8a-9c3e-1f2a3b4c5d6e", PLAIN],
  ["user:octocat", UNKNOWN_PREFIX],
  ["Login:octocat", UNKNOWN_PREFIX],
  ["login:", EMPTY_VALUE],
  ["id:   ", EMPTY_VALUE],
];

describe("parseIdEntry", () => {
  it("reads login: and id: entries as that kind, value without the prefix", () => {
    expect(parseIdEntry("login:583231")).toEqual({
      kind: "login",
      value: "583231",
    });
    expect(parseIdEntry("id:99999")).toEqual({ kind: "id", value: "99999" });
  });

  it("keeps a plain entry's value exactly as written", () => {
    expect(parseIdEntry("583231")).toEqual({ kind: "plain", value: "583231" });
    expect(parseIdEntry("octocat")).toEqual({
      kind: "plain",
      value: "octocat",
    });
  });

  it("keeps a Jira accountId that holds a colon plain", () => {
    const accountId = "557058:f58131cb-b67d-43c7-b30d-6b58d40bd077";
    expect(parseIdEntry(accountId)).toEqual({
      kind: "plain",
      value: accountId,
    });
    expect(parseIdEntry(`id:${accountId}`)).toEqual({
      kind: "id",
      value: accountId,
    });
  });

  it("marks an unknown prefix and an empty value invalid, naming the problem", () => {
    expect(parseIdEntry("user:octocat")).toEqual({
      kind: "invalid",
      problem: UNKNOWN_PREFIX,
      prefix: "user",
    });
    expect(parseIdEntry("login:")).toEqual({
      kind: "invalid",
      problem: EMPTY_VALUE,
      prefix: "login",
    });
  });

  it.each(TABLE)("agrees with the validator's local grammar on %j", entry => {
    const parsed = parseIdEntry(entry);
    const shared =
      parsed && "problem" in parsed ? parsed.problem : parsed?.kind;
    expect(classifyIdEntry(entry)).toBe(shared);
  });

  it.each(TABLE)("classifies %j as %s", (entry, kind) => {
    expect(classifyIdEntry(entry)).toBe(kind);
  });
});

describe("idComparableValues", () => {
  it("keeps plain and id: values for an id-only comparator, drops login: and invalid ones", () => {
    expect(
      idComparableValues([
        "4242",
        "octocat",
        "id:99",
        "login:mallory",
        "integration:sentry",
        "x:y",
      ])
    ).toEqual(["4242", "octocat", "99"]);
  });

  it("returns an empty list for anything that is not a list", () => {
    expect(idComparableValues(undefined)).toEqual([]);
  });
});
