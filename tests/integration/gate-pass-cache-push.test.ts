/**
 * The push-gate pass cache, end to end through the real gate runner
 * (CodySwannGT/lisa#4594).
 *
 * A throwaway repository declares two push gates whose package scripts count
 * their own executions in a file outside the tree: one cacheable, one marked
 * `"cache": false`. The real `lisa-run-gates.mjs --moment=push` then runs
 * against the same tree twice, with the pushed-refs file the pre-push hook
 * exports, and the counts say what actually executed.
 * @module tests/integration/gate-pass-cache-push
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ownerMarkerFor } from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep-processes.mjs";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../helpers/io-latency-budget.js";
import { resolveGit } from "../support/git-executable.js";

const RUNNER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../all/copy-overwrite/scripts/lisa-run-gates.mjs"
);
const ALPHA = "x-alpha";
const BETA = "x-beta";
const CONFIG = ".lisa.config.json";
const roots: string[] = [];
/** Pinned git binary, so the fixture never resolves `git` through $PATH. */
const GIT_BIN = resolveGit();

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
 * Run git with a fixed identity.
 * @param cwd - Repository directory
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, ...args: string[]): string {
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""} (gate-pass-cache push fixture)`,
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
 * A committed project with two counting push gates.
 * @param pushGate - The `pushGate` block, or null to omit it
 * @returns Paths the test reads back
 */
function project(pushGate: object | null = { cache: true }) {
  const cwd = scratch("lisa-gate-cache-push-");
  const outside = scratch("lisa-gate-cache-state-");
  const config = {
    ...(pushGate ? { pushGate } : {}),
    gates: {
      runner: "npm run",
      [ALPHA]: { push: { level: "required", run: "alpha" } },
      [BETA]: { push: { level: "required", run: "beta", cache: false } },
    },
  };
  git(cwd, "init", "-q");
  writeFileSync(path.join(cwd, CONFIG), `${JSON.stringify(config)}\n`);
  writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture",
      private: true,
      scripts: { alpha: "node count.mjs alpha", beta: "node count.mjs beta" },
    })
  );
  writeFileSync(
    path.join(cwd, "count.mjs"),
    [
      'import { appendFileSync, existsSync } from "node:fs";',
      "appendFileSync(process.env.COUNT_FILE, process.argv[2] + '\\n');",
      "if (existsSync(process.env.FAIL_FILE)) process.exit(1);",
      "",
    ].join("\n")
  );
  // Every push writes a timing report under `.lisa/push-timing/`. A Lisa host
  // ignores it through the shipped gitignore; without the same entry here the
  // report from the first push would make the second one look dirty.
  writeFileSync(path.join(cwd, ".gitignore"), ".lisa/push-timing/\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-q", "-m", "init");
  return {
    cwd,
    cacheHome: path.join(outside, "cache"),
    countFile: path.join(outside, "count"),
    failFile: path.join(outside, "fail"),
    refsFile: path.join(outside, "refs"),
    coverage: path.join(outside, "coverage"),
  };
}

/** The paths one fixture project exposes to the test. */
type Project = ReturnType<typeof project>;

/**
 * Write the pushed-refs file the pre-push hook exports, naming HEAD.
 * @param p - The project
 */
function writePushedRefs(p: Project): void {
  const head = git(p.cwd, "rev-parse", "HEAD");
  writeFileSync(
    p.refsFile,
    `refs/heads/feature ${head} refs/heads/feature ${"0".repeat(40)}\n`
  );
}

/**
 * Run the real push gates once, as the pre-push hook would.
 * @param p - The project
 * @param env - Extra environment
 * @returns Exit status and combined output
 */
function push(p: Project, env: Record<string, string> = {}) {
  const {
    CI: _ci,
    GITHUB_ACTIONS: _gha,
    LISA_GATE_CACHE: _off,
    ...base
  } = process.env;
  writePushedRefs(p);
  return toResult(
    boundedSpawnSync({
      label: "lisa-run-gates.mjs --moment=push",
      command: process.execPath,
      args: [RUNNER, "--moment=push", `--coverage=${p.coverage}`],
      cwd: p.cwd,
      env: {
        ...base,
        XDG_CACHE_HOME: p.cacheHome,
        COUNT_FILE: p.countFile,
        FAIL_FILE: p.failFile,
        LISA_PUSHED_REFS_FILE: p.refsFile,
        LISA_CLEANUP_SWEPT: ownerMarkerFor(process.pid),
        ...env,
      },
    })
  );
}

/**
 * Exit status and combined output of a finished child.
 * @param child - The finished child
 * @param child.status - Its exit status
 * @param child.stdout - Its stdout
 * @param child.stderr - Its stderr
 * @returns Status and output
 */
function toResult(child: {
  status: number | null;
  stdout: string;
  stderr: string;
}) {
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
}

/**
 * How many times each gate's script executed so far.
 * @param p - The project
 * @returns Executions per script name
 */
function counts(p: Project): Record<string, number> {
  if (!existsSync(p.countFile)) return {};
  return readFileSync(p.countFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .reduce<Record<string, number>>(
      (acc, name) => ({ ...acc, [name]: (acc[name] ?? 0) + 1 }),
      {}
    );
}

afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("push-gate pass cache through the real runner", () => {
  it("skips a cacheable gate on an identical-tree re-push", () => {
    const p = project();
    const first = push(p);
    expect(first.status).toBe(0);
    expect(counts(p)).toEqual({ alpha: 1, beta: 1 });

    const second = push(p);
    expect(second.status).toBe(0);
    expect(second.output).toMatch(/CACHED PASS \([0-9a-f]{12}\)/);
    expect(counts(p)).toEqual({ alpha: 1, beta: 2 });

    writeFileSync(path.join(p.cwd, "count.mjs"), "// changed\n", {
      flag: "a",
    });
    git(p.cwd, "commit", "-qam", "change one byte");
    expect(push(p).output).not.toMatch(/CACHED PASS/);
    expect(counts(p)).toEqual({ alpha: 2, beta: 3 });
  });

  it("never serves a failure from the cache", () => {
    const p = project();
    writeFileSync(p.failFile, "");
    expect(push(p).status).toBe(1);
    expect(push(p).status).toBe(1);
    expect(counts(p)).toEqual({ alpha: 2, beta: 2 });
  });

  it("neither reads nor writes the cache from a dirty tree", () => {
    const p = project();
    writeFileSync(path.join(p.cwd, "scratch.txt"), "uncommitted\n");
    const run = push(p);
    expect(run.output).toMatch(
      /cache skipped: the working tree differs from the pushed commit/
    );
    expect(existsSync(p.cacheHome)).toBe(false);
  });

  it.each([
    [{ CI: "true" }, /CI never reads or writes the cache/],
    [{ LISA_GATE_CACHE: "off" }, /the cache is off \(LISA_GATE_CACHE=off\)/],
  ])("runs every gate with %j", (env, message) => {
    const p = project();
    push(p);
    const run = push(p, env);
    expect(run.output).toMatch(message);
    expect(run.output).not.toMatch(/CACHED PASS/);
    expect(counts(p)).toEqual({ alpha: 2, beta: 2 });
  });

  it("leaves a project that never set pushGate.cache untouched", () => {
    const p = project(null);
    push(p);
    const run = push(p);
    expect(run.output).not.toMatch(/cache/i);
    expect(counts(p)).toEqual({ alpha: 2, beta: 2 });
    expect(existsSync(p.cacheHome)).toBe(false);
  });
});
