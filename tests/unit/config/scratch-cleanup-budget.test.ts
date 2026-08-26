/** Deterministic boundary proof for the inode-bound cleanup program. */
import * as path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { BOUND_DIRECTORY_CLEANUP_PROGRAM } from "../../../src/configs/vitest/scratch-authority.js";

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

describe("scratch cleanup entry budget", () => {
  it("counts 99,901 mixed nested filesystem entries once", () => {
    const tree = virtualTree(100, 99_801);

    runCleanup(tree);

    expect(tree.remaining()).toBe(0);
  });

  it("refuses entry 100,001 and completes the interrupted cleanup", () => {
    const tree = virtualTree(0, 100_001);

    expect(() => runCleanup(tree)).toThrow(/entry bound/iu);
    expect(tree.remaining()).toBe(1);
    runCleanup(tree);
    expect(tree.remaining()).toBe(0);
  });
});
