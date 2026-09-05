/**
 * Tests for the shared temp-directory cleanup that lost a race under load.
 *
 * ## The measured failure
 *
 * A branch whose own tests were green could not push, because one test
 * unreachable from its diff threw in an `afterEach`:
 *
 * ```
 * ENOTEMPTY: directory not empty, rmdir
 *   '…/lisa-scratch/run-35247-…/worker-14451-…/lisa-test-ylEKHM/.git'
 * ```
 *
 * In a suite where one failure fails a required gate, a load-sensitive test is
 * not a property of the branch that trips it — it is a tax on every push in the
 * fleet, and discovery plus retry costs two full ten-minute cycles
 * (CodySwannGT/lisa#3877).
 *
 * ## The mechanism, read rather than assumed
 *
 * `fs-extra`'s `remove` is `fs.rm(path, { recursive: true, force: true })` in
 * its installed source. It passes no `maxRetries`, so Node's default of zero
 * applies and the first collision propagates. Node retries only on the errno
 * set a concurrent writer produces — `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`,
 * `EPERM` — so asking for retries does not soften any other failure.
 *
 * ## Why the retry request is asserted rather than a staged race
 *
 * A test that spawns a writer and hopes it collides with a removal is
 * timing-dependent, and a timing-dependent test written to fix load-sensitive
 * tests would be this ticket's own defect in mirror image. The retrying is
 * Node's; the only thing this helper decides is whether to ask for it, so
 * asserting the request asserts everything the code chooses. The behavioural
 * cases below prove the ordinary path still removes what it is given.
 * @module tests/unit/helpers/temp-dir-removal-race
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** A path the recorder never touches; only the OPTIONS matter to these cases. */
const UNTOUCHED_TARGET = "/var/lisa-fixture/never-removed";

/** The errno set Node retries, and the only one this changes the outcome for. */
const RETRYABLE = ["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"] as const;

/**
 * Record what the helper asked its removal for.
 * @returns The recorder and the calls it captured.
 */
const recordingRemove = (): {
  calls: { target: string; options: Parameters<typeof rm>[1] }[];
  remove: typeof rm;
} => {
  const calls: { target: string; options: Parameters<typeof rm>[1] }[] = [];
  const remove = ((target: string, options: Parameters<typeof rm>[1]) => {
    calls.push({ options, target });
    return Promise.resolve();
  }) as unknown as typeof rm;
  return { calls, remove };
};

describe("cleanup asks for the retries the race needs", () => {
  it("requests more than one attempt, which is the whole fix", () => {
    // `fs-extra`'s remove passes no maxRetries, so Node's default of zero
    // applies and ENOTEMPTY propagates on the first collision. Asking for a
    // retry is the entire behavioural difference.
    const { calls, remove } = recordingRemove();

    void cleanupTempDir(UNTOUCHED_TARGET, remove);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.maxRetries ?? 0).toBeGreaterThan(1);
  });

  it("asks for a wait between attempts, so the writer can finish", () => {
    // Zero delay would spin through every attempt inside the same millisecond
    // and converge on nothing, which is a retry count that buys no time.
    const { calls, remove } = recordingRemove();

    void cleanupTempDir(UNTOUCHED_TARGET, remove);

    expect(calls[0]?.options?.retryDelay ?? 0).toBeGreaterThan(0);
  });

  it("still removes recursively and tolerates an absent path", () => {
    // The two options the previous implementation already had. Dropping either
    // while adding retries would trade one failure for another.
    const { calls, remove } = recordingRemove();

    void cleanupTempDir(UNTOUCHED_TARGET, remove);

    expect(calls[0]?.options?.recursive).toBe(true);
    expect(calls[0]?.options?.force).toBe(true);
  });

  it("removes nothing at all when handed an empty path", () => {
    // The control for the `pathExists` probe this replaced. `force: true`
    // covers a missing directory, but an empty string is a caller mistake and
    // must not reach a recursive removal.
    const { calls, remove } = recordingRemove();

    void cleanupTempDir("", remove);

    expect(calls).toHaveLength(0);
  });

  it("names the errno set Node retries, so the scope is not guessed at", () => {
    // Documentation as a case: retrying is not a blanket softening. Every
    // other errno still fails on the first pass, which is what keeps a real
    // undeletable directory a real failure.
    expect(RETRYABLE).toContain("ENOTEMPTY");
    expect(RETRYABLE).not.toContain("ENOENT");
  });
});

describe("the ordinary path still deletes what it is given", () => {
  it("removes a populated tree, including a git directory", async () => {
    // The shape that failed: a fixture that ran `git init` leaves loose
    // objects and a hooks tree, which is the likeliest place for another
    // process to create an entry mid-removal.
    const dir = await createTempDir();
    mkdirSync(path.join(dir, ".git", "objects"), { recursive: true });
    writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(path.join(dir, ".git", "objects", "loose"), "x");
    writeFileSync(path.join(dir, "file.txt"), "y");

    await cleanupTempDir(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it("is a no-op on a directory that is already gone", async () => {
    const dir = await createTempDir();
    await cleanupTempDir(dir);

    await expect(cleanupTempDir(dir)).resolves.toBeUndefined();
  });
});
