/**
 * A plugin rebuild must never leave a live hook missing (CodySwannGT/lisa#4583).
 *
 * Running sessions resolve Lisa's enforcement guards from the live plugin
 * trees, and the dispatcher refuses every tool call when it finds none. The
 * builder used to `rm -rf plugins/lisa` and copy the source back in, then stamp
 * the guards and add the Rails hook engine several Node processes later, so
 * every rebuild opened a window in which the guards were absent or not yet the
 * final bytes. A 1 ms sampler on a full checkout found the guard absent in 56
 * of 198 samples.
 *
 * The case below runs the real builder twice over one fixture and samples every
 * hook file of every built tree throughout the second run. With nothing changed
 * in the source, every sample must read the same bytes the first build wrote.
 *
 * @module tests/unit/scripts/plugin-build-guard-availability
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import {
  clearStaleStages,
  ownerGone,
  publishPluginTree,
  withPublishLock,
} from "../../../scripts/lib/publish-plugin-tree.mjs";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(".");
const PLUGINS = "plugins";
const SCRIPTS = "scripts";
const BUILDER = "build-plugins.sh";
const BUILD_SCRIPT = path.join(SCRIPTS, BUILDER);
/** The builder plus everything it starts, as the real build resolves them. */
const BUILDER_FILES = [
  BUILDER,
  "generate-agy-plugin-artifacts.mjs",
  "generate-codex-plugin-artifacts.mjs",
  "generate-copilot-plugin-artifacts.mjs",
  "generate-cursor-plugin-artifacts.mjs",
  "generate-devin-plugin-artifacts.mjs",
  "materialize-copy-overwrite.mjs",
] as const;
/** A guard the dispatcher resolves; its source is copied from this repo. */
const GUARD = "block-no-verify.sh";
/** A full build is several Node processes; see plugin-sync-scripts.test.ts. */
const BUILD_BASE_MS = 30_000;
/** Fewer samples than this means the sampler did not watch the rebuild. */
const MIN_SAMPLES = 20;

describe("plugin rebuild keeps every live hook available (#4583)", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
    await seedFixture(root);
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("never shows a session a missing or partial hook while it rebuilds", async () => {
    const first = buildSync(root);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);

    const watched = await hookFiles(root);
    expect(watched.map(([file]) => path.relative(root, file))).toEqual(
      expect.arrayContaining([
        path.join(PLUGINS, "lisa", "hooks", GUARD),
        path.join(PLUGINS, "lisa", "hooks", "rails-hooks.mjs"),
      ])
    );

    const observed = { samples: 0, unavailable: new Set<string>() };
    const sample = (): void => {
      observed.samples += 1;
      for (const [file, bytes] of watched) {
        if (!readOrNull(file)?.equals(bytes)) {
          observed.unavailable.add(path.relative(root, file));
        }
      }
    };
    const sampler = setInterval(sample, 1);
    try {
      const code = await buildAsync(root);
      expect(code).toBe(0);
    } finally {
      clearInterval(sampler);
    }
    sample();

    expect(observed.samples).toBeGreaterThanOrEqual(MIN_SAMPLES);
    expect([...observed.unavailable]).toEqual([]);
  });
});

describe("publishPluginTree", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("replaces changed files, adds new ones and removes retired ones last", async () => {
    const live = path.join(root, "live");
    const staged = path.join(root, "staged");
    await writeTree(live, {
      "hooks/guard.sh": "old guard",
      "hooks/retired.sh": "retired",
      "skills/gone/SKILL.md": "gone",
      "same.txt": "unchanged",
      "kind-change": "was a file",
    });
    await writeTree(staged, {
      "hooks/guard.sh": "new guard",
      "hooks/added.sh": "added",
      "same.txt": "unchanged",
      "kind-change/inner.txt": "now a directory",
    });
    const unchangedInode = (await fs.stat(path.join(live, "same.txt"))).ino;

    publishPluginTree(staged, live);

    expect(await readTree(live)).toEqual({
      "hooks/added.sh": "added",
      "hooks/guard.sh": "new guard",
      "kind-change/inner.txt": "now a directory",
      "same.txt": "unchanged",
    });
    expect((await fs.stat(path.join(live, "same.txt"))).ino).toBe(
      unchangedInode
    );
    expect(await fs.pathExists(staged)).toBe(false);
  });

  it("carries a changed permission bit even when the bytes are identical", async () => {
    const live = path.join(root, "live");
    const staged = path.join(root, "staged");
    await writeTree(live, { "hooks/guard.sh": "guard" });
    await writeTree(staged, { "hooks/guard.sh": "guard" });
    await fs.chmod(path.join(staged, "hooks", "guard.sh"), 0o755);

    publishPluginTree(staged, live);

    expect(
      (await fs.stat(path.join(live, "hooks", "guard.sh"))).mode & 0o777
    ).toBe(0o755);
  });

  it("moves the whole staged tree in when nothing is live yet", async () => {
    const live = path.join(root, "plugins", "lisa-new");
    const staged = path.join(root, "staged");
    await writeTree(staged, { "hooks/guard.sh": "guard" });

    publishPluginTree(staged, live);

    expect(await readTree(live)).toEqual({ "hooks/guard.sh": "guard" });
    expect(await fs.pathExists(staged)).toBe(false);
  });

  it("refuses to publish a staged tree that does not exist", () => {
    expect(() =>
      publishPluginTree(path.join(root, "missing"), path.join(root, "live"))
    ).toThrow("no staged tree");
  });
});

/** The publish helper's CLI, as the builder calls it. */
const PUBLISH_CLI = path.join(
  REPO_ROOT,
  SCRIPTS,
  "lib",
  "publish-plugin-tree.mjs"
);
/** The checkout-wide lock the helper holds while it publishes. */
const LOCK_FILE = ".publish.lock";

/**
 * A liveness probe that answers from a table instead of the process table.
 * @param codes Error code `process.kill(pid, 0)` would raise per pid; absent means alive.
 * @returns A `process.kill`-shaped probe.
 */
function probeFrom(
  codes: Readonly<Record<number, string>>
): (pid: number, signal: number) => unknown {
  return (pid: number) => {
    const code = codes[pid];
    if (code === undefined) return true;
    throw Object.assign(new Error(code), { code });
  };
}

/**
 * The pid of a process that has already exited.
 * @returns A pid with no process behind it.
 */
function exitedPid(): number {
  const child = boundedSpawnSync({
    label: "exited child",
    command: process.execPath,
    args: ["-e", ""],
    cwd: REPO_ROOT,
    env: childEnv(),
  });
  return child.pid as number;
}

describe("stale staging areas are cleared only when their owner is gone", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("treats only ESRCH as gone, never EPERM or another error", () => {
    const probe = probeFrom({ 11: "ESRCH", 12: "EPERM", 13: "EINVAL" });
    expect(ownerGone(11, probe)).toBe(true);
    expect(ownerGone(12, probe)).toBe(false);
    expect(ownerGone(13, probe)).toBe(false);
    expect(ownerGone(14, probe)).toBe(false);
    expect(ownerGone(0, probe)).toBe(false);
    expect(ownerGone(Number.NaN, probe)).toBe(false);
  });

  it("reads the real process table: an exited pid is gone, this one is not", () => {
    expect(ownerGone(exitedPid())).toBe(true);
    expect(ownerGone(process.pid)).toBe(false);
  });

  it("removes a dead build's stage and keeps a running, foreign or unnamed one", async () => {
    for (const name of [
      ".build-staging-11",
      ".build-staging-12",
      ".build-staging-14",
      ".build-staging-abc",
      "lisa",
    ]) {
      await fs.ensureDir(path.join(root, name));
    }
    const probe = probeFrom({ 11: "ESRCH", 12: "EPERM" });

    expect(clearStaleStages(root, probe)).toEqual([".build-staging-11"]);
    expect(
      sortedKeys(
        Object.fromEntries((await fs.readdir(root)).map(name => [name, name]))
      )
    ).toEqual([
      ".build-staging-12",
      ".build-staging-14",
      ".build-staging-abc",
      "lisa",
    ]);
  });
});

describe("publication holds one checkout-wide lock", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  /**
   * Run the publish CLI as the builder does.
   * @param args CLI arguments.
   * @param waitMs How long the child waits for the lock.
   * @returns The completed child-process result.
   */
  function publishCli(args: readonly string[], waitMs: number) {
    return boundedSpawnSync({
      label: "publish-plugin-tree.mjs",
      command: process.execPath,
      args: [PUBLISH_CLI, ...args],
      baseMs: 15_000,
      cwd: root,
      env: { ...childEnv(), LISA_PLUGIN_PUBLISH_LOCK_WAIT_MS: String(waitMs) },
    });
  }

  it("makes a second publisher wait, then lets it through once released", async () => {
    const plugins = path.join(root, PLUGINS);
    const live = path.join(plugins, "lisa");
    const staged = path.join(plugins, ".build-staging-1", "lisa");
    await writeTree(live, { "hooks/guard.sh": "old" });
    await writeTree(staged, {
      "hooks/guard.sh": "new",
      "hooks/helper.mjs": "helper",
    });

    const blocked = withPublishLock(plugins, () =>
      publishCli([staged, live], 300)
    );
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("has held");
    expect(await readTree(live)).toEqual({ "hooks/guard.sh": "old" });
    expect(await fs.pathExists(path.join(plugins, LOCK_FILE))).toBe(false);

    const released = publishCli([staged, live], 5_000);
    expect(released.status, released.stderr).toBe(0);
    expect(await readTree(live)).toEqual({
      "hooks/guard.sh": "new",
      "hooks/helper.mjs": "helper",
    });
  });

  it("clears a lock whose owner is gone and keeps one whose owner may be running", async () => {
    const plugins = path.join(root, PLUGINS);
    await fs.ensureDir(plugins);
    const lock = path.join(plugins, LOCK_FILE);

    await fs.writeFile(lock, `${exitedPid()}\n`);
    expect(withPublishLock(plugins, () => "ran")).toBe("ran");
    expect(await fs.pathExists(lock)).toBe(false);

    await fs.writeFile(lock, "12\n");
    expect(() =>
      withPublishLock(plugins, () => "ran", {
        waitMs: 100,
        probe: probeFrom({ 12: "EPERM" }),
      })
    ).toThrow("has held");
    expect(await fs.readFile(lock, "utf8")).toBe("12\n");
  });

  it("releases the lock when the publication throws", async () => {
    const plugins = path.join(root, PLUGINS);
    expect(() =>
      withPublishLock(plugins, () => {
        throw new Error("publish failed");
      })
    ).toThrow("publish failed");
    expect(await fs.pathExists(path.join(plugins, LOCK_FILE))).toBe(false);
  });

  it("leaves one complete build when two publish at once", async () => {
    const plugins = path.join(root, PLUGINS);
    const live = path.join(plugins, "lisa");
    const treeA = {
      "hooks/guard.sh": "a",
      "hooks/main.mjs": "import './helper.mjs'",
      "hooks/helper.mjs": "helper",
    };
    const treeB = { "hooks/guard.sh": "b", "hooks/main.mjs": "standalone" };
    await writeTree(live, treeB);
    const stagedA = path.join(plugins, ".build-staging-1", "lisa");
    const stagedB = path.join(plugins, ".build-staging-2", "lisa");
    await writeTree(stagedA, treeA);
    await writeTree(stagedB, treeB);

    const codes = await Promise.all(
      [stagedA, stagedB].map(async staged => {
        const child = spawn(process.execPath, [PUBLISH_CLI, staged, live], {
          cwd: root,
          env: childEnv(),
          stdio: "ignore",
        });
        const [code] = (await once(child, "exit")) as [number | null];
        return code;
      })
    );

    expect(codes).toEqual([0, 0]);
    const published = await readTree(live);
    expect([treeA, treeB].map(tree => sortedKeys(tree))).toContainEqual(
      sortedKeys(published)
    );
    expect(published).toEqual(
      published["hooks/guard.sh"] === "a" ? treeA : treeB
    );
    expect(await fs.pathExists(path.join(plugins, LOCK_FILE))).toBe(false);
  });
});

/**
 * A record's keys, sorted, so trees compare by membership.
 * @param tree Relative path to contents.
 * @returns The sorted paths.
 */
function sortedKeys(tree: Readonly<Record<string, string>>): string[] {
  const keys = Object.keys(tree);
  keys.sort((a, b) => a.localeCompare(b));
  return keys;
}

/**
 * Seed a fixture with the real builder and a base plugin that ships a guard.
 * @param dir Fixture root.
 */
async function seedFixture(dir: string): Promise<void> {
  for (const name of BUILDER_FILES) {
    await fs.copy(
      path.join(REPO_ROOT, SCRIPTS, name),
      path.join(dir, SCRIPTS, name)
    );
  }
  await fs.copy(
    path.join(REPO_ROOT, SCRIPTS, "lib"),
    path.join(dir, SCRIPTS, "lib")
  );
  await fs.writeJson(path.join(dir, "package.json"), {
    name: "plugin-build-guard-availability-fixture",
    version: "9.9.9",
  });
  const base = path.join(dir, PLUGINS, "src", "base");
  await fs.outputJson(path.join(base, ".claude-plugin", "plugin.json"), {
    name: "lisa-fixture",
    version: "0.0.0",
    description: "Fixture plugin",
  });
  await fs.copy(
    path.join(REPO_ROOT, PLUGINS, "src", "base", "hooks", GUARD),
    path.join(base, "hooks", GUARD)
  );
  await fs.outputFile(
    path.join(base, "skills", "existing", "SKILL.md"),
    "---\nname: existing\ndescription: Existing fixture skill\n---\n\n# existing\n"
  );
}

/**
 * Every hook file of every built plugin tree, with the bytes it holds now.
 * @param dir Fixture root.
 * @returns Absolute path and contents of each hook file.
 */
async function hookFiles(dir: string): Promise<Array<[string, Buffer]>> {
  const pluginsDir = path.join(dir, PLUGINS);
  const trees = (await fs.readdir(pluginsDir)).filter(name =>
    name.startsWith("lisa")
  );
  const files: Array<[string, Buffer]> = [];
  for (const tree of trees) {
    const hooksDir = path.join(pluginsDir, tree, "hooks");
    if (!(await fs.pathExists(hooksDir))) continue;
    for (const name of await fs.readdir(hooksDir)) {
      const file = path.join(hooksDir, name);
      if ((await fs.stat(file)).isFile()) {
        files.push([file, await fs.readFile(file)]);
      }
    }
  }
  return files;
}

/**
 * Read a file, treating absence as a value rather than an error.
 * @param file Path to read.
 * @returns The file's bytes, or null when it is absent.
 */
function readOrNull(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/**
 * The environment the builder runs with, free of any parent git hook state.
 * @returns Environment variables for the child.
 */
function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
}

/**
 * Run the real builder to completion.
 * @param dir Fixture root.
 * @returns The completed child-process result.
 */
function buildSync(dir: string): ReturnType<typeof boundedSpawnSync> {
  return boundedSpawnSync({
    label: BUILDER,
    command: "bash",
    args: [BUILD_SCRIPT],
    baseMs: BUILD_BASE_MS,
    cwd: dir,
    env: childEnv(),
  });
}

/**
 * Run the real builder without blocking the event loop, so the sampler runs.
 * @param dir Fixture root.
 * @returns The builder's exit code, or null when it was killed at its deadline.
 */
async function buildAsync(dir: string): Promise<number | null> {
  const child = spawn("bash", [BUILD_SCRIPT], {
    cwd: dir,
    env: childEnv(),
    stdio: "ignore",
  });
  const deadline = setTimeout(
    () => child.kill("SIGKILL"),
    ioLatencyBudgetMs(BUILD_BASE_MS)
  );
  try {
    const [code] = (await once(child, "exit")) as [number | null];
    return code;
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Write a tree of text files.
 * @param dir Root to write under.
 * @param files Relative path to contents.
 */
async function writeTree(
  dir: string,
  files: Readonly<Record<string, string>>
): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    await fs.outputFile(path.join(dir, relative), contents);
  }
}

/**
 * Read every file of a tree back as text, keyed by its relative path.
 * @param dir Root to read.
 * @returns Relative path to contents, sorted by path.
 */
async function readTree(dir: string): Promise<Record<string, string>> {
  const entries: Array<[string, string]> = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        entries.push([
          path.relative(dir, full).split(path.sep).join("/"),
          await fs.readFile(full, "utf8"),
        ]);
      }
    }
  };
  await walk(dir);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}
