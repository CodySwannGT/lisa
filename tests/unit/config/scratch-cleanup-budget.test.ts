/** Deterministic boundary proof for the inode-bound cleanup program. */
import * as path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  BOUND_CHILDREN_CLEANUP_PROGRAM,
  BOUND_DIRECTORY_CLEANUP_PROGRAM,
} from "../../../src/configs/vitest/scratch-bound-cleanup-programs.js";
import {
  SCRATCH_DIRECT_ENTRY_LIMIT,
  SCRATCH_DIRECT_NAME_BYTES,
  collectBoundedScratchNames,
} from "../../../src/configs/vitest/scratch-authority.js";

/** Minimal virtual filesystem exercised by the actual child-program source. */
interface VirtualTree {
  readonly fs: Readonly<Record<string, (...args: never[]) => unknown>>;
  readonly remaining: () => number;
}

/**
 * Build a mixed tree without performing 100k host filesystem transactions.
 * @param directoryCount - Direct directories to model
 * @param fileCount - Files distributed through the modeled directories
 * @returns Mutable virtual filesystem and remaining-entry probe
 */
function virtualTree(directoryCount: number, fileCount: number): VirtualTree {
  const directories = new Set<string>(["."]);
  const files = new Set<string>();
  const children = new Map<string, Set<string>>([[".", new Set()]]);
  const addDirectory = (candidate: string): void => {
    directories.add(candidate);
    children.set(candidate, new Set());
    children.get(".")?.add(candidate);
  };
  for (let index = 0; index < directoryCount; index += 1) {
    addDirectory(`directory-${String(index)}`);
  }
  for (let index = 0; index < fileCount; index += 1) {
    const parent =
      directoryCount === 0
        ? "."
        : `directory-${String(index % directoryCount)}`;
    const basename = `file-${String(index)}`;
    const candidate =
      parent === "." ? basename : path.posix.join(parent, basename);
    files.add(candidate);
    children.get(parent)?.add(basename);
  }
  const parentOf = (candidate: string): readonly [string, string] => {
    const parent = path.posix.dirname(candidate);
    return [parent === "." ? "." : parent, path.posix.basename(candidate)];
  };
  const stats = (directory: boolean) => ({
    dev: 1,
    ino: 2,
    isDirectory: () => directory,
    isSymbolicLink: () => false,
  });
  return {
    fs: {
      lstatSync: ((candidate: string) => {
        if (directories.has(candidate)) return stats(true);
        if (files.has(candidate)) return stats(false);
        throw Object.assign(new Error(`missing ${candidate}`), {
          code: "ENOENT",
        });
      }) as (...args: never[]) => unknown,
      readdirSync: ((candidate: string) => [
        ...(children.get(candidate) ?? []),
      ]) as (...args: never[]) => unknown,
      opendirSync: ((candidate: string) => {
        const iterator = [...(children.get(candidate) ?? [])][
          Symbol.iterator
        ]();
        return {
          closeSync: () => undefined,
          readSync: () => {
            const next = iterator.next();
            return next.done ? null : { name: next.value };
          },
        };
      }) as (...args: never[]) => unknown,
      unlinkSync: ((candidate: string) => {
        files.delete(candidate);
        const [parent, basename] = parentOf(candidate);
        children.get(parent)?.delete(basename);
      }) as (...args: never[]) => unknown,
      rmdirSync: ((candidate: string) => {
        if ((children.get(candidate)?.size ?? 0) > 0) {
          throw Object.assign(new Error(`not empty ${candidate}`), {
            code: "ENOTEMPTY",
          });
        }
        directories.delete(candidate);
        children.delete(candidate);
        const [parent, basename] = parentOf(candidate);
        children.get(parent)?.delete(basename);
      }) as (...args: never[]) => unknown,
    },
    remaining: () => files.size + directories.size - 1,
  };
}

/**
 * Execute the production child-program source against a virtual tree.
 * @param tree - Virtual filesystem to mutate
 */
function runCleanup(tree: VirtualTree): void {
  // eslint-disable-next-line sonarjs/code-eval -- the production cleanup program is the regression subject; the VM exposes only inert fake fs/path/process capabilities
  runInNewContext(BOUND_DIRECTORY_CLEANUP_PROGRAM, {
    Buffer,
    Date,
    process: {
      argv: ["node", "1", "2"],
      exit: (code: number) => {
        throw new Error(`unexpected exit ${String(code)}`);
      },
      stderr: { write: () => undefined },
    },
    require: (specifier: string) =>
      specifier === "node:fs" ? tree.fs : path.posix,
  });
}

/**
 * Exercise the batched-child worker only through its no-mutation preflight.
 * @param tree - Virtual tree whose directory-0 child is selected
 */
function runChildCleanupPreflight(tree: VirtualTree): void {
  const fsWithInput = {
    ...tree.fs,
    readFileSync: (() =>
      JSON.stringify([
        {
          basename: "directory-0",
          dev: "1",
          ino: "2",
          directory: true,
          symlink: false,
        },
      ])) as (...args: never[]) => unknown,
    renameSync: (() => {
      throw new Error("cleanup mutated before bounded preflight completed");
    }) as (...args: never[]) => unknown,
  };
  // eslint-disable-next-line sonarjs/code-eval -- the production cleanup program is the regression subject; the VM exposes only inert fake capabilities
  runInNewContext(BOUND_CHILDREN_CLEANUP_PROGRAM, {
    Buffer,
    Date,
    process: {
      argv: ["node", "1", "2"],
      exit: (code: number) => {
        throw new Error(`unexpected exit ${String(code)}`);
      },
      stderr: { write: () => undefined },
    },
    require: (specifier: string) => {
      if (specifier === "node:fs") return fsWithInput;
      if (specifier === "node:path") return path.posix;
      return { randomBytes: () => Buffer.alloc(16) };
    },
  });
}

describe("scratch cleanup entry budget", () => {
  it("counts 99,901 mixed nested filesystem entries once", () => {
    const tree = virtualTree(100, 99_801);

    runCleanup(tree);

    expect(tree.remaining()).toBe(0);
  });

  it("refuses entry 100,001 before mutating the directory", () => {
    const tree = virtualTree(0, 100_001);

    expect(() => runCleanup(tree)).toThrow(/entry bound/iu);
    expect(tree.remaining()).toBe(100_001);
  });

  it("refuses an oversized basename before mutating the directory", () => {
    const tree = virtualTree(0, 1);
    const originalOpen = tree.fs.opendirSync;
    const fsWithOversizedName = {
      ...tree.fs,
      opendirSync: ((candidate: string) => {
        if (candidate !== ".") return originalOpen(candidate as never);
        let emitted = false;
        return {
          closeSync: () => undefined,
          readSync: () => {
            if (emitted) return null;
            emitted = true;
            return { name: "x".repeat(1_025) };
          },
        };
      }) as (...args: never[]) => unknown,
    };

    expect(() => runCleanup({ ...tree, fs: fsWithOversizedName })).toThrow(
      /1024 bytes/iu
    );
    expect(tree.remaining()).toBe(1);
  });

  it("bounds a selected child tree before the quarantine rename", () => {
    const tree = virtualTree(1, 100_001);

    expect(() => runChildCleanupPreflight(tree)).toThrow(/entry bound/iu);
    expect(tree.remaining()).toBe(100_002);
  });
});

describe("bounded authorized-child entry reader", () => {
  it("accepts exactly the direct-entry limit", () => {
    const names = {
      *[Symbol.iterator](): Iterator<string> {
        for (let index = 0; index < SCRATCH_DIRECT_ENTRY_LIMIT; index += 1) {
          yield `entry-${String(index)}`;
        }
      },
    };

    expect(collectBoundedScratchNames(names)).toHaveLength(
      SCRATCH_DIRECT_ENTRY_LIMIT
    );
  });

  it("refuses before retaining entry 100,001", () => {
    const names = {
      *[Symbol.iterator](): Iterator<string> {
        for (let index = 0; index <= SCRATCH_DIRECT_ENTRY_LIMIT; index += 1) {
          yield `entry-${String(index)}`;
        }
      },
    };

    expect(() => collectBoundedScratchNames(names)).toThrow(/100000/iu);
  });

  it("refuses a basename over 1,024 UTF-8 bytes", () => {
    expect(() =>
      collectBoundedScratchNames(["x".repeat(SCRATCH_DIRECT_NAME_BYTES + 1)])
    ).toThrow(/1024 bytes/iu);
  });
});
