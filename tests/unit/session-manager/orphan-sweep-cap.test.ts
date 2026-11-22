/**
 * The orphan sweep's per-cycle cap (CodySwannGT/lisa#4722).
 *
 * Writes per cycle are capped and spent in a fixed order (finish, return,
 * re-dispatch, park, hold lifts); the rest are deferred to the next cycle.
 * Skips, lookups and parks that already explain themselves cost nothing,
 * and every kept hold is listed so the operator's list is whole.
 * @module tests/unit/session-manager/orphan-sweep-cap
 */
import { describe, expect, it } from "vitest";

import {
  CLAIMED,
  CREDENTIAL,
  MERGED_URL,
  NEEDED,
  RECENT,
  TOPIC,
  heldBody,
  hold,
  orphan,
  plan,
  ref,
} from "./support/orphan-fixtures.js";

describe("the cap", () => {
  it("orders doneReady, return, redispatch, parked, then hold lifts, and defers the rest", () => {
    const merged = { url: MERGED_URL, state: "merged" };
    const open = { url: MERGED_URL, state: "open" };
    const result = plan(
      {
        items: [
          orphan(1, { labels: [CLAIMED, NEEDED] }),
          orphan(2, { pr: open }),
          orphan(3),
          orphan(4, { pr: merged }),
        ],
        holds: [hold(5, { body: heldBody(TOPIC) })],
      },
      { max: 2 }
    );
    expect(result.doneReady.map(entry => entry.ref)).toEqual([ref(4)]);
    expect(result.return.map(entry => entry.ref)).toEqual([ref(3)]);
    expect(result.redispatch).toEqual([]);
    expect(result.parked).toEqual([]);
    expect(result.holds.lift).toEqual([]);
    expect(result.deferred).toEqual([
      { ref: ref(2), bucket: "redispatch" },
      { ref: ref(1), bucket: "parked" },
      { ref: ref(5), bucket: "lift" },
    ]);
  });

  it("does not count skips, lookups or already-explained parks against max", () => {
    const result = plan(
      {
        items: [
          orphan(1, { updatedAt: RECENT }),
          orphan(2, { pr: undefined }),
          orphan(3, { body: heldBody(CREDENTIAL) }),
          orphan(4),
        ],
      },
      { max: 1 }
    );
    expect(result.return.map(entry => entry.ref)).toEqual([ref(4)]);
    expect(result.parked.map(entry => entry.ref)).toEqual([ref(3)]);
    expect(result.lookup.map(entry => entry.ref)).toEqual([ref(2)]);
    expect(result.deferred).toEqual([]);
  });

  it("bounds PR lookups by max too", () => {
    const items = [1, 2, 3].map(n => orphan(n, { pr: undefined }));
    const result = plan({ items }, { max: 2 });
    expect(result.lookup.map(entry => entry.ref)).toEqual([ref(1), ref(2)]);
    expect(result.deferred).toEqual([{ ref: ref(3), bucket: "lookup" }]);
  });

  it("lists every kept hold whatever the cap, so the operator's list is whole", () => {
    const result = plan({ holds: [hold(1), hold(2)] }, { max: 0 });
    expect(result.holds.keep.map(entry => entry.ref)).toEqual([ref(1), ref(2)]);
  });
});
