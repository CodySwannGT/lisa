import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { replacePathSepForRegex } from "jest-regex-util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { getExpoJestConfig } from "../../src/configs/jest/expo.js";

const require = createRequire(import.meta.url);
const gracefulFs = require("graceful-fs") as typeof import("node:fs");
const originalReaddir = gracefulFs.readdir;

/** Public Jest HasteMap constructor exercised by the traversal regression. */
type HasteMapConstructor = (typeof import("jest-haste-map"))["default"];

let HasteMap: HasteMapConstructor;
let recordVisitedDirectories = false;
let visitedDirectories: string[] = [];
let temporaryRoot: string;

const slash = (filePath: string): string => filePath.split(sep).join("/");

const crawlWithExpoConfig = async (
  rootDir: string
): Promise<readonly string[]> => {
  const config = getExpoJestConfig();
  const ignorePatterns = (config.modulePathIgnorePatterns ?? []).map(pattern =>
    replacePathSepForRegex(pattern.replaceAll("<rootDir>", rootDir))
  );
  const cacheDirectory = await mkdtemp(
    join(tmpdir(), "lisa-jest-haste-cache-")
  );

  try {
    recordVisitedDirectories = true;
    const hasteMap = await HasteMap.create({
      cacheDirectory,
      computeDependencies: false,
      extensions: ["ts"],
      // Keep the pre-fix reproduction on the observable Node walker. The unit
      // contract independently fails when the factory omits this required flag.
      forceNodeFilesystemAPI: config.haste?.forceNodeFilesystemAPI ?? true,
      id: "lisa-jest-expo-pruning",
      ...(ignorePatterns.length > 0
        ? { ignorePattern: new RegExp(ignorePatterns.join("|")) }
        : {}),
      maxWorkers: 1,
      platforms: [...(config.haste?.platforms ?? [])],
      resetCache: true,
      retainAllFiles: true,
      rootDir,
      roots: [rootDir],
      useWatchman: false,
    });
    const { hasteFS } = await hasteMap.build();

    return hasteFS
      .getAllFiles()
      .map(filePath => slash(relative(rootDir, filePath)))
      .sort((left, right) => left.localeCompare(right));
  } finally {
    recordVisitedDirectories = false;
    await rm(cacheDirectory, { force: true, recursive: true });
  }
};

const directoriesAtOrBelow = (directory: string): readonly string[] =>
  visitedDirectories.filter(
    visited => visited === directory || visited.startsWith(`${directory}${sep}`)
  );

describe("getExpoJestConfig haste traversal", () => {
  beforeAll(() => {
    const mutableGracefulFs = gracefulFs as unknown as {
      readdir: (...args: unknown[]) => unknown;
    };
    mutableGracefulFs.readdir = (...args: unknown[]): unknown => {
      if (recordVisitedDirectories) {
        visitedDirectories.push(String(args[0]));
      }
      return Reflect.apply(
        originalReaddir as (...parameters: unknown[]) => unknown,
        gracefulFs,
        args
      );
    };
    HasteMap = (
      require("jest-haste-map") as {
        default: HasteMapConstructor;
      }
    ).default;
  });

  afterAll(() => {
    recordVisitedDirectories = false;
    gracefulFs.readdir = originalReaddir;
  });

  beforeEach(async () => {
    visitedDirectories = [];
    temporaryRoot = await mkdtemp(join(tmpdir(), "lisa-jest-haste-proof-"));
  });

  afterEach(async () => {
    recordVisitedDirectories = false;
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  it("prunes repo-root .claude/worktrees before descending", async () => {
    const projectRoot = join(temporaryRoot, "project");
    const visibleFile = join(projectRoot, "src", "visible.ts");
    const worktreesRoot = join(projectRoot, ".claude", "worktrees");
    const hiddenFile = join(
      worktreesRoot,
      "poison",
      "node_modules",
      "package",
      "hidden.ts"
    );
    await mkdir(dirname(visibleFile), { recursive: true });
    await mkdir(dirname(hiddenFile), { recursive: true });
    await writeFile(visibleFile, "export const visible = true;\n");
    await writeFile(hiddenFile, "export const hidden = true;\n");

    const files = await crawlWithExpoConfig(projectRoot);
    const traversedWorktreeDirectories = directoriesAtOrBelow(worktreesRoot);

    expect(visitedDirectories).toContain(projectRoot);
    expect(visitedDirectories).toContain(dirname(visibleFile));
    expect(
      traversedWorktreeDirectories,
      `expected the walker to prune ${worktreesRoot}; visited ${JSON.stringify(
        traversedWorktreeDirectories
      )}`
    ).toEqual([]);
    expect(files).toContain("src/visible.ts");
    expect(files.filter(filePath => filePath.startsWith(".claude/"))).toEqual(
      []
    );
  });

  it("keeps the current agent worktree visible while pruning its nested .claude tree", async () => {
    const worktreeRoot = join(
      temporaryRoot,
      "primary",
      ".claude",
      "worktrees",
      "current"
    );
    const visibleFile = join(worktreeRoot, "src", "visible.ts");
    const nestedWorktreesRoot = join(worktreeRoot, ".claude", "worktrees");
    const hiddenFile = join(nestedWorktreesRoot, "stale", "hidden.ts");
    await mkdir(dirname(visibleFile), { recursive: true });
    await mkdir(dirname(hiddenFile), { recursive: true });
    await writeFile(visibleFile, "export const visible = true;\n");
    await writeFile(hiddenFile, "export const hidden = true;\n");

    const files = await crawlWithExpoConfig(worktreeRoot);
    const traversedNestedDirectories =
      directoriesAtOrBelow(nestedWorktreesRoot);

    expect(visitedDirectories).toContain(worktreeRoot);
    expect(visitedDirectories).toContain(dirname(visibleFile));
    expect(
      traversedNestedDirectories,
      `expected the walker to prune ${nestedWorktreesRoot}; visited ${JSON.stringify(
        traversedNestedDirectories
      )}`
    ).toEqual([]);
    expect(files).toContain("src/visible.ts");
    expect(files.filter(filePath => filePath.startsWith(".claude/"))).toEqual(
      []
    );
  });
});
