/**
 * Tests for the note a killed run leaves for a later, unrelated failure.
 *
 * This is the fourth rendering of machine saturation and the only one that
 * cannot be classified inside the run that suffers it (CodySwannGT/lisa#3653):
 *
 *     saturation kills a run -> its sandbox survives as debris ->
 *     the debris fails an UNRELATED test on a SUBSEQUENT run
 *
 * The later run genuinely has no evidence — the evidence was in the earlier
 * one — so the earlier run leaves a mark and the later one reads it.
 *
 * Two assertions carry the criterion, and they pull in opposite directions.
 * The note must say **when**, so a reader can line it up against their own
 * timeline. And it must **not** assert causation, because an operator who
 * learns to read "a run was killed" as "so ignore this failure" is worse off
 * than one who never saw the note. The second is the one a mechanical
 * gate-satisfying pass would drop.
 * @module tests/unit/scripts/kill-marks
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  KILL_MARK_RETENTION_MS,
  killMarkNote,
  recentKillMarks,
  recordKillMark,
} from "../../../all/copy-overwrite/scripts/lib/kill-marks.mjs";

/** Directories this file created, removed after each case. */
const created: string[] = [];

/** A fixed clock, so a case never depends on when it runs. */
const NOW = 1_788_470_000_000;

/** The process reading the marks. */
const SELF = 4242;

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway mark directory.
 * @returns Absolute path.
 */
function markDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-killmark-test-"));
  created.push(dir);
  return dir;
}

/** One mark as {@link recentKillMarks} returns it. */
type Mark = { kind: string; gateId: string; at: number; pid: number };

describe("an earlier run leaves a mark a later run can read", () => {
  it("records a kill and reads it back from another process", () => {
    const dir = markDir();

    expect(
      recordKillMark(
        { kind: "killed", gateId: "test-correctness" },
        { dir, now: NOW, pid: 111 }
      )
    ).toBe(true);
    const marks = recentKillMarks({ dir, now: NOW, self: SELF }) as Mark[];

    expect(marks).toHaveLength(1);
    expect(marks[0]?.kind).toBe("killed");
    expect(marks[0]?.gateId).toBe("test-correctness");
  });

  it("reports an earlier invocation's mark from the same process", () => {
    // Long-lived agent processes can invoke the runner more than once. PID
    // equality cannot distinguish the previous invocation from the current
    // one; the runner's pre-execution snapshot supplies that boundary.
    const dir = markDir();
    recordKillMark(
      { kind: "killed", gateId: "g" },
      { dir, now: NOW, pid: SELF }
    );

    expect(recentKillMarks({ dir, now: NOW, self: SELF })).toHaveLength(1);
  });

  it("ignores a mark older than the retention window", () => {
    // An hour-old kill and a failure now are unrelated often enough that
    // pairing them would make the note background noise.
    const dir = markDir();
    const stale = NOW - KILL_MARK_RETENTION_MS - 1;
    recordKillMark(
      { kind: "killed", gateId: "g" },
      { dir, now: stale, pid: 111 }
    );

    expect(recentKillMarks({ dir, now: NOW, self: SELF })).toEqual([]);
  });

  it("keeps a mark inside the window", () => {
    const dir = markDir();
    const fresh = NOW - KILL_MARK_RETENTION_MS + 60_000;
    recordKillMark(
      { kind: "killed", gateId: "g" },
      { dir, now: fresh, pid: 111 }
    );

    expect(recentKillMarks({ dir, now: NOW, self: SELF })).toHaveLength(1);
  });

  it("ignores a future-dated mark", () => {
    const dir = markDir();
    expect(
      recordKillMark(
        { kind: "killed", gateId: "from-the-future" },
        { dir, now: NOW + 60_000, pid: 111 }
      )
    ).toBe(true);

    expect(recentKillMarks({ dir, now: NOW, self: SELF })).toEqual([]);
  });

  it("returns the newest first, so the closest kill reads first", () => {
    const dir = markDir();
    recordKillMark(
      { kind: "killed", gateId: "old" },
      { dir, now: NOW - 600_000, pid: 111 }
    );
    recordKillMark(
      { kind: "killed", gateId: "new" },
      { dir, now: NOW - 60_000, pid: 222 }
    );
    const marks = recentKillMarks({ dir, now: NOW, self: SELF }) as Mark[];

    expect(marks.map(mark => mark.gateId)).toEqual(["new", "old"]);
  });
});

describe("the note says when, and refuses to say why", () => {
  const marks = [
    { kind: "killed", gateId: "a", at: NOW - 60_000, pid: 111 },
    { kind: "resource-refused", gateId: "b", at: NOW - 120_000, pid: 222 },
  ];
  const clock = (at: number): string =>
    at === NOW - 60_000 ? "18:42" : "18:41";

  it("names the time of each earlier termination", () => {
    // "Then the report notes that a previous run was killed, WITH WHEN."
    const line = killMarkNote(marks, clock).join(" ");

    expect(line).toContain("18:42");
    expect(line).toContain("18:41");
  });

  it("names what was terminated, so the reader can judge relevance", () => {
    expect(killMarkNote(marks, clock).join(" ")).toContain("resource-refused");
  });

  it("refuses the causal reading explicitly", () => {
    // "And it does not assert that the kill caused this failure." The note has
    // to close the inference off rather than merely omit it, because the
    // inference is the one a tired reader will make unprompted.
    const line = killMarkNote(marks, clock).join(" ");

    expect(line).toContain("CONTEXT, not a cause");
    expect(line).toContain("does NOT explain the result above");
    expect(line).toContain("must not be read as excusing it");
  });

  it("says why the note exists at all", () => {
    // Without this the line is an unexplained interruption, and a reader who
    // cannot see why it is there will learn to skip it.
    expect(killMarkNote(marks, clock).join(" ")).toContain(
      "debris that fails an unrelated, later run"
    );
  });

  it("emits nothing when no earlier run was terminated", () => {
    expect(killMarkNote([])).toEqual([]);
  });

  it("caps the times it lists and counts the rest", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      kind: "killed",
      gateId: `g${String(index)}`,
      at: NOW - index * 1000,
      pid: 100 + index,
    }));

    expect(killMarkNote(many, () => "18:42").join(" ")).toContain("(+3 more)");
  });
});

describe("recording never becomes a second failure", () => {
  it("reports false rather than throwing when the directory is unusable", () => {
    // This runs on a path where something has already gone wrong. A note that
    // cannot be written must not take the run down with it.
    const dir = path.join(markDir(), "a-file");
    fs.writeFileSync(dir, "not a directory");
    const write = (): boolean =>
      recordKillMark(
        { kind: "killed", gateId: "g" },
        { dir, now: NOW, pid: 111 }
      );

    expect(write).not.toThrow();
    expect(write()).toBe(false);
  });

  it("reads an absent directory as no marks", () => {
    const absent = path.join(
      os.tmpdir(),
      `lisa-killmark-absent-${String(process.pid)}`
    );

    expect(recentKillMarks({ dir: absent, now: NOW, self: SELF })).toEqual([]);
  });

  it("skips a corrupt mark instead of failing the read", () => {
    const dir = markDir();
    fs.writeFileSync(
      path.join(dir, `${String(NOW)}-111-abc.json`),
      "{not json"
    );
    recordKillMark(
      { kind: "killed", gateId: "good" },
      { dir, now: NOW, pid: 222 }
    );
    const marks = recentKillMarks({ dir, now: NOW, self: SELF }) as Mark[];

    expect(marks).toHaveLength(1);
    expect(marks[0]?.gateId).toBe("good");
  });

  it("ignores a mark from a future schema", () => {
    // Forward compatibility in the safe direction: an unreadable shape is no
    // information, and no information must render as no note.
    const dir = markDir();
    fs.writeFileSync(
      path.join(dir, `${String(NOW)}-111-xyz.json`),
      JSON.stringify({ schema: 2, kind: "killed", at: NOW, pid: 111 })
    );

    expect(recentKillMarks({ dir, now: NOW, self: SELF })).toEqual([]);
  });
});
