/**
 * A push that only deletes refs must not run the push-moment gate suite.
 *
 * Measured before this guard existed, on a fixture consumer project carrying a
 * valid `gates` block: `git push origin --delete <branch>` — a push carrying
 * zero commits — executed every declared push gate (slow lint, the coverage
 * test run, integration, dead-code, thresholds, typecheck) and then refused the
 * deletion. The ref was still there afterwards. The only way through was
 * `--no-verify`, which is the one flag this repository has a hook devoted to
 * blocking; that hook refused the command while this ticket was being measured.
 * A policy that forces the bypass it forbids teaches that the bypass is
 * negotiable.
 *
 * Git feeds one line per ref on stdin, `<local ref> <local sha> <remote ref>
 * <remote sha>`. Captured from a real push, verbatim:
 *
 * ```
 * (delete) 000…000 refs/heads/doomed 2163bd5…   ← deletion: LOCAL sha zeroed
 * HEAD     8239f41… refs/heads/live  000…000    ← new branch: REMOTE sha zeroed
 * ```
 *
 * So the discriminator is the SECOND field, not "a line containing zeroes" —
 * the first push of a new branch carries an all-zero remote sha and must still
 * run everything. `newBranchPush` below is the case that pins that difference.
 *
 * The constraint the guard has to respect is that Git delivers those lines
 * exactly ONCE. `lisa-work-item.mjs validate-push` parses the same stream, and
 * so does any declared gate that reads it. A guard that reads stdin to classify
 * the push and does not put it back starves them — and quietly, because
 * `validate-push` tolerates empty stdin by falling back to `git rev-list`. That
 * would trade a hook that runs too much for a hook that proves too little,
 * which is strictly the worse failure. `replays the stream it consumed` and
 * `starves the rest of the hook when the replay is removed` are the pair that
 * hold that: the second deletes the replay line from the real guard and shows
 * the first going red, so the assertion cannot pass over a guard that no longer
 * replays.
 * @module tests/unit/hooks/pre-push-deletion-guard
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { trackedHookCopies } from "../../helpers/hook-roster.js";

const ROOT = process.cwd();

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const SH = "/bin/sh";

/**
 * Every tracked copy of the pre-push hook, derived rather than written down.
 *
 * Three copies of this hook exist and one of them sat six commits behind the
 * others for four weeks because three parity tests each hardcoded their own
 * two-entry roster (CodySwannGT/lisa#2847). Deriving the roster means a fourth
 * copy joins this suite the moment it is tracked.
 */
const HOOKS = [...trackedHookCopies("pre-push")];

/** Opening marker of the block under test. */
const GUARD_START = "# BEGIN: deletion-only push guard";

/** Closing marker of the block under test. */
const GUARD_END = "# END: deletion-only push guard";

/** Printed by the harness when the guard let the hook continue. */
const CONTINUED = "GATE-SUITE-REACHED";

/** A 40-zero object id, exactly as Git writes it. */
const ZERO = "0".repeat(40);

/** A real object id, from the fixture push these lines were captured from. */
const LIVE = "8239f41670750db3979dc8eb1ee5fa7d9cc6364c";

/** A second real object id, so mixed pushes are not two copies of one line. */
const OTHER = "2163bd5b6b87fd474ab7cb9c2d2dcf5734a176af";

const deletion = `(delete) ${ZERO} refs/heads/doomed ${OTHER}\n`;
const secondDeletion = `(delete) ${ZERO} refs/heads/stale ${LIVE}\n`;
const normalPush = `refs/heads/work ${LIVE} refs/heads/work ${OTHER}\n`;
const newBranchPush = `HEAD ${LIVE} refs/heads/live ${ZERO}\n`;

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway directory, cleaned up when the file finishes.
 * @returns Absolute path to the new directory
 */
function scratchDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-deletion-guard-"));
  dirs.push(dir);
  return dir;
}

/**
 * Read one hook's source.
 * @param relative - Repo-relative path to the hook
 * @returns The hook's full text
 */
function hook(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/**
 * Cut the deletion guard out of a hook, verbatim.
 *
 * Sliced rather than reimplemented: an assertion against a copy of the logic
 * would stay green over a hook whose copy of it was deleted.
 * @param relative - Repo-relative path to the hook
 * @returns The block as a runnable script body
 */
function guardBlock(relative: string): string {
  const lines = hook(relative).split("\n");
  const start = lines.findIndex(line => line.trim() === GUARD_START);
  const end = lines.findIndex(line => line.trim() === GUARD_END);
  expect(start, `${relative} has no ${GUARD_START}`).toBeGreaterThan(-1);
  expect(end, `${relative} has no ${GUARD_END}`).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

/**
 * Run a guard body against one stdin payload.
 *
 * The harness appended below is what a passed-through push reaches: it prints a
 * marker and then drains stdin, so a case can assert both whether the rest of
 * the hook was reached and exactly which bytes it would have received.
 * @param body - Shell to run before the harness
 * @param input - Bytes to feed the script on stdin
 * @param label - Case label for the bounded-spawn budget
 * @returns Exit status, stdout, and the replayed bytes
 */
function runGuard(
  body: string,
  input: string,
  label: string
): { status: number | null; stdout: string; replayed: string } {
  const replayPath = path.join(scratchDir(), "replayed");
  const script = [
    body,
    `echo "${CONTINUED}"`,
    `cat > ${JSON.stringify(replayPath)}`,
  ].join("\n");
  const outcome = boundedSpawnSync({
    args: ["-c", script],
    command: SH,
    input,
    label,
    // The deletion path exits 0 without draining a payload this small, which is
    // the behaviour under test rather than a fault to be reported as one.
    childMayExitBeforeReading: true,
  });
  let replayed = "";
  try {
    replayed = readFileSync(replayPath, "utf8");
  } catch {
    replayed = "";
  }
  return { replayed, status: outcome.status, stdout: outcome.stdout };
}

describe.each(HOOKS)("%s deletion-only push guard", relative => {
  it("stands down for a push whose every local sha is zeroed", () => {
    const outcome = runGuard(
      guardBlock(relative),
      deletion,
      `${relative} pure deletion`
    );
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).not.toContain(CONTINUED);
  });

  it("stands down for a push deleting more than one ref", () => {
    const outcome = runGuard(
      guardBlock(relative),
      `${deletion}${secondDeletion}`,
      `${relative} two deletions`
    );
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).not.toContain(CONTINUED);
  });

  it("runs the gates for a push carrying commits", () => {
    const outcome = runGuard(
      guardBlock(relative),
      normalPush,
      `${relative} normal push`
    );
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(CONTINUED);
  });

  it("runs the gates for the first push of a new branch, whose REMOTE sha is zeroed", () => {
    const outcome = runGuard(
      guardBlock(relative),
      newBranchPush,
      `${relative} new branch`
    );
    expect(outcome.stdout).toContain(CONTINUED);
  });

  it("runs the gates for a push that both deletes a ref and carries commits", () => {
    const outcome = runGuard(
      guardBlock(relative),
      `${deletion}${normalPush}`,
      `${relative} mixed push`
    );
    expect(outcome.stdout).toContain(CONTINUED);
  });

  it("does not read empty stdin as a deletion", () => {
    const outcome = runGuard(
      guardBlock(relative),
      "",
      `${relative} empty stdin`
    );
    expect(outcome.stdout).toContain(CONTINUED);
    expect(outcome.replayed).toBe("");
  });

  it("replays the stream it consumed, byte for byte", () => {
    const mixed = `${deletion}${normalPush}${newBranchPush}`;
    const outcome = runGuard(guardBlock(relative), mixed, `${relative} replay`);
    expect(outcome.replayed).toBe(mixed);
  });

  it("starves the rest of the hook when the replay is removed", () => {
    const withoutReplay = guardBlock(relative)
      .split("\n")
      .filter(line => !/^\s*exec\s*<\s*"\$LISA_PUSHED_REFS"\s*$/u.test(line))
      .join("\n");
    expect(withoutReplay).not.toBe(guardBlock(relative));
    const outcome = runGuard(
      withoutReplay,
      normalPush,
      `${relative} replay removed`
    );
    expect(outcome.stdout).toContain(CONTINUED);
    expect(outcome.replayed).toBe("");
  });

  it("sits ahead of everything else that reads the hook's stdin", () => {
    const lines = hook(relative).split("\n");
    const guardEnd = lines.findIndex(line => line.trim() === GUARD_END);
    const firstValidate = lines.findIndex(line =>
      line.includes('node "$WORK_ITEM_SCRIPT" validate-push')
    );
    const nodeProbe = lines.findIndex(line => line.includes("command -v node"));
    expect(guardEnd).toBeGreaterThan(-1);
    expect(firstValidate).toBeGreaterThan(guardEnd);
    // A deletion must not need Node either — the branch cannot be removed on a
    // machine without it otherwise, for a push that would run no Node at all.
    expect(nodeProbe).toBeGreaterThan(guardEnd);
  });

  it("runs the whole real hook on a deletion without invoking node", () => {
    const root = scratchDir();
    const bin = path.join(root, "bin");
    const log = path.join(root, "invoked.log");
    mkdirSync(bin);
    // Poisoned ahead of the real thing on PATH. Every step of this hook that
    // could prove anything reaches for one of these, so an empty log is the
    // claim "no gate ran" stated as evidence rather than as a reading of the
    // hook's own output.
    for (const tool of ["node", "npm", "npx", "bun", "yarn"]) {
      writeFileSync(
        path.join(bin, tool),
        `#!/bin/sh\necho "${tool} $*" >> ${JSON.stringify(log)}\nexit 0\n`,
        { mode: 0o755 }
      );
    }
    const outcome = boundedSpawnSync({
      args: [path.join(ROOT, relative), "origin"],
      command: SH,
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
      input: deletion,
      label: `${relative} whole hook on a deletion`,
      childMayExitBeforeReading: true,
    });
    expect(outcome.status).toBe(0);
    expect(
      existsSync(log),
      `${relative} ran: ${existsSync(log) ? readFileSync(log, "utf8") : ""}`
    ).toBe(false);
  });
});
