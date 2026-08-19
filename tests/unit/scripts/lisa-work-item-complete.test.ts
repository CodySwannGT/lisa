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

import { mergedPullRequestsIn } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

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
