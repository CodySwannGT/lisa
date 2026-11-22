/**
 * The packed-host journey's shared install cache (CodySwannGT/lisa#4548).
 *
 * ## The measured failure
 *
 * Shard 3 of the hosted shell-guard trace failed about two runs in twelve with
 * `native shard failed/killed/not started; no eligible manifest`. In each one
 * all ten `shared-runtime-packed-hosts` cases passed, and then `afterAll` timed
 * out at its 30,000 ms budget inside `root-cleanup` — the removal of the
 * fixture root, which on passing runs took a median of about 15 s and up to
 * 28 s.
 *
 * ## The mechanism, measured on the hosted runners
 *
 * The runners mount their root filesystem ext4 `discard,data=writeback`, where
 * freeing a file's data discards it on the device synchronously in the
 * unlinking thread. The teardown freed about 341,000 inodes with about 309,000
 * device discards, and the devices completed 22,000-34,000 freed inodes a
 * second however many unlinks were in flight from four up; one unlinking
 * thread was two to three times slower. 79% of the root was the shared Bun
 * install cache. Its files are hard-linked into each host's `node_modules`, so
 * a case removing its own host freed none of them: the teardown freed them.
 *
 * ## The controlled reproduction
 *
 * A miniature of the owned root: an install cache of packages, installing
 * cases whose hosts hard-link cache files the way Bun's default Linux backend
 * does and are then removed the way the journey removes them, a tool linking
 * some of the same files, and file-scoped resources. What drives the hosted
 * cost is counted exactly for this corpus, which holds no symbolic links: the
 * directories the teardown would free and the files whose every link lies
 * inside the root — the inodes that carry data to discard. Nothing here
 * depends on how fast this machine deletes. The positive control proves the
 * count sees the cache's files at all, without which a fix that freed nothing
 * could pass.
 * @module tests/unit/fixtures/shared-runtime-teardown
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTempDir } from "../../helpers/test-utils.js";
import {
  sharedInstallCache,
  type SharedInstallCache,
} from "../../fixtures/shared-runtime-hosts/teardown.js";

/** Installing cases in the miniature journey, in the order they run. */
const INSTALLERS = ["inherited", "typescript", "cdk"] as const;

/** Packages in the miniature install cache. */
const PACKAGES = 8;

/** Files per cached package. */
const FILES_PER_PACKAGE = 5;

/** Packages the miniature tool links from the cache, as the packed tool does. */
const TOOL_PACKAGES = [0, 1] as const;

/** Regular files in the file-scoped oracle. */
const ORACLE_FILES = 6;

/**
 * Inodes the teardown frees once the cache is gone: the root, the tool's four
 * directories and the oracle's two, the tool's files (now their last links),
 * and the oracle's files.
 */
const FILE_SCOPED_INODES =
  1 + 4 + 2 + TOOL_PACKAGES.length * FILES_PER_PACKAGE + ORACLE_FILES;

/** The cache directory, its package directories, and every cached file. */
const CACHE_INODES = 1 + PACKAGES + PACKAGES * FILES_PER_PACKAGE;

const scratch: string[] = [];

afterEach(() => {
  for (const area of scratch.splice(0))
    fs.rmSync(area, { force: true, recursive: true });
});

/** The miniature owned root and its shared cache. */
interface Journey {
  readonly root: string;
  readonly cache: string;
}

/**
 * Seed the miniature owned root: the cache, a tool linking two cached
 * packages, and a file-scoped oracle.
 * @returns The owned root and its cache
 */
function seedJourney(): Journey {
  const area = fs.mkdtempSync(path.join(tmpdir(), "lisa-shared-cache-"));
  const root = path.join(area, "owned");
  const cache = path.join(root, "cache");
  scratch.push(area);
  for (let index = 0; index < PACKAGES; index += 1) {
    const pkg = path.join(cache, `package-${index}`);
    fs.mkdirSync(pkg, { recursive: true });
    for (let file = 0; file < FILES_PER_PACKAGE; file += 1)
      fs.writeFileSync(path.join(pkg, `module-${file}.js`), `${index}`);
  }
  linkPackages(cache, path.join(root, "tool", "node_modules"), TOOL_PACKAGES);
  fs.mkdirSync(path.join(root, "oracle", "package"), { recursive: true });
  for (let file = 0; file < ORACLE_FILES; file += 1)
    fs.writeFileSync(path.join(root, "oracle", "package", `${file}.js`), "x");
  return { root, cache };
}

/**
 * Hard-link cached packages into a `node_modules`, as Bun installs on Linux.
 * @param cache - The shared cache
 * @param nodeModules - Directory to install into
 * @param packages - Indexes of the cached packages to link
 */
function linkPackages(
  cache: string,
  nodeModules: string,
  packages: readonly number[]
): void {
  packages.forEach(index => {
    const from = path.join(cache, `package-${index}`);
    const to = path.join(nodeModules, `package-${index}`);
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(file =>
      fs.linkSync(path.join(from, file), path.join(to, file))
    );
  });
}

/**
 * One installing case: install every cached package into a host, then remove
 * the host and finish the case the way the journey does.
 * @param journey - The miniature owned root
 * @param installer - The case's name
 * @param lifetime - The cache's lifetime, or none for the replaced behaviour
 */
async function runInstaller(
  journey: Journey,
  installer: string,
  lifetime?: SharedInstallCache
): Promise<void> {
  const host = path.join(journey.root, installer);
  linkPackages(
    journey.cache,
    path.join(host, "node_modules"),
    Array.from({ length: PACKAGES }, (_unused, index) => index)
  );
  await cleanupTempDir(host);
  await lifetime?.finish(installer);
}

/**
 * Count the inodes removing a root would free that carry data: its
 * directories, and every regular file whose links all lie inside it. On the
 * hosted runners nearly every one costs a synchronous device discard.
 * Symbolic links are not counted; this corpus has none.
 * @param root - Root the teardown would remove
 * @returns Inodes freed by removing it
 */
function inodesFreedByRemoving(root: string): number {
  if (!fs.existsSync(root)) return 0;
  const links = new Map<number, { seen: number; total: number }>();
  const walk = (directory: string): number =>
    fs.readdirSync(directory).reduce((directories, name) => {
      const entry = path.join(directory, name);
      const stat = fs.lstatSync(entry);
      if (stat.isDirectory()) return directories + walk(entry);
      if (stat.isFile())
        links.set(stat.ino, {
          seen: (links.get(stat.ino)?.seen ?? 0) + 1,
          total: stat.nlink,
        });
      return directories;
    }, 1);
  const directories = walk(root);
  return (
    directories +
    [...links.values()].filter(file => file.seen === file.total).length
  );
}

describe("the packed-host journey's shared install cache", () => {
  it("leaves the teardown only what the whole file uses until its end", async () => {
    // The regression. Each installing case removes its own host; the last
    // one also frees the cache, so the teardown no longer frees every cached
    // file in its 30 s window.
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    for (const installer of INSTALLERS)
      await runInstaller(journey, installer, lifetime);

    expect(
      inodesFreedByRemoving(journey.root),
      "inodes the teardown must free"
    ).toBe(FILE_SCOPED_INODES);
    expect(fs.existsSync(journey.cache)).toBe(false);
  });

  it("positive control: the replaced lifetime left every cached file to the teardown", async () => {
    // The same cases with nothing freeing the cache, which is what the
    // journey did. Removing the hosts freed no cached file, because each was
    // still linked from the cache.
    const journey = seedJourney();

    for (const installer of INSTALLERS) await runInstaller(journey, installer);

    expect(inodesFreedByRemoving(journey.root)).toBe(
      FILE_SCOPED_INODES -
        TOOL_PACKAGES.length * FILES_PER_PACKAGE +
        CACHE_INODES
    );
  });

  it("keeps the cache while an installer is still to run", async () => {
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    await runInstaller(journey, "inherited", lifetime);
    await runInstaller(journey, "typescript", lifetime);

    expect(lifetime.allFinished()).toBe(false);
    expect(fs.existsSync(journey.cache)).toBe(true);
  });

  it("frees the cache inside the last installer's own call", async () => {
    const journey = seedJourney();
    const removed: string[] = [];
    const lifetime = sharedInstallCache(
      journey.cache,
      INSTALLERS,
      async directory => {
        removed.push(directory);
        await cleanupTempDir(directory);
      }
    );

    const freed: boolean[] = [];
    for (const installer of INSTALLERS)
      freed.push(await lifetime.finish(installer));

    expect(freed).toEqual([false, false, true]);
    expect(removed).toEqual([journey.cache]);
    expect(lifetime.allFinished()).toBe(true);
    expect(lifetime.freed()).toBe(true);
  });

  it("counts an installer finished twice once", async () => {
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    await lifetime.finish("inherited");
    await lifetime.finish("inherited");
    await lifetime.finish("typescript");

    expect(lifetime.allFinished()).toBe(false);
    expect(fs.existsSync(journey.cache)).toBe(true);
  });

  it("frees a cache an installer rebuilt after it was freed", async () => {
    // A `--retry` of an installer that runs after the cache was freed
    // installs again and so rebuilds it; that installer's finish frees it.
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    for (const installer of INSTALLERS) await lifetime.finish(installer);
    fs.mkdirSync(path.join(journey.cache, "package-rebuilt"), {
      recursive: true,
    });
    const again = await lifetime.finish("cdk");

    expect(again).toBe(true);
    expect(fs.existsSync(journey.cache)).toBe(false);
    expect(lifetime.freed()).toBe(true);
  });

  it("tries a failed removal again on the next finish", async () => {
    const journey = seedJourney();
    const attempts: string[] = [];
    const lifetime = sharedInstallCache(
      journey.cache,
      INSTALLERS,
      async directory => {
        attempts.push(directory);
        if (attempts.length === 1)
          throw new Error("EBUSY: resource busy or locked, rmdir");
        await cleanupTempDir(directory);
      }
    );

    await lifetime.finish("inherited");
    await lifetime.finish("typescript");
    await expect(lifetime.finish("cdk")).rejects.toThrow(/EBUSY/);
    expect(lifetime.freed()).toBe(false);

    await expect(lifetime.finish("cdk")).resolves.toBe(true);
    expect(attempts).toEqual([journey.cache, journey.cache]);
    expect(lifetime.freed()).toBe(true);
    expect(fs.existsSync(journey.cache)).toBe(false);
  });

  it("refuses a case it was not told installs through the cache", async () => {
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    await expect(lifetime.finish("ownership-known")).rejects.toThrow(
      /does not install through the shared cache/
    );
  });

  it("leaves the cache to the teardown when an installer never runs", async () => {
    // A filtered run: the cache is not freed early, and is not reported
    // freed, so the teardown's removal of the whole root still owns it.
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    await runInstaller(journey, "inherited", lifetime);
    await runInstaller(journey, "cdk", lifetime);

    expect(lifetime.allFinished()).toBe(false);
    expect(lifetime.freed()).toBe(false);
    expect(fs.existsSync(journey.cache)).toBe(true);
    expect(inodesFreedByRemoving(journey.root)).toBe(
      FILE_SCOPED_INODES -
        TOOL_PACKAGES.length * FILES_PER_PACKAGE +
        CACHE_INODES
    );
  });

  it("fails the last installer when the cache cannot be freed", async () => {
    // Failures remain failures: the case that frees the cache owns its error,
    // and a cache whose removal failed is not reported as freed.
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS, async () =>
      Promise.reject(new Error("EACCES: permission denied, unlink"))
    );

    await lifetime.finish("inherited");
    await lifetime.finish("typescript");

    await expect(lifetime.finish("cdk")).rejects.toThrow(/EACCES/);
    expect(lifetime.allFinished()).toBe(true);
    expect(lifetime.freed()).toBe(false);
  });
});

describe("the shared install cache's recorded size (CodySwannGT/lisa#4636)", () => {
  it("records the cache's entries when its last installer frees it", async () => {
    // The measurement the duplicate-entry estimate never had: every package
    // directory and cached file, without the cache directory itself.
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    for (const installer of INSTALLERS)
      await runInstaller(journey, installer, lifetime);

    expect(lifetime.entriesAtFree()).toBe(CACHE_INODES - 1);
    expect(fs.existsSync(journey.cache)).toBe(false);
  });

  it("counts the cache before it removes it", async () => {
    const journey = seedJourney();
    const events: string[] = [];
    const lifetime = sharedInstallCache(
      journey.cache,
      INSTALLERS,
      async () => {
        events.push("remove");
      },
      () => {
        events.push("count");
        return 7;
      }
    );

    for (const installer of INSTALLERS) await lifetime.finish(installer);

    expect(events).toEqual(["count", "remove"]);
    expect(lifetime.entriesAtFree()).toBe(7);
  });

  it("records nothing while an installer is still to run", async () => {
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    await lifetime.finish("inherited");

    expect(lifetime.entriesAtFree()).toBeUndefined();
  });

  it("keeps the recorded count when a later finish finds the cache gone", async () => {
    const journey = seedJourney();
    const lifetime = sharedInstallCache(journey.cache, INSTALLERS);

    for (const installer of INSTALLERS) await lifetime.finish(installer);
    await lifetime.finish("cdk");

    expect(lifetime.entriesAtFree()).toBe(CACHE_INODES - 1);
  });

  it("frees the cache even when it cannot be counted", async () => {
    // A measurement must never stand between the case and the free.
    const journey = seedJourney();
    const lifetime = sharedInstallCache(
      journey.cache,
      INSTALLERS,
      cleanupTempDir,
      () => {
        throw new Error("EACCES: permission denied, scandir");
      }
    );

    for (const installer of INSTALLERS) await lifetime.finish(installer);

    expect(lifetime.freed()).toBe(true);
    expect(lifetime.entriesAtFree()).toBeUndefined();
    expect(fs.existsSync(journey.cache)).toBe(false);
  });
});
