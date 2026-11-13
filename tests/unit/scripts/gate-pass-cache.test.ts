/**
 * Tests for the push-gate pass cache (CodySwannGT/lisa#4594).
 *
 * The cache may only ever report a pass for the exact tree, lockfiles, tools,
 * config and allowlisted environment that produced it, so most of these cases
 * are about when it must REFUSE: a key input changed, the tree is dirty, the
 * run is in CI, the operator switched it off, or the project never opted in.
 * @module tests/unit/scripts/gate-pass-cache
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  cacheSetting,
  gateKey,
  MAX_AGE_MS,
  openGatePassCache,
  provedTree,
  relevantEnvironment,
  sharedInputs,
} from "../../../all/copy-overwrite/scripts/lib/gate-pass-cache.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const roots: string[] = [];
/** Pinned git binary, so the fixture never resolves `git` through $PATH. */
const GIT_BIN = resolveGit();
const ON = { pushGate: { cache: true } };
const LINT = { id: "code-style-slow", command: "bun run lint:slow" };
const PUSH = "push";
const BUN = (): string => "1.3.0";
const CONFIG_FILE = ".lisa.config.json";

/**
 * A fresh directory removed after the test.
 * @param prefix - Directory name prefix
 * @returns Absolute path
 */
function scratch(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/**
 * Run git in a repository with a fixed identity.
 * @param cwd - Repository directory
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, ...args: string[]): string {
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""} (gate-pass-cache fixture)`,
    command: GIT_BIN,
    args,
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();
}

/**
 * A committed repository with a Lisa config that opts into the cache.
 * @returns The repository and a private cache home
 */
function repo(): { cwd: string; cacheHome: string } {
  const cwd = scratch("lisa-gate-cache-repo-");
  git(cwd, "init", "-q");
  writeFileSync(
    path.join(cwd, CONFIG_FILE),
    JSON.stringify({
      ...ON,
      gates: { "code-style-slow": { push: "required" } },
    })
  );
  writeFileSync(path.join(cwd, "bun.lock"), "lock-v1\n");
  writeFileSync(path.join(cwd, "a.txt"), "a\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", "init");
  return { cwd, cacheHome: scratch("lisa-gate-cache-home-") };
}

/**
 * Open the cache over a repository with the given environment.
 * @param cwd - Repository directory
 * @param env - Environment
 * @param extra - Overrides for the options
 * @returns The cache (or null) and its printed lines
 */
function open(
  cwd: string,
  env: Record<string, string>,
  extra: Record<string, unknown> = {}
) {
  const lines: string[] = [];
  const cache = openGatePassCache({
    config: ON,
    gates: {},
    moment: PUSH,
    out: (line: string) => lines.push(line),
    cwd,
    env,
    bunVersion: BUN,
    ...extra,
  });
  return { cache, lines };
}

afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("key derivation", () => {
  const base = {
    tree: "t1",
    moment: PUSH,
    gate: LINT.id,
    command: LINT.command,
    lockfiles: { "bun.lock": "l1" },
    tools: { node: "22", bun: "1.3" },
    gatesConfig: { project: { a: 1 }, local: null },
    environment: { TZ: "UTC" },
  };

  it.each([
    ["tree", { tree: "t2" }],
    ["gate id", { gate: "dead-code" }],
    ["command", { command: "bun run lint" }],
    ["lockfile", { lockfiles: { "bun.lock": "l2" } }],
    ["node version", { tools: { node: "24", bun: "1.3" } }],
    ["bun version", { tools: { node: "22", bun: "1.4" } }],
    ["gates config", { gatesConfig: { project: { a: 2 }, local: null } }],
    ["local gates config", { gatesConfig: { project: { a: 1 }, local: {} } }],
    ["allowlisted env", { environment: { TZ: "Europe/Paris" } }],
  ])("changes when the %s changes", (_name, change) => {
    expect(gateKey({ ...base, ...change })).not.toBe(gateKey(base));
  });

  it("does not depend on key order", () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse());
    expect(gateKey(reordered)).toBe(gateKey(base));
  });

  it("keeps allowlisted and LISA_* variables and drops the rest", () => {
    expect(
      relevantEnvironment({
        TZ: "UTC",
        NODE_OPTIONS: "--x",
        NODE_ENV: "test",
        LISA_COVERAGE_SCOPE: "unit",
        LISA_GATE_CACHE: "on",
        LISA_PUSHED_REFS_FILE: "pushed-refs.abc",
        LISA_CLEANUP_SWEPT: "123:456",
        // `lisa check` sets the admission wait bound and a push does not
        // (CodySwannGT/lisa#4601); a wait bound never changes a verdict.
        LISA_ADMISSION_MAX_WAIT: "30m",
        LISA_ADMISSION_PUSH_MAX_WAIT: "5m",
        HOME: "/home/x",
        PATH: "/bin",
        TERM: "xterm",
      })
    ).toEqual({
      LISA_COVERAGE_SCOPE: "unit",
      NODE_ENV: "test",
      NODE_OPTIONS: "--x",
      TZ: "UTC",
    });
  });

  it("hashes the lockfiles present and reads both config files", () => {
    const { cwd } = repo();
    writeFileSync(
      path.join(cwd, ".lisa.config.local.json"),
      JSON.stringify({ gates: { x: 1 } })
    );
    const inputs = sharedInputs(cwd, {}, BUN);
    expect(Object.keys(inputs.lockfiles)).toEqual(["bun.lock"]);
    expect(inputs.gatesConfig.local).toEqual({ x: 1 });
    expect(inputs.tools.bun).toBe("1.3.0");
  });
});

describe("pushGate.cache setting", () => {
  it.each([
    [{}, false, null],
    [{ pushGate: {} }, false, null],
    [{ pushGate: { cache: false } }, false, null],
    [ON, true, null],
  ])("reads %j", (config, enabled, problem) => {
    expect(cacheSetting(config)).toEqual({ enabled, problem });
  });

  it.each([{ pushGate: { cache: "yes" } }, { pushGate: true }])(
    "refuses a malformed declaration %j",
    config => {
      const setting = cacheSetting(config);
      expect(setting.enabled).toBe(false);
      expect(setting.problem).toMatch(/pushGate/);
    }
  );
});

describe("the proved tree", () => {
  it("is HEAD's tree when the working tree is clean", () => {
    const { cwd } = repo();
    expect(provedTree({ cwd, env: {}, git: (a, c) => git(c, ...a) })).toEqual({
      tree: git(cwd, "rev-parse", "HEAD^{tree}"),
    });
  });

  it.each([
    ["a tracked change", "a.txt"],
    ["an untracked file", "new.txt"],
  ])("is refused with %s", (_name, file) => {
    const { cwd, cacheHome } = repo();
    writeFileSync(path.join(cwd, file), "changed\n");
    const { cache, lines } = open(cwd, { XDG_CACHE_HOME: cacheHome });
    expect(cache).toBeNull();
    expect(lines.join("\n")).toMatch(
      /skipped: the working tree differs from the pushed commit/
    );
  });

  it("is refused when a pushed ref's tree is not HEAD's tree", () => {
    const { cwd, cacheHome } = repo();
    const first = git(cwd, "rev-parse", "HEAD");
    writeFileSync(path.join(cwd, "a.txt"), "b\n");
    git(cwd, "commit", "-qam", "two");
    const refs = path.join(scratch("lisa-gate-cache-refs-"), "refs");
    writeFileSync(
      refs,
      `refs/heads/x ${first} refs/heads/x ${"0".repeat(40)}\n`
    );
    const { cache, lines } = open(cwd, {
      XDG_CACHE_HOME: cacheHome,
      LISA_PUSHED_REFS_FILE: refs,
    });
    expect(cache).toBeNull();
    expect(lines.join("\n")).toMatch(/a pushed ref's tree is not HEAD's tree/);
  });

  it("ignores deletions in the pushed refs", () => {
    const { cwd, cacheHome } = repo();
    const head = git(cwd, "rev-parse", "HEAD");
    const refs = path.join(scratch("lisa-gate-cache-refs-"), "refs");
    writeFileSync(
      refs,
      `refs/heads/x ${head} refs/heads/x ${"0".repeat(40)}\n` +
        `(delete) ${"0".repeat(40)} refs/heads/y ${head}\n`
    );
    const { cache } = open(cwd, {
      XDG_CACHE_HOME: cacheHome,
      LISA_PUSHED_REFS_FILE: refs,
    });
    expect(cache).not.toBeNull();
  });
});

describe("lookup and record", () => {
  it("serves a recorded pass and refuses a gate marked cache:false", () => {
    const { cwd, cacheHome } = repo();
    const env = { XDG_CACHE_HOME: cacheHome };
    const first = open(cwd, env).cache;
    expect(first?.lookup(LINT)).toBeNull();
    first?.remember(LINT, 1200);
    first?.commit();
    expect(open(cwd, env).cache?.lookup(LINT)?.key).toMatch(/^[0-9a-f]{64}$/);

    const optedOut = open(cwd, env, {
      gates: { [LINT.id]: { push: { level: "required", cache: false } } },
    }).cache;
    expect(optedOut?.lookup(LINT)).toBeNull();
    optedOut?.remember(LINT, 1);
  });

  it("misses after a tracked file changes and is committed", () => {
    const { cwd, cacheHome } = repo();
    const env = { XDG_CACHE_HOME: cacheHome };
    const first = open(cwd, env).cache;
    first?.remember(LINT, 1);
    first?.commit();
    writeFileSync(path.join(cwd, "a.txt"), "changed\n");
    git(cwd, "commit", "-qam", "change");
    expect(open(cwd, env).cache?.lookup(LINT)).toBeNull();
  });

  it("misses when an allowlisted variable changes", () => {
    const { cwd, cacheHome } = repo();
    const first = open(cwd, { XDG_CACHE_HOME: cacheHome, TZ: "UTC" }).cache;
    first?.remember(LINT, 1);
    first?.commit();
    expect(
      open(cwd, { XDG_CACHE_HOME: cacheHome, TZ: "Asia/Tokyo" }).cache?.lookup(
        LINT
      )
    ).toBeNull();
    expect(
      open(cwd, {
        XDG_CACHE_HOME: cacheHome,
        TZ: "UTC",
        TERM: "dumb",
      }).cache?.lookup(LINT)
    ).not.toBeNull();
  });

  it("records nothing when the tree changed during the run", () => {
    const { cwd, cacheHome } = repo();
    const { cache, lines } = open(cwd, { XDG_CACHE_HOME: cacheHome });
    cache?.remember(LINT, 1);
    writeFileSync(path.join(cwd, "a.txt"), "rewritten by a gate\n");
    cache?.commit();
    expect(lines.join("\n")).toMatch(/not recorded: the working tree changed/);
    expect(existsSync(path.join(cacheHome, "lisa", "gate-passes"))).toBe(false);
  });

  it("ignores and prunes entries older than 30 days", () => {
    const { cwd, cacheHome } = repo();
    const env = { XDG_CACHE_HOME: cacheHome };
    const start = Date.now();
    const first = open(cwd, env, { now: () => start }).cache;
    first?.remember(LINT, 1);
    first?.commit();
    const later = () => start + MAX_AGE_MS + 1000;
    expect(open(cwd, env, { now: later }).cache?.lookup(LINT)).toBeNull();

    const dir = path.join(cacheHome, "lisa", "gate-passes");
    const old = (start - MAX_AGE_MS - 1000) / 1000;
    for (const name of readdirSync(dir))
      utimesSync(path.join(dir, name), old, old);
    const second = open(cwd, env).cache;
    second?.remember({ id: "dead-code", command: "bun run knip" }, 1);
    second?.commit();
    expect(readdirSync(dir)).toHaveLength(1);
  });
});

describe("refusals before anything is read", () => {
  it("stays silent and writes nothing when the project never opted in", () => {
    const { cwd, cacheHome } = repo();
    const { cache, lines } = open(
      cwd,
      { XDG_CACHE_HOME: cacheHome },
      { config: {} }
    );
    expect(cache).toBeNull();
    expect(lines).toEqual([]);
  });

  it.each([
    [{ CI: "true" }, /CI never reads or writes/],
    [{ GITHUB_ACTIONS: "true" }, /CI never reads or writes/],
    [{ LISA_GATE_CACHE: "off" }, /the cache is off \(LISA_GATE_CACHE=off\)/],
  ])("refuses with %j and says why", (env, message) => {
    const { cwd, cacheHome } = repo();
    const { cache, lines } = open(cwd, { XDG_CACHE_HOME: cacheHome, ...env });
    expect(cache).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(message);
  });

  it("refuses a malformed setting and says so", () => {
    const { cwd } = repo();
    const { cache, lines } = open(
      cwd,
      {},
      {
        config: { pushGate: { cache: 1 } },
      }
    );
    expect(cache).toBeNull();
    expect(lines[0]).toMatch(/pushGate.cache is 1/);
  });
});
