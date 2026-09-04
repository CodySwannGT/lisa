/**
 * The pushed refs, kept where a spawned gate can still read them.
 *
 * Git delivers `<local ref> <local sha> <remote ref> <remote sha>` on stdin
 * exactly ONCE, and this hook has four readers: the deletion guard, the
 * destination guard, `validate-push`, and every declared gate. Each replays
 * what it consumed, but a replay only reaches the next reader IN THIS FILE. A
 * gate the runner spawns is a different process started later, and by then some
 * earlier gate may have drained the stream for good.
 *
 * That is CodySwannGT/lisa#3874: on a project declaring `gates.traceability`
 * the built-in call stands down and the work-item check runs from inside the
 * gate runner, found empty stdin, fell back to the PUSHER'S `HEAD`, and printed
 * `WORK_ITEM_TRACKING_OK 0 commit(s)` for a branch whose commit carried a
 * perfectly good trailer.
 *
 * `writes the stream to a file` and `exports the file's path` are the pair that
 * hold the fix: the file is what survives the ordering, and the export is what
 * carries it to a grandchild process. `replays the stream it consumed` holds
 * the constraint the fix had to respect — every existing stdin reader still
 * gets its bytes.
 * @module tests/unit/hooks/pre-push-pushed-refs-file
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { trackedHookCopies } from "../../helpers/hook-roster.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const ROOT = process.cwd();

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const SH = "/bin/sh";

/** Every tracked copy of the pre-push hook, derived rather than written down. */
const HOOKS = [...trackedHookCopies("pre-push")];

/** Opening marker of the block under test. */
const BLOCK_START = "# BEGIN: pushed refs file";

/** Closing marker of the block under test. */
const BLOCK_END = "# END: pushed refs file";

/** A real object id, so a line is never a placeholder. */
const LIVE = "8239f41670750db3979dc8eb1ee5fa7d9cc6364c";

/** A second real object id, so a line is not two copies of one value. */
const OTHER = "2163bd5b6b87fd474ab7cb9c2d2dcf5734a176af";

const STREAM = `refs/heads/work ${LIVE} refs/heads/work ${OTHER}\n`;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
});

/**
 * Cut the block out of a hook, verbatim.
 * @param relative - Repo-relative path to the hook
 * @returns The block as a runnable script body
 */
function block(relative: string): string {
  const lines = readFileSync(path.join(ROOT, relative), "utf8").split("\n");
  const start = lines.findIndex(line => line.trim() === BLOCK_START);
  const end = lines.findIndex(line => line.trim() === BLOCK_END);
  expect(start, `${relative} has no ${BLOCK_START}`).toBeGreaterThan(-1);
  expect(end, `${relative} has no ${BLOCK_END}`).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

/**
 * A file's bytes, or nothing when it is not there.
 * @param file - Absolute path to read
 * @returns The contents, or the empty string
 */
function contents(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Run the block, then report what a later reader would see.
 *
 * Both reads happen INSIDE the script and through a CHILD process — `sh -c`
 * resolving `$LISA_PUSHED_REFS_FILE` from its own environment — for two
 * reasons. An export that never crossed a process boundary is exactly the
 * half-fix this suite exists to catch, and the block installs an EXIT trap that
 * removes the file, so a read after the script returned would find nothing and
 * report a working export as a broken one.
 * @param relative - Repo-relative path to the hook
 * @returns The exported path, the file's bytes, and the replayed stdin
 */
function run(relative: string): {
  exported: string;
  file: string;
  replayed: string;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-refs-file-"));
  const replayPath = path.join(dir, "replayed");
  const filePath = path.join(dir, "as-a-child-saw-it");
  const script = [
    block(relative),
    `sh -c 'printf "EXPORTED=%s\\n" "$LISA_PUSHED_REFS_FILE"'`,
    `sh -c 'cat "$LISA_PUSHED_REFS_FILE"' > ${JSON.stringify(filePath)}`,
    `cat > ${JSON.stringify(replayPath)}`,
  ].join("\n");
  const outcome = boundedSpawnSync({
    args: ["-c", script],
    command: SH,
    env: { ...process.env, TMPDIR: dir },
    input: STREAM,
    label: `${relative} pushed refs file`,
  });
  const exported = (/EXPORTED=(.*)/.exec(outcome.stdout)?.[1] ?? "").trim();
  const file = contents(filePath);
  const replayed = contents(replayPath);
  dirs.push(dir);
  return { exported, file, replayed };
}

describe.each(HOOKS)("%s pushed refs file", relative => {
  it("exports the file's path, so a spawned gate can find it", () => {
    expect(run(relative).exported).not.toBe("");
  });

  it("writes the pushed refs to that file, byte for byte", () => {
    expect(run(relative).file).toBe(STREAM);
  });

  it("replays the stream it consumed, so stdin readers are not starved", () => {
    expect(run(relative).replayed).toBe(STREAM);
  });
});
