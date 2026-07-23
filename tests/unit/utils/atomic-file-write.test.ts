/**
 * Shared atomic + durable file replacement.
 *
 * The temp-write/rename block was copy-pasted across four writers and had
 * drifted: `src/standards/storage.ts` and `src/health/storage.ts` fsync both the
 * file handle and the containing directory, while the learnings writer's two
 * copies fsynced neither — so a power loss could land a renamed-but-empty
 * ledger (CodySwannGT/lisa#1995). These tests pin the durability contract on one
 * helper and assert every call site routes through it.
 */
import * as fs from "fs-extra";
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileAtomically } from "../../../src/utils/atomic-file-write.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Low nine POSIX permission bits, without bitwise masking. */
const PERMISSION_BITS = 0o1000;

/**
 * Read one file's POSIX permission bits.
 * @param file - Path to inspect
 * @returns Permission bits
 */
async function permissionsOf(file: string): Promise<number> {
  return (await stat(file)).mode % PERMISSION_BITS;
}

describe("writeFileAtomically", () => {
  let tempDir: string;
  let target: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    target = path.join(tempDir, "payload.md");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("publishes the full content", async () => {
    await writeFileAtomically(target, "hello\n");
    expect(await readFile(target, "utf8")).toBe("hello\n");
  });

  it("replaces existing content in place", async () => {
    await fs.outputFile(target, "old\n");
    await writeFileAtomically(target, "new\n");
    expect(await readFile(target, "utf8")).toBe("new\n");
  });

  it("fsyncs the file handle before publishing", async () => {
    const sync = vi.fn(async () => {});
    await writeFileAtomically(target, "durable\n", { onFileSync: sync });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("fsyncs the containing directory after the rename", async () => {
    const calls: string[] = [];
    await writeFileAtomically(target, "durable\n", {
      openDirectory: async () => ({
        sync: async () => {
          calls.push("dir-sync");
        },
        close: async () => {},
      }),
    });
    expect(calls).toEqual(["dir-sync"]);
  });

  it("leaves no temp file behind on success", async () => {
    await writeFileAtomically(target, "clean\n");
    const leftovers = (await fs.readdir(tempDir)).filter(name =>
      name.endsWith(".tmp")
    );
    expect(leftovers).toEqual([]);
  });

  it("leaves no temp file behind when the write fails", async () => {
    await expect(
      writeFileAtomically(target, "boom\n", {
        beforeRename: async () => {
          throw new Error("safety re-check failed");
        },
      })
    ).rejects.toThrow(/safety re-check failed/);
    const leftovers = (await fs.readdir(tempDir)).filter(name =>
      name.endsWith(".tmp")
    );
    expect(leftovers).toEqual([]);
  });

  it("never leaves a partially written target when the write fails", async () => {
    await fs.outputFile(target, "original\n");
    await expect(
      writeFileAtomically(target, "replacement\n", {
        beforeRename: async () => {
          throw new Error("safety re-check failed");
        },
      })
    ).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("original\n");
  });

  it("runs the caller's safety re-check between write and rename", async () => {
    const order: string[] = [];
    await writeFileAtomically(target, "checked\n", {
      beforeRename: async () => {
        order.push("before-rename");
        expect(await fs.pathExists(target)).toBe(false);
      },
    });
    order.push("renamed");
    expect(order).toEqual(["before-rename", "renamed"]);
  });

  it("applies an explicit restrictive mode when the caller asks for one", async () => {
    await writeFileAtomically(target, "private\n", { mode: 0o600 });
    expect(await permissionsOf(target)).toBe(0o600);
  });

  it("preserves default platform permissions when no mode is given", async () => {
    // The learnings ledger is a committed, human-read file that predates this
    // helper at default permissions. Forcing 0o600 here would silently tighten
    // it on the next write, so an omitted mode must stay platform-default.
    const reference = path.join(tempDir, "reference.md");
    await fs.outputFile(reference, "x\n");
    await writeFileAtomically(target, "shared\n");
    expect(await permissionsOf(target)).toBe(await permissionsOf(reference));
  });
});

describe("atomic write call sites", () => {
  /**
   * Read one source file from the repository root.
   * @param relative - Repo-relative source path
   * @returns File contents
   */
  async function source(relative: string): Promise<string> {
    return readFile(path.resolve(relative), "utf8");
  }

  const CALL_SITES = [
    "src/core/learnings-writer.ts",
    "src/health/storage.ts",
    "src/standards/storage.ts",
  ] as const;

  it.each(CALL_SITES)("routes %s through the shared helper", async file => {
    expect(await source(file)).toMatch(/writeFileAtomically/);
  });

  it.each(CALL_SITES)(
    "removes the inlined temp-file construction from %s",
    async file => {
      expect(await source(file)).not.toMatch(/\.tmp`/);
    }
  );

  it.each(CALL_SITES)("removes the inlined rename from %s", async file => {
    expect(await source(file)).not.toMatch(/\brename\(temporary\b/);
  });

  it("routes both learnings writer paths through the helper", async () => {
    const contents = await source("src/core/learnings-writer.ts");
    expect(contents.match(/writeFileAtomically\(/g)).toHaveLength(2);
  });
});
