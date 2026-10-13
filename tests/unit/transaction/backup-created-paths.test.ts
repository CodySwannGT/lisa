/**
 * Rollback undoes creation as well as modification (CodySwannGT/lisa#4459),
 * and only for paths the apply explicitly recorded before writing them.
 * @module tests/unit/transaction/backup-created-paths
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { BackupService } from "../../../src/transaction/backup.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Host file several cases modify. */
const MODIFIED = "modified.txt";

/** Pre-apply bytes of a modified host file. */
const ORIGINAL = "original";

/** Host bytes seen by a first and a second apply. */
const FIRST_APPLY = "first apply original";
const SECOND_APPLY = "second apply original";

describe("BackupService created-path rollback (#4459)", () => {
  let service: BackupService;
  let tempDir: string;
  let destDir: string;

  beforeEach(async () => {
    service = new BackupService(new SilentLogger());
    tempDir = await createTempDir();
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(destDir);
    await service.init(destDir);
  });

  afterEach(async () => {
    // The temp backup dir lives outside tempDir; release it on every path.
    await service.cleanup();
    await cleanupTempDir(tempDir);
  });

  /**
   * Mimic a strategy: record, then create the file and its parents.
   * @param relative - Path under destDir
   * @param content - Bytes to write
   * @returns Absolute path written
   */
  async function create(relative: string, content = "x"): Promise<string> {
    const target = path.join(destDir, relative);
    await service.backup(target);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, content);
    return target;
  }

  it("removes a created file and the directories it created", async () => {
    await create("a/b/c/new.txt");

    await service.rollback();

    expect(await fs.readdir(destDir)).toEqual([]);
  });

  it("keeps a directory that existed before the apply", async () => {
    await fs.ensureDir(path.join(destDir, "existing"));
    await create("existing/inner/new.txt");

    await service.rollback();

    expect(await fs.readdir(destDir)).toEqual(["existing"]);
    expect(await fs.readdir(path.join(destDir, "existing"))).toEqual([]);
  });

  it("keeps a file someone else wrote into a directory the apply created", async () => {
    await create("made/new.txt");
    const theirs = path.join(destDir, "made", "theirs.txt");
    await fs.writeFile(theirs, "concurrent");

    await service.rollback();

    expect(await fs.readFile(theirs, "utf8")).toBe("concurrent");
    expect(await fs.pathExists(path.join(destDir, "made", "new.txt"))).toBe(
      false
    );
  });

  it("never removes an unrecorded file", async () => {
    const untouched = path.join(destDir, "untracked.txt");
    await fs.writeFile(untouched, "host");
    await create("new.txt");

    await service.rollback();

    expect(await fs.readdir(destDir)).toEqual(["untracked.txt"]);
  });

  it("forgetCreated withdraws a record whose write never happened", async () => {
    const target = path.join(destDir, "raced.txt");
    await service.backup(target);
    await fs.writeFile(target, "someone else won the race");
    service.forgetCreated(target);

    await service.rollback();

    expect(await fs.readFile(target, "utf8")).toBe("someone else won the race");
  });

  it("does not let a second write overwrite the pre-apply backup", async () => {
    const target = path.join(destDir, "twice.txt");
    await fs.writeFile(target, ORIGINAL);
    await service.backup(target);
    await fs.writeFile(target, "first write");
    await service.backup(target);
    await fs.writeFile(target, "second write");

    await service.rollback();

    expect(await fs.readFile(target, "utf8")).toBe(ORIGINAL);
  });

  it("does not back up a file the apply itself created", async () => {
    const target = await create("mine.txt", "first");
    await service.backup(target);
    await fs.writeFile(target, "second");

    await service.rollback();

    expect(await fs.pathExists(target)).toBe(false);
  });

  it("removes the .lisabak copy it wrote for a restored file", async () => {
    const target = path.join(destDir, MODIFIED);
    await fs.writeFile(target, ORIGINAL);
    await service.backup(target);
    await service.persistentBackup(target);
    await fs.writeFile(target, "changed");

    await service.rollback();

    expect(await fs.readFile(target, "utf8")).toBe(ORIGINAL);
    expect(await fs.pathExists(path.join(destDir, ".lisabak"))).toBe(false);
  });

  it("keeps a .lisabak directory that predates the apply", async () => {
    const earlier = path.join(destDir, ".lisabak", "earlier", "kept.txt");
    await fs.ensureDir(path.dirname(earlier));
    await fs.writeFile(earlier, "older backup");
    const target = path.join(destDir, MODIFIED);
    await fs.writeFile(target, ORIGINAL);
    await service.backup(target);
    await service.persistentBackup(target);

    await service.rollback();

    expect(await fs.readdir(path.join(destDir, ".lisabak"))).toEqual([
      "earlier",
    ]);
  });

  it("keeps a dangling symlink the host already had", async () => {
    const link = path.join(destDir, "link.txt");
    await fs.symlink("missing-target.txt", link);

    await service.backup(link);
    await service.rollback();

    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(link)).toBe("missing-target.txt");
  });

  it("keeps the pre-apply bytes in .lisabak across a second write", async () => {
    const target = path.join(destDir, "twice.txt");
    await fs.writeFile(target, ORIGINAL);
    await service.backup(target);
    await service.persistentBackup(target);
    await fs.writeFile(target, "first write");
    await service.backup(target);
    await service.persistentBackup(target);

    const [stamp] = await fs.readdir(path.join(destDir, ".lisabak"));
    expect(
      await fs.readFile(
        path.join(destDir, ".lisabak", stamp ?? "", "twice.txt"),
        "utf8"
      )
    ).toBe(ORIGINAL);
  });

  it("forgets created paths on success, so cleanup deletes nothing", async () => {
    const target = await create("kept/new.txt");

    await service.cleanup();

    expect(await fs.readFile(target, "utf8")).toBe("x");
  });

  it("never records a path that escapes through a symlinked ancestor", async () => {
    const outsideDir = path.join(tempDir, "elsewhere");
    await fs.ensureDir(outsideDir);
    await fs.symlink(outsideDir, path.join(destDir, "link"));
    const viaLink = path.join(destDir, "link", "new.txt");
    await service.backup(viaLink);
    await fs.writeFile(viaLink, "lands outside");

    await service.rollback();

    expect(await fs.readFile(path.join(outsideDir, "new.txt"), "utf8")).toBe(
      "lands outside"
    );
  });

  it("a re-initialised service writes a fresh .lisabak directory", async () => {
    const target = path.join(destDir, MODIFIED);
    await fs.writeFile(target, FIRST_APPLY);
    await service.persistentBackup(target);
    await service.cleanup();
    const [firstStamp] = await fs.readdir(path.join(destDir, ".lisabak"));
    const firstCopy = path.join(
      destDir,
      ".lisabak",
      firstStamp ?? "",
      MODIFIED
    );

    await new Promise(resolve => setTimeout(resolve, 1100));
    await service.init(destDir);
    await fs.writeFile(target, SECOND_APPLY);
    await service.backup(target);
    await service.persistentBackup(target);
    await service.rollback();

    expect(await fs.readFile(firstCopy, "utf8")).toBe(FIRST_APPLY);
  });

  it("never overwrites an earlier apply's .lisabak copy made in the same second", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 0, 2, 3, 4, 5) });
    try {
      const target = path.join(destDir, MODIFIED);
      await fs.writeFile(target, FIRST_APPLY);
      await service.persistentBackup(target);
      await service.cleanup();

      await service.init(destDir);
      await fs.writeFile(target, SECOND_APPLY);
      await service.persistentBackup(target);

      const stamps = (await fs.readdir(path.join(destDir, ".lisabak"))).sort(
        (a, b) => a.length - b.length
      );
      expect(stamps).toHaveLength(2);
      const copies = await Promise.all(
        stamps.map(stamp =>
          fs.readFile(path.join(destDir, ".lisabak", stamp, MODIFIED), "utf8")
        )
      );
      expect(copies).toEqual([FIRST_APPLY, SECOND_APPLY]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores paths outside the destination tree", async () => {
    const outside = path.join(tempDir, "outside", "file.txt");
    await service.backup(outside);
    await fs.ensureDir(path.dirname(outside));
    await fs.writeFile(outside, "not ours");

    await service.rollback();

    expect(await fs.readFile(outside, "utf8")).toBe("not ours");
  });
});
