/**
 * Tests for the pull-request backlink comparison.
 *
 * The gate proves a change is bound to its own work item, and the comment
 * fallback compared with `includes` against a URL ending in the PR number. So a
 * comment linking PR #123 satisfied the gate for PR #12, because `.../pull/12`
 * is a prefix of `.../pull/123`.
 *
 * Every assertion here is on the returned boolean rather than on an exit code
 * or a thrown error, because a permissive comparison returns `true` — nothing
 * observable changes without asserting the value directly, which is why the
 * defect survived a full suite.
 * @module tests/unit/scripts/work-item-backlink-exactness
 */

import { describe, expect, it } from "vitest";

import { textContainsBacklink } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

const MARKER = "[lisa-pr-link]";
const BASE = "https://github.com/CodySwannGT/lisa/pull";
const PR_12 = `${BASE}/12`;
const PR_123 = `${BASE}/123`;
const LINKS_123 = `${MARKER} ${PR_123}`;

describe("textContainsBacklink", () => {
  it("refuses a link to a pull request whose number merely starts the same", () => {
    // The defect, stated as the assertion that failed before the fix.
    expect(textContainsBacklink(LINKS_123, PR_12)).toBe(false);
  });

  it("accepts the pull request actually linked", () => {
    expect(textContainsBacklink(LINKS_123, PR_123)).toBe(true);
  });

  it("refuses a longer number that merely extends the linked one", () => {
    // The prefix relation runs both ways; only one direction was reachable
    // through `includes`, so assert the other rather than assume it.
    expect(textContainsBacklink(LINKS_123, `${BASE}/1234`)).toBe(false);
  });

  it("still requires the marker, not merely the URL", () => {
    // The marker is what distinguishes a deliberate backlink from a passing
    // mention of the pull request in prose.
    expect(textContainsBacklink(`see ${PR_123} for context`, PR_123)).toBe(
      false
    );
  });

  it("tolerates punctuation a writer wraps around the URL", () => {
    // Token equality must not be so strict that it rejects valid backlinks;
    // failing closed here would merely annoy, but it would still be wrong.
    expect(textContainsBacklink(`${MARKER} <${PR_123}>`, PR_123)).toBe(true);
    expect(textContainsBacklink(`${MARKER} ${PR_123}.`, PR_123)).toBe(true);
    expect(textContainsBacklink(`${MARKER} ${PR_123}`, PR_123)).toBe(true);
  });

  it("searches arrays and objects, as the tracker payloads require", () => {
    expect(textContainsBacklink([{ body: LINKS_123 }], PR_123)).toBe(true);
    expect(textContainsBacklink([{ body: LINKS_123 }], PR_12)).toBe(false);
    expect(textContainsBacklink({ nodes: [LINKS_123] }, PR_123)).toBe(true);
  });

  it("returns false for values that carry no text at all", () => {
    expect(textContainsBacklink(null, PR_123)).toBe(false);
    expect(textContainsBacklink(undefined, PR_123)).toBe(false);
    expect(textContainsBacklink(42, PR_123)).toBe(false);
  });
});
