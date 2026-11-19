/**
 * The assign-on-take rule (CodySwannGT/lisa#5029): `judgeTake` decides
 * whether an item's read-back assignees let `spawn` dispatch it. An item is
 * taken only when at least one assignee is named and every one is "me" or an
 * operator; it compares assignees exactly as the queue and orphan sweep do.
 * Pure: no I/O.
 * @module tests/unit/session-manager/take-check
 */
import { describe, expect, it } from "vitest";

import { judgeTake } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/take-check.mjs";

const ME = "agent-account";
const OPERATOR = "the-operator";
const OTHER = "someone-else";
const JIRA_ID = "557058:abc";

describe("judgeTake", () => {
  it("refuses an item nobody is assigned to, so the manager assigns it first", () => {
    expect(judgeTake([], { me: ME, operatorIds: [OPERATOR] })).toEqual({
      ok: false,
      reason: "unassigned",
      foreign: [],
    });
  });

  it("treats blank and non-id entries as nobody", () => {
    expect(
      judgeTake(["", "  ", null, { login: "" }], { me: ME, operatorIds: [] })
    ).toMatchObject({ ok: false, reason: "unassigned" });
  });

  it("refuses a missing assignee list as unassigned, never as taken", () => {
    expect(judgeTake(undefined, { me: ME })).toMatchObject({
      ok: false,
      reason: "unassigned",
    });
  });

  it("accepts an item assigned to me", () => {
    expect(judgeTake([ME], { me: ME, operatorIds: [] })).toEqual({ ok: true });
  });

  it("accepts an item assigned to an operator, even before me is recorded", () => {
    expect(
      judgeTake([OPERATOR], { me: null, operatorIds: [OPERATOR] })
    ).toEqual({ ok: true });
  });

  it("refuses an item held by anyone else, naming them", () => {
    expect(judgeTake([ME, OTHER], { me: ME, operatorIds: [OPERATOR] })).toEqual(
      { ok: false, reason: "foreign", foreign: [OTHER] }
    );
  });

  it("refuses me-only matching when me was never recorded", () => {
    expect(judgeTake([ME], { me: null, operatorIds: [] })).toMatchObject({
      ok: false,
      reason: "foreign",
    });
  });

  it("matches a GitHub {login, id} assignee against login: and id: entries", () => {
    const assignee = { login: "octo", id: 583231 };
    expect(judgeTake([assignee], { operatorIds: ["login:octo"] })).toEqual({
      ok: true,
    });
    expect(judgeTake([assignee], { operatorIds: ["id:583231"] })).toEqual({
      ok: true,
    });
    expect(judgeTake([assignee], { operatorIds: ["id:octo"] })).toMatchObject({
      ok: false,
      reason: "foreign",
    });
  });

  it("matches a Jira or Linear assignee object by its account id", () => {
    expect(judgeTake([{ accountId: JIRA_ID }], { me: JIRA_ID })).toEqual({
      ok: true,
    });
  });

  it("matches a plain Jira or Linear account id against an id: entry", () => {
    for (const tracker of ["jira", "linear"]) {
      expect(
        judgeTake([JIRA_ID], {
          me: OTHER,
          operatorIds: [`id:${JIRA_ID}`],
          tracker,
        })
      ).toEqual({ ok: true });
    }
  });

  it("never matches a plain GitHub login against an id: entry", () => {
    expect(
      judgeTake(["583231"], { operatorIds: ["id:583231"], tracker: "github" })
    ).toMatchObject({ ok: false, reason: "foreign" });
    expect(
      judgeTake(["octo"], { operatorIds: ["login:octo"], tracker: "github" })
    ).toEqual({ ok: true });
  });
});
