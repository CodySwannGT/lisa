/**
 * The orphan half of the session manager's sweep (CodySwannGT/lisa#4722).
 *
 * Reconcile used to look only at the manager's own ledger, so items left in
 * the `claimed` role by an earlier manager, a dead worker or a completion
 * step that never ran were never revisited. `planOrphanSweep` skips what is
 * not the sweep's to touch and buckets the rest: finish, return,
 * re-dispatch or park. Pure: no I/O.
 * @module tests/unit/session-manager/orphan-sweep
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORPHAN_MAX,
  DEFAULT_STALE_HOURS,
  SWEEP_COMMENT_PREFIX,
  planOrphanSweep,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/orphan-sweep.mjs";
import {
  CLAIMED,
  CREDENTIAL,
  ME,
  MERGED_URL,
  NEEDED,
  OPERATOR,
  OPTS,
  RECENT,
  STRANGER,
  heldBody,
  orphan,
  plan,
  ref,
} from "./support/orphan-fixtures.js";

describe("planOrphanSweep defaults", () => {
  it("caps at 10 writes and calls an item stale after 6 hours", () => {
    expect(DEFAULT_ORPHAN_MAX).toBe(10);
    expect(DEFAULT_STALE_HOURS).toBe(6);
  });

  it("needs a clock: now is required and must be a real time", () => {
    expect(() => planOrphanSweep({ items: [] }, { ...OPTS, now: "x" })).toThrow(
      /now/
    );
  });

  it("refuses a negative or fractional max", () => {
    expect(() => plan({ items: [] }, { max: -1 })).toThrow(/max/);
    expect(() => plan({ items: [] }, { max: 1.5 })).toThrow(/max/);
  });
});

describe("orphans: who is never touched", () => {
  it("skips a ref the ledger shows live (running or question)", () => {
    const result = plan({ items: [orphan(1)] }, { liveRefs: [ref(1)] });
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "live" }]);
    expect(result.return).toEqual([]);
  });

  it("skips an item assigned to someone who is neither me nor an operator", () => {
    const result = plan({ items: [orphan(1, { assignees: [STRANGER] })] });
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "foreign" }]);
  });

  it("keeps an item assigned to me or to an operator", () => {
    const result = plan({
      items: [
        orphan(1, { assignees: [ME] }),
        orphan(2, { assignees: [{ login: OPERATOR, id: 77 }] }),
      ],
    });
    expect(result.return.map(entry => entry.ref)).toEqual([ref(1), ref(2)]);
  });

  it("matches an id: operator entry against the assignee's account id", () => {
    const result = plan(
      { items: [orphan(1, { assignees: [{ login: "x", id: 77 }] })] },
      { operatorIds: ["id:77"] }
    );
    expect(result.return.map(entry => entry.ref)).toEqual([ref(1)]);
  });

  it("treats every assigned item as foreign when no me and no operators are known", () => {
    const result = plan(
      { items: [orphan(1, { assignees: [ME] })] },
      { me: null, operatorIds: [] }
    );
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "foreign" }]);
  });

  it("skips an item touched within staleHours (someone may be working it by hand)", () => {
    const result = plan({ items: [orphan(1, { updatedAt: RECENT })] });
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "fresh" }]);
    const longer = plan(
      { items: [orphan(1, { updatedAt: RECENT })] },
      { staleHours: 1 }
    );
    expect(longer.return.map(entry => entry.ref)).toEqual([ref(1)]);
  });

  it("skips an item with no readable updatedAt rather than guess its age", () => {
    const result = plan({ items: [orphan(1, { updatedAt: "soon" })] });
    expect(result.skipped).toEqual([{ ref: ref(1), reason: "undated" }]);
  });

  it("skips an entry with no ref", () => {
    const result = plan({ items: [{ ...orphan(1), ref: " " }] });
    expect(result.skipped).toEqual([{ ref: null, reason: "no ref" }]);
  });
});

describe("orphans: buckets", () => {
  it("asks for a PR lookup when pr is undefined", () => {
    const result = plan({ items: [orphan(1, { pr: undefined })] });
    expect(result.lookup).toEqual([
      { ref: ref(1), reason: expect.stringContaining("pull request") },
    ]);
    expect(result.return).toEqual([]);
  });

  it("finishes an item whose PR merged (doneReady)", () => {
    const result = plan({
      items: [orphan(1, { pr: { url: MERGED_URL, state: "merged" } })],
    });
    expect(result.doneReady).toEqual([
      {
        ref: ref(1),
        prUrl: MERGED_URL,
        reason: expect.stringContaining("merged"),
      },
    ]);
  });

  it("re-dispatches an item with an open PR and no live worker", () => {
    const result = plan({
      items: [orphan(1, { pr: { url: MERGED_URL, state: "open" } })],
    });
    expect(result.redispatch).toEqual([
      {
        ref: ref(1),
        prUrl: MERGED_URL,
        reason: expect.stringContaining("open pull request"),
      },
    ]);
  });

  it.each([
    ["no PR", null],
    ["a closed PR", { url: MERGED_URL, state: "closed" }],
  ])("returns an item with %s to the ready role with a comment", (_, pr) => {
    const result = plan({ items: [orphan(1, { pr })] });
    expect(result.return).toHaveLength(1);
    expect(result.return[0]?.comment).toBe(
      `${SWEEP_COMMENT_PREFIX} Returned to Ready: claimed for 3 days with no live worker and no open or merged pull request.`
    );
  });

  it("says hours when the item is less than two days old", () => {
    const result = plan(
      { items: [orphan(1, { updatedAt: "2026-11-13T03:00:00Z" })] },
      { staleHours: 1 }
    );
    expect(result.return[0]?.comment).toContain("claimed for 9 hours");
  });

  it("parks a held item, suggesting a comment when the item does not say why", () => {
    const result = plan({
      items: [orphan(1, { labels: [CLAIMED, NEEDED] })],
    });
    expect(result.parked).toEqual([
      {
        ref: ref(1),
        reason: expect.any(String),
        reasonOnItem: false,
        comment: expect.stringMatching(/^\[lisa-session-manager\] Parked:/),
      },
    ]);
  });

  it("parks without a comment when the body carries a [lisa-human-gate] marker", () => {
    const result = plan({ items: [orphan(1, { body: heldBody(CREDENTIAL) })] });
    expect(result.parked).toEqual([
      { ref: ref(1), reason: expect.any(String), reasonOnItem: true },
    ]);
  });

  it("parks without a comment when a manager comment already states the hold", () => {
    const result = plan({
      items: [
        orphan(1, {
          labels: [CLAIMED, NEEDED],
          comments: [
            { body: `${SWEEP_COMMENT_PREFIX} Parked: waiting on a person.` },
          ],
        }),
      ],
    });
    expect(result.parked[0]?.reasonOnItem).toBe(true);
    expect(result.parked[0]).not.toHaveProperty("comment");
  });

  it("checks the merged PR before the hold: a merged item is finished, not parked", () => {
    const result = plan({
      items: [
        orphan(1, {
          labels: [CLAIMED, NEEDED],
          pr: { url: MERGED_URL, state: "merged" },
        }),
      ],
    });
    expect(result.doneReady.map(entry => entry.ref)).toEqual([ref(1)]);
    expect(result.parked).toEqual([]);
  });

  it("starts every comment it suggests with [lisa-session-manager]", () => {
    const result = plan({
      items: [orphan(1), orphan(2, { labels: [CLAIMED, NEEDED] })],
    });
    const comments = [...result.return, ...result.parked].map(
      entry => entry.comment
    );
    expect(comments).toHaveLength(2);
    for (const comment of comments) {
      expect(comment?.startsWith("[lisa-session-manager] ")).toBe(true);
    }
  });
});
