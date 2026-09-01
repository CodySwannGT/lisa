/**
 * Evidence filtering for work-item completion.
 *
 * The lane this protects had drifted completely: 27 of 27 open items carrying
 * the claimed role already had a merged pull request, so the lane reported 27
 * things in flight when the real number was one. Closing at merge time is the
 * fix; this filter is what decides whether a given item has actually shipped.
 *
 * Two ways it can be wrong, and only one of them is loud:
 *
 * - Too STRICT and nothing gets completed, which is visible immediately.
 * - Too LOOSE and items get closed on the strength of a cross-reference from
 *   somewhere else entirely. Measured while building this: a first pass that
 *   ignored `repository_url` credited issues with fixes living in other
 *   repositories, which is the difference between "shipped" and "somebody
 *   mentioned it". That failure closes real work and looks like success.
 * @module tests/unit/scripts/lisa-work-item-complete
 */

import { describe, expect, it } from "vitest";

import {
  carriesLabel,
  competingLifecycleRoles,
  labelNamesOf,
  mergedPullRequestsIn,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

const REPO = "CodySwannGT/lisa";
const API = "https://api.github.com/repos";

/**
 * A cross-referenced timeline event.
 * @param options Shape of the referencing item.
 * @param options.number Its number.
 * @param options.repo Repository it lives in.
 * @param options.merged Whether it is a merged pull request.
 * @param options.isPr Whether it is a pull request at all.
 * @returns The event payload.
 */
function crossRef({
  number,
  repo = REPO,
  merged = true,
  isPr = true,
}: {
  number: number;
  repo?: string;
  merged?: boolean;
  isPr?: boolean;
}) {
  return {
    event: "cross-referenced",
    source: {
      issue: {
        number,
        repository_url: `${API}/${repo}`,
        pull_request: isPr
          ? { merged_at: merged ? "2026-08-19T10:00:00Z" : null }
          : undefined,
      },
    },
  };
}

describe("mergedPullRequestsIn", () => {
  it("finds a merged pull request in the same repository", () => {
    expect(mergedPullRequestsIn([crossRef({ number: 2733 })], REPO)).toEqual([
      2733,
    ]);
  });

  it("ignores a merged pull request in a DIFFERENT repository", () => {
    // The loose-filter failure. A downstream consumer's PR mentioning an
    // upstream issue is not evidence the upstream issue shipped.
    expect(
      mergedPullRequestsIn(
        [crossRef({ number: 6634, repo: "SomeOrg/consumer" })],
        REPO
      )
    ).toEqual([]);
  });

  it("is not fooled by a repository whose name merely ends the same way", () => {
    // `endswith("/lisa")` would match `Other/lisa`. The owner is part of the
    // identity, so the comparison includes it.
    expect(
      mergedPullRequestsIn([crossRef({ number: 5, repo: "Other/lisa" })], REPO)
    ).toEqual([]);
  });

  it("ignores an OPEN pull request", () => {
    expect(
      mergedPullRequestsIn([crossRef({ number: 10, merged: false })], REPO)
    ).toEqual([]);
  });

  it("ignores a cross-referenced ISSUE that is not a pull request", () => {
    expect(
      mergedPullRequestsIn([crossRef({ number: 11, isPr: false })], REPO)
    ).toEqual([]);
  });

  it("ignores events that are not cross-references", () => {
    expect(
      mergedPullRequestsIn(
        [{ event: "labeled" }, { event: "closed" }, crossRef({ number: 12 })],
        REPO
      )
    ).toEqual([12]);
  });

  it("de-duplicates a pull request referenced more than once", () => {
    expect(
      mergedPullRequestsIn(
        [crossRef({ number: 2733 }), crossRef({ number: 2733 })],
        REPO
      )
    ).toEqual([2733]);
  });

  it("returns nothing for an empty or malformed timeline", () => {
    // The absent case. An unreadable timeline must produce NO evidence, so a
    // completion refuses rather than proceeding on a shape it could not read.
    expect(mergedPullRequestsIn([], REPO)).toEqual([]);
    expect(mergedPullRequestsIn(undefined as never, REPO)).toEqual([]);
    expect(
      mergedPullRequestsIn([null, {}, { source: {} }] as never, REPO)
    ).toEqual([]);
  });

  it("collects several merged pull requests against one item", () => {
    // Real shape: one issue in this repository was fixed across six.
    expect(
      mergedPullRequestsIn(
        [2705, 2708, 2709].map(number => crossRef({ number })),
        REPO
      )
    ).toEqual([2705, 2708, 2709]);
  });
});

const READY = "status:ready";
const CLAIMED = "status:in-progress";
const BLOCKED = "status:blocked";
const ON_DEV = "status:on-dev";
const ON_STG = "status:on-stg";
const TERMINAL = "status:done";
const READY_SHOUTED = "Status:Ready";
const TYPE_BUG = "type:Bug";

/** The role set a default GitHub project configures. */
const ROLES = [READY, CLAIMED, BLOCKED, ON_DEV, ON_STG, TERMINAL];

describe("labelNamesOf", () => {
  it("keeps the tracker's own spelling", () => {
    // Folding here would be silent damage: the name goes straight back to the
    // API as the label to remove.
    expect(labelNamesOf([{ name: READY_SHOUTED }])).toEqual([READY_SHOUTED]);
  });

  it("accepts both plain strings and label objects", () => {
    expect(labelNamesOf([TYPE_BUG, { name: TERMINAL }])).toEqual([
      TYPE_BUG,
      TERMINAL,
    ]);
  });

  it("returns nothing for a payload that is not a list", () => {
    expect(labelNamesOf(undefined)).toEqual([]);
    expect(labelNamesOf({ name: TERMINAL })).toEqual([]);
  });

  it("drops entries with no usable name", () => {
    expect(labelNamesOf([{ name: "  " }, {}, null, 7, "  ok  "])).toEqual([
      "ok",
    ]);
  });
});

describe("carriesLabel", () => {
  it("matches regardless of case", () => {
    expect(carriesLabel(["Status:Done"], TERMINAL)).toBe(true);
  });

  it("does not match a label that merely contains the name", () => {
    expect(carriesLabel([`${TERMINAL}-ish`], TERMINAL)).toBe(false);
  });

  it("is false over an empty label set", () => {
    expect(carriesLabel([], TERMINAL)).toBe(false);
  });
});

describe("competingLifecycleRoles", () => {
  it("returns every lifecycle role except the terminal one being applied", () => {
    // The reported failure: an item that accumulated roles on the way through.
    expect(
      competingLifecycleRoles(
        [READY, BLOCKED, ON_DEV, TYPE_BUG],
        ROLES,
        TERMINAL
      )
    ).toEqual([READY, BLOCKED, ON_DEV]);
  });

  it("never returns the terminal role itself", () => {
    // A naive "remove every lifecycle role" would retire the label being added.
    expect(competingLifecycleRoles([TERMINAL], ROLES, TERMINAL)).toEqual([]);
  });

  it("returns only roles the item actually carries", () => {
    // Removing an absent label is a 404, which turns a clean completion into a
    // failure and makes a second run fail where the first succeeded.
    expect(competingLifecycleRoles([BLOCKED], ROLES, TERMINAL)).toEqual([
      BLOCKED,
    ]);
  });

  it("leaves type, component, priority and provenance labels alone", () => {
    expect(
      competingLifecycleRoles(
        [TYPE_BUG, "component:plugins", "priority:high", "self-hardening"],
        ROLES,
        TERMINAL
      )
    ).toEqual([]);
  });

  it("reports the role in the tracker's spelling, not the configured one", () => {
    expect(competingLifecycleRoles([READY_SHOUTED], ROLES, TERMINAL)).toEqual([
      READY_SHOUTED,
    ]);
  });

  it("de-duplicates a role the tracker reports twice", () => {
    expect(
      competingLifecycleRoles([READY, READY_SHOUTED], ROLES, TERMINAL)
    ).toEqual([READY]);
  });

  it("finds nothing when no roles are configured", () => {
    // An unconfigured role set must reconcile NOTHING rather than everything —
    // the failure that removes labels it was never told about is the worse one.
    expect(competingLifecycleRoles([READY], [], TERMINAL)).toEqual([]);
    expect(
      competingLifecycleRoles([READY], undefined as never, TERMINAL)
    ).toEqual([]);
  });

  it("treats an absent terminal as keeping nothing back", () => {
    expect(
      competingLifecycleRoles([TERMINAL], ROLES, undefined as never)
    ).toEqual([TERMINAL]);
  });
});
