import * as fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { writeStarterFile } from "../../../src/cli/starter-sync-write.js";
import { readProjectFile } from "../../../src/health/read-only-fs.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const FS_MODULE = "node:fs/promises";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe("starter deletion preserves concurrent edits", () => {
  it("preserves both files when a concurrent replacement prevents restoration", async () => {
    const root = await fs.realpath(await createTempDir());
    const target = path.join(root, "owned.txt");
    const actual = await vi.importActual<typeof fs>(FS_MODULE);
    try {
      await fs.writeFile(target, "original");
      const expected = await readProjectFile(root, "owned.txt");
      vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => {
        await actual.rename(from, to);
        await fs.writeFile(target, "new concurrent file");
      });
      const error = await writeStarterFile(
        root,
        "owned.txt",
        expected,
        undefined,
        0o644
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBeInstanceOf(AggregateError);
      expect(((error as Error).cause as AggregateError).errors).toEqual([
        expect.objectContaining({
          message: "Starter destination changed during sync: owned.txt",
        }),
        expect.objectContaining({ code: "EEXIST" }),
      ]);
      const recovery = (error as Error).message.split(
        "; displaced entry preserved at "
      )[1];
      expect(recovery).toBeDefined();
      expect(await fs.readFile(target, "utf8")).toBe("new concurrent file");
      expect(await fs.readFile(path.join(root, recovery!), "utf8")).toBe(
        "original"
      );
    } finally {
      vi.mocked(fs.rename).mockReset().mockImplementation(actual.rename);
      await cleanupTempDir(root);
    }
  });

  it.each(["different bytes", "same bytes"])(
    "refuses a concurrent replacement with %s before removal",
    async change => {
      const root = await fs.realpath(await createTempDir());
      const target = path.join(root, "owned.txt");
      const replacement = path.join(root, "replacement.txt");
      const actual = await vi.importActual<typeof fs>(FS_MODULE);
      const bytes = change === "same bytes" ? "old" : "concurrent";
      try {
        await fs.writeFile(target, "old");
        await fs.writeFile(replacement, bytes);
        const expected = await readProjectFile(root, "owned.txt");
        const replace = async () => actual.rename(replacement, target);
        vi.mocked(fs.rename).mockImplementationOnce(async (from, to) => {
          await replace();
          await actual.rename(from, to);
        });
        await expect(
          writeStarterFile(root, "owned.txt", expected, undefined, 0o644)
        ).rejects.toThrow(/changed during sync/);
        expect(await fs.readFile(target, "utf8")).toBe(bytes);
      } finally {
        vi.mocked(fs.rename).mockReset().mockImplementation(actual.rename);
        await cleanupTempDir(root);
      }
    }
  );
});
