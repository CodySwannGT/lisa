/**
 * Orphan-bucketing edge cases from review (CodySwannGT/lisa#4722): an item in
 * the `review` role with an open pull request is waiting on review or merge,
 * so it is parked, never re-dispatched; an item whose pull request merged but
 * whose completion was refused goes back to the `ready` role with a note that
 * the code work is done (CodySwannGT/lisa#4906), unless a person holds it; and
 * a closed pull request sends the item back to the `ready` role, naming that
 * pull request as earlier work.
 * @module tests/unit/session-manager/orphan-sweep-review
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FINISH_REFUSED_PREFIX,
  FINISH_RETRY_HOURS,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/orphan-sweep.mjs";
import { MERGED_URL, orphan, plan, ref } from "./support/orphan-fixtures.js";

const OPEN = { url: MERGED_URL, state: "open" };
const MERGED = { url: MERGED_URL, state: "merged" };
const CLOSED = { url: MERGED_URL, state: "closed" };

describe("review-role items", () => {
  it("parks an item in the review role with an open PR, without a comment", () => {
    const result = plan({
      items: [orphan(1, { role: "review", labels: [], pr: OPEN })],
    });
    expect(result.redispatch).toEqual([]);
    expect(result.parked).toEqual([
      {
        ref: ref(1),
        reason: expect.stringContaining("review"),
        reasonOnItem: true,
      },
    ]);
  });

  it("does not spend the cap on a review-role item", () => {
    const result = plan(
      {
        items: [
          orphan(1, { role: "review", pr: OPEN }),
          orphan(2, { pr: null }),
        ],
      },
      { max: 1 }
    );
    expect(result.parked.map(entry => entry.ref)).toEqual([ref(1)]);
    expect(result.return.map(entry => entry.ref)).toEqual([ref(2)]);
    expect(result.deferred).toEqual([]);
  });

  it("re-dispatches only a claimed-role item with an open PR", () => {
    const result = plan({ items: [orphan(1, { pr: OPEN })] });
    expect(result.redispatch.map(entry => entry.ref)).toEqual([ref(1)]);
  });
});

describe("refused completions", () => {
  it("names a stable prefix every refusal comment starts with", () => {
    expect(FINISH_REFUSED_PREFIX).toBe(
      "[lisa-session-manager] Cannot complete:"
    );
  });

  it("is the same text the skill tells the manager to post", () => {
    const skill = readFileSync(
      path.join(
        process.cwd(),
        "plugins/src/base/skills/lisa-session-manager/SKILL.md"
      ),
      "utf8"
    );
    expect(skill).toContain(`\`${FINISH_REFUSED_PREFIX}\``);
  });

  it.each([
    ["an hour ago", "2026-11-13T11:00:00Z"],
    ["with no date", undefined],
    ["with an unreadable date", "soon"],
  ])(
    "returns a merged item whose completion was refused %s to Ready, naming the merged work",
    (_, createdAt) => {
      const result = plan({
        items: [
          orphan(1, {
            pr: MERGED,
            comments: [
              {
                body: `${FINISH_REFUSED_PREFIX} the deploy proof is missing.`,
                ...(createdAt === undefined ? {} : { createdAt }),
              },
            ],
          }),
        ],
      });
      expect(result.doneReady).toEqual([]);
      expect(result.parked).toEqual([]);
      expect(result.return).toEqual([
        {
          ref: ref(1),
          prUrl: MERGED_URL,
          reason: expect.stringContaining("completion was refused"),
          comment: expect.stringContaining(MERGED_URL),
        },
      ]);
      const comment = result.return[0]?.comment ?? "";
      expect(
        comment.startsWith("[lisa-session-manager] Returned to Ready:")
      ).toBe(true);
      expect(comment).toMatch(/merged/u);
      expect(comment).toMatch(/not redo/u);
    }
  );

  it("parks a refused merged item that a person holds, instead of returning it", () => {
    const result = plan({
      items: [
        orphan(1, {
          pr: MERGED,
          labels: ["human-needed"],
          comments: [
            {
              body: `${FINISH_REFUSED_PREFIX} the deploy proof is missing.`,
              createdAt: "2026-11-13T11:00:00Z",
            },
          ],
        }),
      ],
    });
    expect(result.return).toEqual([]);
    expect(result.doneReady).toEqual([]);
    expect(result.parked.map(entry => entry.ref)).toEqual([ref(1)]);
  });

  it("retries finishing once the refusal is older than 24 hours", () => {
    expect(FINISH_RETRY_HOURS).toBe(24);
    const result = plan({
      items: [
        orphan(1, {
          pr: MERGED,
          comments: [
            {
              body: `${FINISH_REFUSED_PREFIX} the deploy proof is missing.`,
              createdAt: "2026-11-12T11:00:00Z",
            },
          ],
        }),
      ],
    });
    expect(result.parked).toEqual([]);
    expect(result.doneReady.map(entry => entry.ref)).toEqual([ref(1)]);
  });

  it("ignores the phrase when it is not the start of a comment line", () => {
    const result = plan({
      items: [
        orphan(1, {
          pr: MERGED,
          comments: [{ body: `Quoting: ${FINISH_REFUSED_PREFIX} x` }],
        }),
      ],
    });
    expect(result.doneReady.map(entry => entry.ref)).toEqual([ref(1)]);
  });
});

describe("closed pull requests", () => {
  it("returns an item whose only PR was closed to the ready role, naming that PR", () => {
    const result = plan({ items: [orphan(1, { pr: CLOSED })] });
    expect(result.return.map(entry => entry.ref)).toEqual([ref(1)]);
    expect(result.return[0]?.comment).toContain(MERGED_URL);
    expect(result.return[0]?.comment).toMatch(/closed without merging/u);
    expect(result.redispatch).toEqual([]);
    expect(result.doneReady).toEqual([]);
  });
});
