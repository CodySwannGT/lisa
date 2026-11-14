/**
 * The build-once marker (CodySwannGT/lisa#4595): what makes it match, what
 * invalidates it, and what the up-front build step records.
 *
 * Every invalidation is pinned separately — tree, lockfile, node, bun — because
 * a marker that ignored any one of them would let a later step skip a build
 * whose inputs changed, which is the stale-`dist/` defect of #3778.
 * @module tests/unit/scripts/build-marker
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BUILD_MARKER_ENV,
  BUILD_MARKER_PATH,
  BUILD_MARKER_SCHEMA,
  buildOnceEnabled,
  checkBuildMarker,
  markerMatches,
  pluginsClean,
  runBuildOnce,
  workingTreeHash,
} from "../../../all/copy-overwrite/scripts/lib/build-marker.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../../support/git-executable.js";

const TREE = "a".repeat(40);
const OTHER_TREE = "b".repeat(40);
const LOCK = { file: "bun.lock", sha256: "c".repeat(64) };
const ON = { pushGate: { buildOnce: true } };
const RUNNER = "bun run";
const SCRIPTS = { build: "tsc" };

const roots: string[] = [];

/**
 * A fresh directory removed after the test.
 * @returns Absolute path
 */
function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-build-marker-test-"));
  roots.push(root);
  return root;
}

/**
 * Run the pinned git in a fixture, never inheriting a hook's repository.
 * @param cwd - Fixture root
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, ...args: string[]): string {
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""} (build-marker fixture)`,
    command: GIT_BIN,
    args,
    cwd,
    env: cleanGitEnv(),
  }).trim();
}

/**
 * A git repository with one committed file.
 * @returns Absolute path of the repository
 */
function repo(): string {
  const root = scratch();
  const run = (...args: string[]): void => {
    git(root, ...args);
  };
  run("init", "-q");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  writeFileSync(path.join(root, "a.txt"), "one\n");
  run("add", "-A");
  run("commit", "-q", "-m", "init");
  return root;
}

/**
 * A marker for the given tree and toolchain.
 * @param overrides - Fields to replace
 * @returns Marker object
 */
function marker(overrides: Record<string, unknown> = {}): object {
  return {
    schema: BUILD_MARKER_SCHEMA,
    tree: TREE,
    builtTree: TREE,
    lockfile: LOCK,
    node: "22.0.0",
    bun: "1.2.0",
    pluginsCleanBeforeBuild: true,
    ...overrides,
  };
}

const CURRENT = { tree: TREE, lockfile: LOCK, node: "22.0.0", bun: "1.2.0" };

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("buildOnceEnabled", () => {
  it("is off when pushGate is absent or says nothing", () => {
    expect(buildOnceEnabled(undefined)).toBe(false);
    expect(buildOnceEnabled({})).toBe(false);
    expect(buildOnceEnabled({ pushGate: {} })).toBe(false);
  });

  it("follows an explicit boolean", () => {
    expect(buildOnceEnabled(ON)).toBe(true);
    expect(buildOnceEnabled({ pushGate: { buildOnce: false } })).toBe(false);
  });

  it("refuses a value that is not a boolean rather than guessing", () => {
    expect(() => buildOnceEnabled({ pushGate: { buildOnce: "yes" } })).toThrow(
      /pushGate\.buildOnce/u
    );
    expect(() => buildOnceEnabled({ pushGate: true })).toThrow(/pushGate/u);
  });
});

describe("markerMatches", () => {
  it("matches when tree, lockfile and tool versions all agree", () => {
    const decision = markerMatches(marker(), CURRENT);
    expect(decision).toEqual({
      match: true,
      reason: `marker matches tree ${TREE}`,
    });
  });

  it("a different tree invalidates", () => {
    expect(
      markerMatches(marker(), { ...CURRENT, tree: OTHER_TREE }).match
    ).toBe(false);
  });

  it("compares against the tree the build LEFT, not the one it started from", () => {
    const regenerated = marker({ tree: OTHER_TREE, builtTree: TREE });
    expect(markerMatches(regenerated, CURRENT).match).toBe(true);
    const reverted = marker({ tree: TREE, builtTree: OTHER_TREE });
    expect(markerMatches(reverted, CURRENT).match).toBe(false);
  });

  it("a changed lockfile invalidates", () => {
    const current = {
      ...CURRENT,
      lockfile: { ...LOCK, sha256: "d".repeat(64) },
    };
    expect(markerMatches(marker(), current)).toEqual({
      match: false,
      reason: "lockfile changed",
    });
  });

  it("a different node invalidates", () => {
    expect(markerMatches(marker(), { ...CURRENT, node: "24.0.0" }).match).toBe(
      false
    );
  });

  it("a different bun invalidates", () => {
    expect(markerMatches(marker(), { ...CURRENT, bun: "1.3.0" }).match).toBe(
      false
    );
  });

  it("an unknown tree, a missing marker or a foreign schema never matches", () => {
    expect(markerMatches(marker(), { ...CURRENT, tree: null }).match).toBe(
      false
    );
    expect(markerMatches(null, CURRENT).match).toBe(false);
    expect(markerMatches(marker({ schema: "other/v1" }), CURRENT).match).toBe(
      false
    );
  });
});

describe("checkBuildMarker", () => {
  it("does not match when the variable is unset", () => {
    const decision = checkBuildMarker({
      cwd: scratch(),
      env: {},
      fingerprint: () => CURRENT,
    });
    expect(decision.match).toBe(false);
    expect(decision.reason).toMatch(new RegExp(BUILD_MARKER_ENV, "u"));
  });

  it("reads the named marker and matches it against the fingerprint", () => {
    const root = scratch();
    const file = path.join(root, "marker.json");
    writeFileSync(file, JSON.stringify(marker()));
    const env = { [BUILD_MARKER_ENV]: file };
    expect(
      checkBuildMarker({ cwd: root, env, fingerprint: () => CURRENT }).match
    ).toBe(true);
  });
});

describe("workingTreeHash", () => {
  it("equals HEAD's tree when clean and changes with an edit or a new file", () => {
    const root = repo();
    const head = git(root, "rev-parse", "HEAD^{tree}");
    expect(workingTreeHash(root)).toBe(head);
    writeFileSync(path.join(root, "a.txt"), "two\n");
    const edited = workingTreeHash(root);
    expect(edited).not.toBe(head);
    writeFileSync(path.join(root, "b.txt"), "new\n");
    expect(workingTreeHash(root)).not.toBe(edited);
  });

  it("leaves the real index untouched", () => {
    const root = repo();
    writeFileSync(path.join(root, "b.txt"), "new\n");
    workingTreeHash(root);
    expect(git(root, "status", "--porcelain")).toBe("?? b.txt");
  });
});

describe("pluginsClean", () => {
  it("reports dirt under plugins/ and under a materialized path", () => {
    const root = repo();
    expect(pluginsClean(root)).toBe(true);
    writeFileSync(path.join(root, "out.txt"), "x\n");
    git(root, "add", "out.txt");
    git(root, "commit", "-q", "-m", "out");
    mkdirSync(path.join(root, "plugins"));
    writeFileSync(
      path.join(root, "plugins", "materialized-artifacts.json"),
      JSON.stringify(["out.txt"])
    );
    expect(pluginsClean(root)).toBe(false);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "manifest");
    expect(pluginsClean(root)).toBe(true);
    writeFileSync(path.join(root, "out.txt"), "edited\n");
    expect(pluginsClean(root)).toBe(false);
  });
});

describe("runBuildOnce", () => {
  /**
   * Run the step with a recording executor.
   * @param overrides - Option overrides
   * @returns The entry, the commands run, the env and the root
   */
  function run(overrides: Record<string, unknown> = {}) {
    const root = scratch();
    const commands: string[] = [];
    const env: Record<string, string | undefined> = {};
    let clock = 1_000;
    const entry = runBuildOnce({
      config: ON,
      runner: RUNNER,
      scripts: SCRIPTS,
      exec: (command: string) => {
        commands.push(command);
        return { code: 0 };
      },
      cwd: root,
      env,
      fingerprint: () => CURRENT,
      isPluginsClean: () => true,
      now: () => (clock += 500),
      ...overrides,
    });
    return { entry, commands, env, root };
  }

  it("does nothing when the switch is off, so the push builds as before", () => {
    const { entry, commands, env } = run({ config: {} });
    expect(entry).toBeNull();
    expect(commands).toEqual([]);
    expect(env[BUILD_MARKER_ENV]).toBeUndefined();
  });

  it("does nothing for a project without a build script", () => {
    expect(run({ scripts: {} }).entry).toBeNull();
  });

  it("builds once, writes the marker and exports its path", () => {
    const { entry, commands, env, root } = run();
    expect(commands).toEqual(["bun run build"]);
    const markerPath = path.join(root, BUILD_MARKER_PATH);
    expect(env[BUILD_MARKER_ENV]).toBe(markerPath);
    const written = JSON.parse(readFileSync(markerPath, "utf8"));
    expect(written).toMatchObject({
      schema: BUILD_MARKER_SCHEMA,
      tree: TREE,
      builtTree: TREE,
      lockfile: LOCK,
      pluginsCleanBeforeBuild: true,
    });
    expect(entry).toMatchObject({
      id: "build-once",
      state: "passed",
      code: 0,
      durationMs: 500,
      command: "bun run build",
    });
  });

  it("records dirty plugins before the build", () => {
    const { root } = run({ isPluginsClean: () => false });
    const written = JSON.parse(
      readFileSync(path.join(root, BUILD_MARKER_PATH), "utf8")
    );
    expect(written.pluginsCleanBeforeBuild).toBe(false);
  });

  it("a failing build reports failed and leaves no marker behind", () => {
    const { entry, env, root } = run({ exec: () => ({ code: 2 }) });
    expect(entry).toMatchObject({ state: "failed", code: 2 });
    expect(env[BUILD_MARKER_ENV]).toBeUndefined();
    expect(existsSync(path.join(root, BUILD_MARKER_PATH))).toBe(false);
  });
});
