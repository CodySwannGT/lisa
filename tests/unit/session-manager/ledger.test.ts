/**
 * Contract tests for the session manager's ledger.
 *
 * The ledger is where attempts live, and that is deliberate: a counter kept in
 * append-only tracker comments re-blocked recovered items because the old
 * comments never went away. So the tests pin three things: attempts climb per
 * ref in the ledger file, a torn write can never leave half a ledger behind,
 * and nothing here knows a tracker exists.
 * @module tests/unit/session-manager/ledger
 */
import {
  type PathLike,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendSessionEvent,
  clearPendingQuestion,
  ledgerPath,
  readLedger,
  recordFinish,
  recordProgress,
  recordSpawn,
  sessionsLogPath,
  setControl,
  setPendingQuestion,
  writeLedger,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/ledger.mjs";

/** The ref every lifecycle test drives. */
const REF = "TEAM-12";

/** A worker name for {@link REF}. */
const WORKER = "wk-TEAM-12-1012-0900";

/** The first clock reading, and the one a minute later. */
const T0 = "2026-10-12T09:00:00.000Z";
const T1 = "2026-10-12T09:01:00.000Z";

/** A pending question not yet marked on the tracker or answered (#4555). */
const UNMARKED = {
  markerType: null,
  marker: null,
  markedAt: null,
  managerCommentIds: [],
  answer: null,
} as const;

/** The question the lifecycle tests ask. */
const QUESTION = "Which option?";

/** The state directory, relative to the project root. */
const STATE_SEGMENTS = [".lisa", "session-manager"] as const;

/**
 * A clock that advances one minute per reading, from a fixed start.
 * @returns {() => Date} The clock
 */
const makeClock = () => {
  const start = Date.parse(T0);
  const readings = { count: 0 };
  return () => new Date(start + 60_000 * readings.count++);
};

describe("ledger", () => {
  let root = "";
  let seams: { now: () => Date };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-sm-ledger-"));
    seams = { now: makeClock() };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const spawn = (sessionId: string, worker = WORKER) =>
    recordSpawn(root, { ref: REF, worker, sessionId, repo: "repo-a" }, seams);

  it("lives under .lisa/session-manager", () => {
    expect(ledgerPath(root)).toBe(
      path.join(root, ...STATE_SEGMENTS, "ledger.json")
    );
    expect(sessionsLogPath(root)).toBe(
      path.join(root, ...STATE_SEGMENTS, "sessions.jsonl")
    );
  });

  it("reads a missing file as an empty ledger", async () => {
    expect(await readLedger(root)).toEqual({
      version: 1,
      items: {},
      control: { paused: false, maxWorkers: null, me: null },
      validationFailures: {},
    });
  });

  it("refuses a corrupt ledger instead of silently resetting attempts", async () => {
    await writeLedger(root, await readLedger(root));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(ledgerPath(root), "{not json");
    await expect(readLedger(root)).rejects.toThrow(/ledger/);
  });

  it("writes atomically through a temp file and rename", async () => {
    const renames: Array<[string, string]> = [];
    const fs = await import("node:fs/promises");
    const spyFs = {
      ...fs,
      rename: async (from: PathLike, to: PathLike) => {
        renames.push([String(from), String(to)]);
        expect(existsSync(to)).toBe(false);
        return fs.rename(from, to);
      },
    };
    await writeLedger(root, await readLedger(root), { fs: spyFs });
    expect(renames).toEqual([
      [expect.stringMatching(/ledger\.json\..+\.tmp$/), ledgerPath(root)],
    ]);
    expect(readdirSync(path.dirname(ledgerPath(root)))).toEqual([
      "ledger.json",
    ]);
  });

  it("counts attempts per ref and keeps a history", async () => {
    const first = await spawn("s1");
    expect(first).toMatchObject({
      repo: "repo-a",
      worker: WORKER,
      sessionId: "s1",
      status: "running",
      attempts: 1,
      startedAt: T0,
      pendingQuestion: null,
    });
    const second = await spawn("s2", "wk-TEAM-12-1012-0930");
    expect(second.attempts).toBe(2);
    expect(second.history.map((row: { event: string }) => row.event)).toEqual([
      "spawn",
      "spawn",
    ]);
    const other = await recordSpawn(
      root,
      {
        ref: "TEAM-13",
        worker: "wk-TEAM-13-1012-0900",
        sessionId: "s3",
        repo: "repo-a",
      },
      seams
    );
    expect(other.attempts).toBe(1);
    const onDisk = JSON.parse(readFileSync(ledgerPath(root), "utf8"));
    expect(onDisk.items[REF].attempts).toBe(2);
  });

  it("runs the pending-question lifecycle", async () => {
    await spawn("s1");
    const asked = await setPendingQuestion(
      root,
      { ref: REF, text: QUESTION, telegramMessageId: 7 },
      seams
    );
    expect(asked.pendingQuestion).toEqual({
      text: QUESTION,
      kind: "worker-question",
      askedAt: T1,
      lastPingAt: T1,
      telegramMessageId: 7,
      ...UNMARKED,
    });
    const repinged = await setPendingQuestion(
      root,
      { ref: REF, text: QUESTION, telegramMessageId: 9 },
      seams
    );
    expect(repinged.pendingQuestion).toEqual({
      text: QUESTION,
      kind: "worker-question",
      askedAt: T1,
      lastPingAt: "2026-10-12T09:02:00.000Z",
      telegramMessageId: 9,
      ...UNMARKED,
    });
    const cleared = await clearPendingQuestion(root, { ref: REF }, seams);
    expect(cleared.pendingQuestion).toBeNull();
  });

  it("records a routing question for a ref that has not been dispatched", async () => {
    const entry = await setPendingQuestion(
      root,
      { ref: "TEAM-14", text: "Which repo?", telegramMessageId: 3 },
      seams
    );
    expect(entry).toMatchObject({
      attempts: 0,
      worker: null,
      status: "question",
    });
  });

  it("moves lastProgressAt only when the logs hash changes", async () => {
    await spawn("s1");
    const changed = await recordProgress(
      root,
      { ref: REF, logsHash: "h1" },
      seams
    );
    expect(changed).toMatchObject({ changed: true });
    expect(changed.entry).toMatchObject({
      logsHash: "h1",
      lastProgressAt: T1,
    });
    const same = await recordProgress(
      root,
      { ref: REF, logsHash: "h1" },
      seams
    );
    expect(same.changed).toBe(false);
    expect(same.entry.lastProgressAt).toBe(T1);
  });

  it.each([
    ["DONE", "PR merged"],
    ["FAILED", "deploy gate red"],
  ] as const)("records %s with its reason", async (status, reason) => {
    await spawn("s1");
    const entry = await recordFinish(root, { ref: REF, status, reason }, seams);
    expect(entry).toMatchObject({
      status,
      reason,
      finishedAt: T1,
    });
    expect(entry.history.at(-1)).toMatchObject({
      event: "finish",
      status,
      reason,
    });
  });

  it.each([
    ["an unknown status", { ref: REF, status: "MAYBE", reason: "x" }],
    ["an unknown ref", { ref: "NOPE-1", status: "DONE", reason: "x" }],
  ])("rejects a finish with %s", async (_label, input) => {
    await spawn("s1");
    await expect(recordFinish(root, input as never, seams)).rejects.toThrow();
  });

  it("persists control and the resolved identity", async () => {
    await setControl(root, { paused: true, maxWorkers: 2 });
    await setControl(root, { me: "operator-id" });
    expect((await readLedger(root)).control).toEqual({
      paused: true,
      maxWorkers: 2,
      me: "operator-id",
    });
    await setControl(root, { maxWorkers: null, paused: false });
    expect((await readLedger(root)).control).toMatchObject({
      paused: false,
      maxWorkers: null,
    });
  });

  it.each([
    { maxWorkers: 33 },
    { maxWorkers: -1 },
    { maxWorkers: 1.5 },
    { paused: "yes" },
  ])("rejects control %j", async control => {
    await expect(setControl(root, control as never)).rejects.toThrow();
  });

  it("appends one JSON line per session event", async () => {
    await appendSessionEvent(root, { event: "spawn", ref: REF }, seams);
    await appendSessionEvent(root, { event: "finish", ref: REF }, seams);
    const lines = readFileSync(sessionsLogPath(root), "utf8")
      .trim()
      .split("\n");
    expect(lines.map(line => JSON.parse(line))).toEqual([
      { at: T0, event: "spawn", ref: REF },
      { at: T1, event: "finish", ref: REF },
    ]);
  });

  it("never touches anything outside .lisa/session-manager", async () => {
    await spawn("s1");
    await appendSessionEvent(root, { event: "spawn", ref: REF }, seams);
    expect(readdirSync(root)).toEqual([".lisa"]);
    expect(readdirSync(path.join(root, ".lisa"))).toEqual(["session-manager"]);
  });
});
