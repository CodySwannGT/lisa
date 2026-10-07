/** Native descriptor failure, permission and shared read-only cache contracts. */
import { chmod, link, readFile, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fixture,
  cleanupFixtures,
  PARITY,
  DEDUPE,
  COPY_DIRECTORY,
  OLD_DEDUPE,
} from "./refresh-hooks-fixture.js";

const observation = vi.hoisted(() => {
  const state: {
    before?: (filename: string, handle: FileHandle) => Promise<void>;
    handles: FileHandle[];
  } = { handles: [] };
  return state;
});

// Native writes and errors remain actual; the control closes only its own handle.
vi.mock("node:fs/promises", async importOriginal => {
  const native = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...native,
    open: async (...args: Parameters<typeof native.open>) => {
      const handle = await native.open(...args);
      const write = handle.write;
      observation.handles.push(handle);
      vi.spyOn(handle, "write").mockImplementation(async (...writeArgs) => {
        await observation.before?.(String(args[0]), handle);
        return Reflect.apply(write, handle, writeArgs);
      });
      return handle;
    },
  };
});

afterEach(async () => {
  delete observation.before;
  observation.handles.length = 0;
  vi.restoreAllMocks();
  await cleanupFixtures();
});

describe("native scoped refresh descriptors", () => {
  it("retains original and rollback errors after a real later descriptor closes", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    const later = path.join(
      input.host,
      "scripts/lisa-hooks/parity-safety-net-heredoc.py"
    );
    let closed = false;
    observation.before = async (filename, handle) => {
      if (filename !== later || closed) return;
      closed = true;
      await handle.close();
    };
    const result = await refreshHooks(input.host, input).then(
      () => null,
      error => error
    );
    expect(closed).toBe(true);
    expect(result).toBeInstanceOf(AggregateError);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].code).toBe("EBADF");
    expect(result.errors[1].code).toBe("EBADF");
    expect(await readFile(path.join(input.host, DEDUPE), "utf8")).toBe(
      OLD_DEDUPE
    );
    expect(observation.handles.length).toBeGreaterThan(0);
    expect(observation.handles.every(handle => handle.fd === -1)).toBe(true);
  });

  it("reads a shared package inode without changing its bytes or permissions", async () => {
    const { refreshHooks } =
      await import("../../../src/cli/refresh-hooks-cmd.js");
    const input = await fixture();
    const source = path.join(input.packageDir, COPY_DIRECTORY, PARITY);
    const alias = path.join(path.dirname(input.host), "cache-link");
    await chmod(source, 0o755);
    await link(source, alias);
    await refreshHooks(input.host, input);
    expect(await readFile(alias, "utf8")).toBe(
      "# current parity-safety-net.sh\n"
    );
    expect((await stat(alias)).mode & 0o777).toBe(0o755);
    expect((await stat(path.join(input.host, PARITY))).mode & 0o777).toBe(
      0o755
    );
    expect(observation.handles.every(handle => handle.fd === -1)).toBe(true);
  });
});
