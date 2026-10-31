/**
 * The ledger side of "mark and move on" (CodySwannGT/lisa#4555, part 3).
 *
 * Pins the crash-safety order (a question recorded before its tracker mark
 * shows `markedAt: null` until `recordMarked`), that a re-ask keeps the mark
 * so the manager never marks an item twice or forgets what to remove, that a
 * queued answer survives only a re-ping of the same text, that
 * `--reset-attempts` zeroes the count, and the `status` listing.
 * @module tests/unit/session-manager/ledger-questions
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingQuestion,
  readLedger,
  recordSpawn,
  setPendingQuestion,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/ledger.mjs";
import {
  listPendingQuestions,
  queueAnswer,
  recordMarked,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/ledger-questions.mjs";

const REF = "TEAM-7";
const QUESTION = "Which option?";
const LABEL = "custom:needs-person";

/**
 * A clock that advances one minute per reading.
 * @returns The clock
 */
function makeClock() {
  const start = Date.parse("2026-10-12T09:00:00.000Z");
  const state = { count: 0 };
  return () => new Date(start + 60_000 * state.count++);
}

describe("ledger questions", () => {
  const roots: string[] = [];
  const root = () => roots[0] as string;
  const seams = { now: makeClock() };

  beforeEach(() => {
    roots.unshift(mkdtempSync(path.join(tmpdir(), "sm-ledger-q-")));
    seams.now = makeClock();
  });
  afterEach(() => {
    for (const dir of roots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Ask the question with a kind.
   * @param text - Question text
   * @param kind - Kind, or undefined to keep the previous one
   * @returns Updated item
   */
  const ask = (text = QUESTION, kind: string | null = "decision") =>
    setPendingQuestion(
      root(),
      {
        ref: REF,
        text,
        telegramMessageId: null,
        ...(kind === null ? {} : { kind }),
      },
      seams
    );

  it("is unmarked until the mark is read back, then keeps it on a re-ask", async () => {
    expect((await ask()).pendingQuestion?.markedAt).toBeNull();
    const marked = await recordMarked(
      root(),
      { ref: REF, markerType: "label", marker: LABEL },
      seams
    );
    const markedAt = marked.pendingQuestion?.markedAt;
    expect(markedAt).toEqual(expect.any(String));
    const reasked = await ask("New wording", null);
    expect(reasked.pendingQuestion).toMatchObject({
      kind: "decision",
      markerType: "label",
      marker: LABEL,
      markedAt,
      text: "New wording",
    });
  });

  it("keeps a queued answer only across a re-ping of the same text", async () => {
    await ask();
    await queueAnswer(root(), { ref: REF, source: "cli", text: "A" }, seams);
    expect((await ask()).pendingQuestion?.answer).toMatchObject({ text: "A" });
    expect((await ask("Changed")).pendingQuestion?.answer).toBeNull();
  });

  it("refuses a mark or an answer with no pending question", async () => {
    await recordSpawn(
      root(),
      { ref: REF, worker: "wk", sessionId: null, repo: "." },
      seams
    );
    await expect(
      recordMarked(
        root(),
        { ref: REF, markerType: "label", marker: LABEL },
        seams
      )
    ).rejects.toThrow(/no pending question/);
    await expect(
      queueAnswer(root(), { ref: REF, source: "cli", text: "A" }, seams)
    ).rejects.toThrow(/no pending question/);
    await expect(
      recordMarked(
        root(),
        { ref: REF, markerType: "tag", marker: LABEL },
        seams
      )
    ).rejects.toThrow(/label or role/);
  });

  it("resets attempts only when asked", async () => {
    await recordSpawn(
      root(),
      { ref: REF, worker: "wk", sessionId: null, repo: "." },
      seams
    );
    await ask();
    expect(
      (await clearPendingQuestion(root(), { ref: REF }, seams)).attempts
    ).toBe(1);
    await ask();
    const reset = await clearPendingQuestion(
      root(),
      { ref: REF, resetAttempts: true },
      seams
    );
    expect(reset.attempts).toBe(0);
  });

  it("lists pending questions oldest first with the answer command", async () => {
    await ask();
    await setPendingQuestion(
      root(),
      {
        ref: "TEAM-8",
        text: "Later?",
        telegramMessageId: null,
        kind: "repo-route",
      },
      seams
    );
    const rows = listPendingQuestions(
      await readLedger(root()),
      ref => `answer ${ref}`
    );
    expect(rows.map(row => [row.ref, row.kind, row.marked])).toEqual([
      [REF, "decision", false],
      ["TEAM-8", "repo-route", false],
    ]);
    expect(rows[0]?.answerCommand).toBe(`answer ${REF}`);
  });
});
