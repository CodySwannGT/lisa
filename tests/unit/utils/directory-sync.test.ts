import { describe, expect, it, vi } from "vitest";

import {
  type DirectorySyncHandle,
  syncContainingDirectory,
} from "../../../src/utils/directory-sync.js";

const codedError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(code), { code });
const DIRECTORY = "/project/.lisa";

describe("syncContainingDirectory", () => {
  it.each(["EISDIR", "EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"])(
    "treats unsupported directory-open error %s as best effort",
    async code => {
      const opener = vi.fn(async () => {
        throw codedError(code);
      });
      await expect(
        syncContainingDirectory(DIRECTORY, opener)
      ).resolves.toBeUndefined();
    }
  );

  it.each(["EBADF", "EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"])(
    "treats unsupported directory-sync error %s as best effort",
    async code => {
      const handle: DirectorySyncHandle = {
        sync: vi.fn(async () => {
          throw codedError(code);
        }),
        close: vi.fn(async () => undefined),
      };
      await expect(
        syncContainingDirectory(DIRECTORY, async () => handle)
      ).resolves.toBeUndefined();
      expect(handle.close).toHaveBeenCalledOnce();
    }
  );

  it("preserves real directory-open I/O failures", async () => {
    const failure = codedError("EACCES");
    await expect(
      syncContainingDirectory(DIRECTORY, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });

  it("preserves real directory-sync I/O failures and still closes", async () => {
    const failure = codedError("EIO");
    const handle: DirectorySyncHandle = {
      sync: vi.fn(async () => {
        throw failure;
      }),
      close: vi.fn(async () => undefined),
    };
    await expect(
      syncContainingDirectory(DIRECTORY, async () => handle)
    ).rejects.toBe(failure);
    expect(handle.close).toHaveBeenCalledOnce();
  });
});
