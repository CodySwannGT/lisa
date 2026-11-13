/**
 * `lisa check`, then the push, end to end through the real gate runner
 * (CodySwannGT/lisa#4601).
 *
 * A throwaway repository declares two push gates whose package scripts count
 * their own executions in a file outside the tree: one cacheable, one marked
 * `"cache": false`. `runCheck` runs the real `lisa-run-gates.mjs` that Lisa
 * ships (the fixture carries no copy of its own), and the following "push" is
 * that same runner invoked exactly as the pre-push hook invokes it. The counts
 * say what actually executed.
 * @module tests/integration/lisa-check-then-push
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ownerMarkerFor } from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep-processes.mjs";
import { runCheck, type RunnerRequest } from "../../src/cli/check-cmd.js";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const RUNNER = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-run-gates.mjs"
);
const roots: string[] = [];

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
 * Run git in a fixture with a fixed identity and no outer git state.
 * @param cwd - Repository directory
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, ...args: string[]): string {
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""} (lisa check fixture)`,
    command: GIT_BIN,
    args,
    cwd,
    env: {
      ...cleanGitEnv(),
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();
}

/**
 * A committed project with two counting push gates and the cache switched on.
 * @param pushGate - The `pushGate` block, or null to omit it
 * @returns Paths the test reads back
 */
function project(pushGate: object | null = { cache: true }) {
  const cwd = scratch("lisa-check-push-");
  const outside = scratch("lisa-check-state-");
  const config = {
    ...(pushGate ? { pushGate } : {}),
    gates: {
      runner: "npm run",
      "x-alpha": { push: { level: "required", run: "alpha" } },
      "x-beta": { push: { level: "required", run: "beta", cache: false } },
    },
  };
  git(cwd, "init", "-q");
  writeFileSync(
    path.join(cwd, ".lisa.config.json"),
    `${JSON.stringify(config)}\n`
  );
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
  // The shipped gitignore keeps the timing report out of the tree; without the
  // same entry the report `lisa check` writes would dirty the tree it proved.
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
 * The environment both `lisa check` and the push see.
 * @param p - The project
 * @returns Environment without CI markers or an inherited cache switch
 */
function baseEnv(p: Project): NodeJS.ProcessEnv {
  const {
    CI: _ci,
    GITHUB_ACTIONS: _gha,
    LISA_GATE_CACHE: _off,
    LISA_ADMISSION_MAX_WAIT: _wait,
    ...rest
  } = cleanGitEnv();
  return {
    ...rest,
    XDG_CACHE_HOME: p.cacheHome,
    COUNT_FILE: p.countFile,
    FAIL_FILE: p.failFile,
    LISA_CLEANUP_SWEPT: ownerMarkerFor(process.pid),
  };
}

/**
 * Run `lisa check` in the fixture with the real runner Lisa ships.
 * @param p - The project
 * @returns Exit code and everything printed
 */
async function check(p: Project): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const code = await runCheck(
    {},
    {
      cwd: p.cwd,
      env: baseEnv(p),
      lisaRoot: REPO_ROOT,
      log: line => lines.push(line),
      error: line => lines.push(line),
      git: (args, cwd) => {
        try {
          return git(cwd, ...args);
        } catch {
          return null;
        }
      },
      runRunner: (request: RunnerRequest) => {
        const child = boundedSpawnSync({
          label: "lisa check → lisa-run-gates.mjs --moment=push",
          command: process.execPath,
          args: [request.runner, ...request.args],
          cwd: request.cwd,
          env: request.env,
        });
        lines.push(child.stdout, child.stderr);
        return child.status;
      },
    }
  );
  return { code, output: lines.join("\n") };
}

/**
 * Write the pushed-refs file the pre-push hook exports, naming HEAD.
 * @param p - The project
 * @returns The file written
 */
function writePushedRefs(p: Project): string {
  const head = git(p.cwd, "rev-parse", "HEAD");
  writeFileSync(
    p.refsFile,
    `refs/heads/feature ${head} refs/heads/feature ${"0".repeat(40)}\n`
  );
  return p.refsFile;
}

/**
 * Run the real push gates once, exactly as the pre-push hook does.
 * @param p - The project
 * @returns Exit status and combined output
 */
function push(p: Project): { status: number | null; output: string } {
  const refsFile = writePushedRefs(p);
  const child = boundedSpawnSync({
    label: "lisa-run-gates.mjs --moment=push (after lisa check)",
    command: process.execPath,
    args: [RUNNER, "--moment=push", `--coverage=${p.coverage}`],
    cwd: p.cwd,
    env: { ...baseEnv(p), LISA_PUSHED_REFS_FILE: refsFile },
  });
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

/**
 * Passes recorded in the fixture's cache.
 * @param p - The project
 * @returns Number of recorded passes
 */
function recordedPasses(p: Project): number {
  const dir = path.join(p.cacheHome, "lisa", "gate-passes");
  return existsSync(dir)
    ? readdirSync(dir).filter(name => name.endsWith(".json")).length
    : 0;
}

afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("lisa check, then git push", () => {
  it("lets the following push report every cacheable gate as CACHED PASS", async () => {
    const p = project();
    const checked = await check(p);
    expect(checked.code, checked.output).toBe(0);
    expect(counts(p)).toEqual({ alpha: 1, beta: 1 });
    expect(recordedPasses(p)).toBe(1);

    const pushed = push(p);
    expect(pushed.status, pushed.output).toBe(0);
    expect(pushed.output).toMatch(/CACHED PASS \([0-9a-f]{12}\)/u);
    // alpha was not re-run; beta opted out of the cache and always runs.
    expect(counts(p)).toEqual({ alpha: 1, beta: 2 });
  });

  it("re-runs the gates whose key changed when a new commit is pushed", async () => {
    const p = project();
    expect((await check(p)).code).toBe(0);
    writeFileSync(path.join(p.cwd, "count.mjs"), "// changed\n", {
      flag: "a",
    });
    git(p.cwd, "commit", "-qam", "change after check");
    const pushed = push(p);
    expect(pushed.status, pushed.output).toBe(0);
    expect(pushed.output).not.toMatch(/CACHED PASS/u);
    expect(counts(p)).toEqual({ alpha: 2, beta: 2 });
  });

  it("refuses a dirty tree, says to commit first, and records nothing", async () => {
    const p = project();
    writeFileSync(path.join(p.cwd, "scratch.txt"), "uncommitted\n");
    const checked = await check(p);
    expect(checked.code).toBe(1);
    expect(checked.output).toMatch(/Commit first/u);
    expect(counts(p)).toEqual({});
    expect(existsSync(p.cacheHome)).toBe(false);
  });

  it("blocks and prints the failing gate when a required gate fails", async () => {
    const p = project();
    writeFileSync(p.failFile, "");
    const checked = await check(p);
    expect(checked.code).toBe(1);
    // An unrecognised exit reads as NOT PROVED rather than FAILED; either way
    // the line names the gate.
    expect(checked.output).toMatch(/(?:FAILED|NOT PROVED): x-alpha/u);
    expect(recordedPasses(p)).toBe(0);
  });

  it("exits 0 at once and runs nothing when the project never set pushGate.cache", async () => {
    const p = project(null);
    const checked = await check(p);
    expect(checked.code).toBe(0);
    expect(checked.output).toContain(
      "gate pass cache is off for this project; push directly (the push runs every gate)"
    );
    expect(counts(p)).toEqual({});
  });
});
