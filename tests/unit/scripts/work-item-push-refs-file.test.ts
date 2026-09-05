/**
 * `validate-push` answering about the PUSHED ref rather than the pusher's tree.
 *
 * Measured, on a real push (CodySwannGT/lisa#3874). A session pinned to one
 * worktree can only push another worktree's branch cross-tree, and when it did:
 *
 * ```
 * $ node scripts/lisa-work-item.mjs validate-push
 * WORK_ITEM_TRACKING_OK 0 commit(s); this range names no work item, so gates
 *   4 and 5 have nothing to check here.
 *   PASSED     required traceability      bun run check:work-item:push
 * ```
 *
 * `0 commit(s)` — for a branch whose commit carried a perfectly good
 * `Work-Item:` trailer. Nothing about that reading is wrong; it is accurate
 * about the wrong thing. Git delivers the refs being pushed on stdin exactly
 * once, and on a project that declares `gates.traceability` this command runs
 * from inside the gate runner, by which time an earlier gate has spent the
 * stream. The empty-stream fallback then computes `HEAD --not --remotes` — the
 * PUSHER'S branch — and prints a green meaning "I had nothing to look at" in
 * the same shape as a green meaning "I looked and it was clean".
 *
 * `LISA_PUSHED_REFS_FILE` is the fix: the hook captures the stream to a file
 * once, and a file has none of stdin's ordering. `reads the pushed range from
 * the refs file when stdin is spent` is the case that pins it, and
 * `refuses a pushed range carrying no work item` is its control — a fixture
 * where the fallback would have printed a green proves the range is examined
 * only if the untraced commit is actually refused.
 *
 * The scope clause every verdict now carries is the other half. A green that
 * does not name what it looked at cannot be told apart from a green that looked
 * at the wrong thing, which is the whole defect.
 * @module tests/unit/scripts/work-item-push-refs-file
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  git,
  offlineFixture,
  REF,
  type Fixture,
} from "../../support/work-item-cli.js";

/** A 40-zero object id, exactly as Git writes it for an absent side. */
const ZERO = "0".repeat(40);

/** The branch the fixture is checked out on — the PUSHER'S tree. */
const PUSHER_BRANCH = "feature/tracked";

/** The branch being pushed, which lives in some other worktree. */
const PUSHED = "cross/tree";

/** The subcommand under test. */
const SUBCOMMAND = "validate-push";

/** The remote the hook names, and the one every case pushes to. */
const REMOTE = "origin";

/** The traced commit message the cross-tree branch carries. */
const TRACED = `feat: cross-tree work\n\nWork-Item: ${REF}\n`;

/** The token a verdict opens with when the range proved out. */
const OK = "WORK_ITEM_TRACKING_OK";

/** The count the pushed range carries, and the one the fallback never sees. */
const ONE_COMMIT = "1 commit(s)";

/** The exact green the defect printed, and the one that must not come back. */
const EMPTY_RANGE = `${OK} 0 commit(s)`;

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A fixture whose HEAD range is empty and whose pushed branch is not.
 *
 * The empty HEAD range is what makes this fixture a reproduction rather than
 * an illustration: it is the exact condition under which the fallback prints
 * `0 commit(s)` and a green. A fixture whose fallback failed for some unrelated
 * reason would go green after the fix for reasons that have nothing to do with
 * it.
 * @param message - Commit message for the commit on the pushed branch
 * @returns The fixture, the pushed branch's tip, and its base
 */
function crossTreeFixture(message: string): {
  base: string;
  fixture: Fixture;
  tip: string;
} {
  const fixture = offlineFixture();
  const base = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
  // Everything reachable from HEAD is already on the remote, so
  // `rev-list HEAD --not --remotes=origin` — the fallback — answers zero.
  git(
    fixture.root,
    ["update-ref", `refs/remotes/origin/${PUSHER_BRANCH}`, base],
    fixture.env
  );
  git(fixture.root, ["switch", "-q", "-c", PUSHED], fixture.env);
  git(
    fixture.root,
    ["commit", "-q", "--allow-empty", "-m", message],
    fixture.env
  );
  const tip = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
  git(fixture.root, ["switch", "-q", PUSHER_BRANCH], fixture.env);
  return { base, fixture, tip };
}

/**
 * Write one pre-push stream to a file, as the hook captures it.
 * @param fixture - Repository the file lives in
 * @param line - The stream's single line, without a trailing newline
 * @returns Absolute path to the file
 */
function refsFile(fixture: Fixture, line: string): string {
  const file = path.join(fixture.root, "pushed-refs");
  writeFileSync(file, `${line}\n`);
  return file;
}

/**
 * The one pre-push line a cross-tree push of the fixture's branch produces.
 * @param fixture - Repository the file lives in
 * @param tip - The pushed branch's tip
 * @param remote - What the remote already has, or a zeroed id for a new branch
 * @returns Absolute path to the refs file
 */
function pushedRefs(fixture: Fixture, tip: string, remote: string): string {
  return refsFile(
    fixture,
    `refs/heads/${PUSHED} ${tip} refs/heads/${PUSHED} ${remote}`
  );
}

describe("validate-push reads the pushed refs from a file (#3874)", () => {
  it("reads the pushed range from the refs file when stdin is spent", () => {
    const { base, fixture, tip } = crossTreeFixture(TRACED);

    const outcome = cli(fixture, [SUBCOMMAND, REMOTE], {
      LISA_PUSHED_REFS_FILE: pushedRefs(fixture, tip, base),
    });

    expect(outcome.stdout).toContain(ONE_COMMIT);
    expect(outcome.stdout).not.toContain(EMPTY_RANGE);
  });

  it("refuses a pushed range carrying no work item", () => {
    const { base, fixture, tip } = crossTreeFixture("chore: no trailer");

    const outcome = cli(fixture, [SUBCOMMAND, REMOTE], {
      LISA_PUSHED_REFS_FILE: pushedRefs(fixture, tip, base),
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("No Work-Item trailer");
  });

  it("accepts the file as --refs, so the hook can name it directly", () => {
    const { base, fixture, tip } = crossTreeFixture(TRACED);

    const outcome = cli(fixture, [
      SUBCOMMAND,
      REMOTE,
      "--refs",
      pushedRefs(fixture, tip, base),
    ]);

    expect(outcome.stdout).toContain(ONE_COMMIT);
  });

  it("still resolves the remote when --refs leads the argument vector", () => {
    const { base, fixture, tip } = crossTreeFixture(TRACED);

    const outcome = cli(fixture, [
      SUBCOMMAND,
      "--refs",
      pushedRefs(fixture, tip, base),
    ]);

    expect(outcome.stdout).toContain(ONE_COMMIT);
    expect(outcome.stdout).not.toContain("--refs");
  });

  it("falls back to the pushed-ref lane for a branch the remote has not seen", () => {
    const { fixture, tip } = crossTreeFixture(TRACED);

    const outcome = cli(fixture, [SUBCOMMAND, REMOTE], {
      LISA_PUSHED_REFS_FILE: pushedRefs(fixture, tip, ZERO),
    });

    expect(outcome.stdout).toContain("(new branch)");
    expect(outcome.stdout).not.toContain(EMPTY_RANGE);
  });
});

describe("every push verdict names what it examined (#3874)", () => {
  it("names the pushed ref and range on a verdict it earned", () => {
    const { base, fixture, tip } = crossTreeFixture(TRACED);

    const outcome = cli(fixture, [SUBCOMMAND, REMOTE], {
      LISA_PUSHED_REFS_FILE: pushedRefs(fixture, tip, base),
    });

    expect(outcome.stdout).toContain(
      `[examined refs/heads/${PUSHED} ${base.slice(0, 12)}..${tip.slice(0, 12)}]`
    );
  });

  it("says a green computed from local HEAD is NOT the pushed range", () => {
    const { fixture } = crossTreeFixture(TRACED);
    const empty = path.join(fixture.root, "empty-refs");
    writeFileSync(empty, "");

    const outcome = cli(fixture, [SUBCOMMAND, REMOTE], {
      // No pull request: the defect's own shape is a FIRST push, before one
      // exists, which is where the fallback green was printed.
      FAKE_GH_PR_MISSING: "1",
      LISA_PUSHED_REFS_FILE: empty,
    });

    expect(outcome.stdout).toContain(EMPTY_RANGE);
    expect(outcome.stdout).toContain("[examined local HEAD");
    expect(outcome.stdout).toContain("NOT the pushed range");
  });
});

describe("the refs file is push context, not ambient state (#3874)", () => {
  it("ignores a LISA_PUSHED_REFS_FILE the fixture did not set", () => {
    const { fixture, tip } = crossTreeFixture(TRACED);
    const foreign = pushedRefs(fixture, tip, ZERO);

    // The pre-push hook exports this so the traceability gate can read the
    // pushed refs after an earlier gate has spent stdin. The unit suite is
    // ITSELF one of the gates that runs under that hook, so the harness has to
    // sever it: without that, every fixture below inherits the REAL push's refs
    // and validates a range nobody gave it. Measured: 16 tests across two files,
    // green in isolation and red only inside a push.
    process.env.LISA_PUSHED_REFS_FILE = foreign;
    const outcome = cli(fixture, [SUBCOMMAND, REMOTE], {
      FAKE_GH_PR_MISSING: "1",
    });
    delete process.env.LISA_PUSHED_REFS_FILE;

    expect(outcome.stdout).toContain("[examined local HEAD");
    expect(outcome.stdout).not.toContain("(new branch)");
  });
});
