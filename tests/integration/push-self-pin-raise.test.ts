/**
 * The deploy-key step pushes the proved raise only onto the commit it was
 * proved against (CodySwannGT/lisa#4951).
 *
 * `scripts/push-self-pin-raise.sh` is the body of the push job's final step.
 * These cases run it for real against a local bare repository standing in for
 * GitHub, with a `git` shim on PATH that fails the first push or fetch the way
 * a network blip does. They prove the three outcomes the step may have:
 * main unchanged → pushed; main moved → refused with nothing pushed and no
 * rebase; transient failures → retried a bounded number of times, then refused.
 * @module tests/integration/push-self-pin-raise
 */
import {
  chmodSync,
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

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

/** The script under test. */
const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "..",
  "scripts",
  "push-self-pin-raise.sh"
);

/** The shell that runs it, as the workflow step does. */
const BASH = "/bin/bash";

/** The version the raise claims to pin. */
const VERSION = "7.0.0";

/** Folders to remove after each case. */
const cleanups: string[] = [];

afterEach(() => {
  cleanups.splice(0).forEach(folder => {
    rmSync(folder, { force: true, recursive: true });
  });
});

/**
 * A git identity and config isolated from the machine running the tests.
 * @param extra - Further variables for this call.
 * @returns The child environment.
 */
function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: tmpdir(),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    ...extra,
  };
}

/**
 * Run git in a folder and return its trimmed standard output.
 * @param cwd - Where to run it.
 * @param args - The git arguments.
 * @returns What git printed.
 */
function git(cwd: string, ...args: string[]): string {
  const finished = boundedSpawnSync({
    label: `git ${args[0] ?? ""} in a push-self-pin-raise fixture`,
    command: "git",
    args,
    cwd,
    env: gitEnv(),
  });
  expect(finished.status, finished.stderr).toBe(0);
  return finished.stdout.trim();
}

/**
 * Commit one file change in a clone.
 * @param cwd - The clone.
 * @param file - The file to write.
 * @param content - Its new content.
 * @returns The new commit's SHA.
 */
function commit(cwd: string, file: string, content: string): string {
  writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", `change ${file}`);
  return git(cwd, "rev-parse", "HEAD");
}

/** A bare "GitHub", a clone holding the raise, and the proved base. */
interface Fixture {
  readonly root: string;
  readonly origin: string;
  readonly ancestor: string;
  readonly work: string;
  readonly base: string;
  readonly raise: string;
}

/**
 * Build a remote whose main is the proved base, and a clone with the raise
 * committed on top of it — the state the workflow step starts in.
 * @returns The fixture.
 */
function fixture(): Fixture {
  const root = tracked(mkdtempSync(path.join(tmpdir(), "push-self-pin-")));
  const origin = bareMain(root);
  const work = cloneOf(root, origin, "work");
  const ancestor = commitAndPush(work, "README.md", "fixture\n");
  const base = commitAndPush(work, "package.json", '{ "pin": "^6.0.0" }\n');
  const raise = commit(work, "package.json", `{ "pin": "^${VERSION}" }\n`);
  return { root, origin, ancestor, work, base, raise };
}

/**
 * Remember a folder for removal after the case.
 * @param folder - The folder.
 * @returns The same folder.
 */
function tracked(folder: string): string {
  cleanups.push(folder);
  return folder;
}

/**
 * A bare repository whose default branch is main, standing in for GitHub.
 * @param root - The fixture root.
 * @returns The bare repository's path.
 */
function bareMain(root: string): string {
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  return origin;
}

/**
 * A clone of the remote, on main.
 * @param root - The fixture root.
 * @param origin - The remote.
 * @param name - The clone's folder name.
 * @returns The clone's path.
 */
function cloneOf(root: string, origin: string, name: string): string {
  const work = path.join(root, name);
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-B", "main");
  return work;
}

/**
 * Commit one file change and push it to the remote's main.
 * @param cwd - The clone.
 * @param file - The file to write.
 * @param content - Its new content.
 * @returns The pushed commit's SHA.
 */
function commitAndPush(cwd: string, file: string, content: string): string {
  const sha = commit(cwd, file, content);
  git(cwd, "push", "-q", "origin", "main");
  return sha;
}

/**
 * Put a `git` on PATH that fails the first call of each named subcommand and
 * logs every subcommand it sees.
 * @param root - The fixture root.
 * @param failFirst - Subcommands whose first call fails, e.g. `["push"]`.
 * @returns The folder to prepend to PATH, and the call log's path.
 */
function flakyGit(
  root: string,
  failFirst: readonly string[]
): { bin: string; log: string } {
  const real = boundedSpawnSync({
    label: "locate the real git",
    command: "/bin/sh",
    args: ["-c", "command -v git"],
  }).stdout.trim();
  const bin = path.join(root, "bin");
  const log = path.join(root, "calls.log");
  const shim = path.join(bin, "git");
  mkdirSync(bin);
  writeFileSync(
    shim,
    [
      "#!/bin/sh",
      'for arg in "$@"; do',
      '  case "$arg" in',
      "    push|fetch)",
      `      echo "$arg" >> "${log}"`,
      `      case " ${failFirst.join(" ")} " in *" $arg "*)`,
      `        if [ ! -e "${root}/failed-$arg" ]; then`,
      `          : > "${root}/failed-$arg"`,
      '          echo "shim: transient $arg failure" >&2',
      "          exit 128",
      "        fi;;",
      "      esac",
      "      break;;",
      "  esac",
      "done",
      `exec "${real}" "$@"`,
      "",
    ].join("\n")
  );
  chmodSync(shim, 0o755);
  return { bin, log };
}

/**
 * Run the push script the way the workflow step does.
 * @param work - The clone holding the raise.
 * @param remote - The remote to push to.
 * @param base - The proved base SHA.
 * @param pathPrefix - A folder to put ahead of PATH, for the git shim.
 * @returns Exit code and everything printed.
 */
function push(
  work: string,
  remote: string,
  base: string,
  pathPrefix?: string
): { code: number | null; output: string } {
  const finished = boundedSpawnSync({
    label: "push-self-pin-raise.sh",
    command: BASH,
    args: [SCRIPT, remote, base, VERSION],
    cwd: work,
    env: gitEnv({
      SELF_PIN_PUSH_RETRY_DELAY: "0",
      PATH: [pathPrefix, process.env.PATH ?? ""].filter(Boolean).join(":"),
    }),
  });
  return { code: finished.status, output: finished.stdout + finished.stderr };
}

/**
 * The remote's main.
 * @param origin - The bare repository.
 * @returns The SHA main points at.
 */
function remoteMain(origin: string): string {
  return git(origin, "rev-parse", "main");
}

/**
 * The push and fetch calls the shim saw, in order.
 * @param log - The shim's call log.
 * @returns The subcommands.
 */
function calls(log: string): readonly string[] {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

describe("the deploy-key step pushes only onto the proved base (#4951)", () => {
  it("pushes the raise when main is still the proved commit", () => {
    const { origin, work, base, raise } = fixture();

    const result = push(work, origin, base);

    expect(result.code, result.output).toBe(0);
    expect(remoteMain(origin)).toBe(raise);
  });

  it("refuses, pushes nothing and never rebases when main moved", () => {
    const { root, origin, work, base } = fixture();
    const other = cloneOf(root, origin, "other");
    const moved = commitAndPush(
      other,
      "src.ts",
      "export const changed = true;\n"
    );
    const shim = flakyGit(root, []);

    const result = push(work, origin, base, shim.bin);

    expect(result.code).toBe(1);
    expect(result.output).toContain(`main moved from ${base} to ${moved}`);
    expect(result.output).toContain("prepare_self_pin_raise recomputes");
    expect(remoteMain(origin)).toBe(moved);
    expect(calls(shim.log)).toEqual(["push", "fetch"]);
    expect(git(work, "rev-parse", "HEAD^")).toBe(base);
  });

  it("refuses to restore a main rolled back to an ancestor of the base", () => {
    const { root, origin, ancestor, work, base } = fixture();
    git(origin, "update-ref", "refs/heads/main", ancestor);
    const shim = flakyGit(root, []);

    const result = push(work, origin, base, shim.bin);

    expect(result.code).toBe(1);
    expect(result.output).toContain(`main moved from ${base} to ${ancestor}`);
    expect(remoteMain(origin)).toBe(ancestor);
    expect(calls(shim.log)).toEqual(["push", "fetch"]);
  });

  it("refuses a HEAD that is not one commit on top of the proved base", () => {
    const { origin, ancestor, work } = fixture();

    const result = push(work, origin, ancestor);

    expect(result.code).toBe(2);
    expect(result.output).toContain("not a single raise commit");
    expect(remoteMain(origin)).not.toBe(git(work, "rev-parse", "HEAD"));
  });

  it("retries a push that failed while main stayed put", () => {
    const { root, origin, work, base, raise } = fixture();
    const shim = flakyGit(root, ["push"]);

    const result = push(work, origin, base, shim.bin);

    expect(result.code, result.output).toBe(0);
    expect(remoteMain(origin)).toBe(raise);
    expect(calls(shim.log)).toEqual(["push", "fetch", "push"]);
  });

  it("retries after a failed fetch instead of ending the step", () => {
    const { root, origin, work, base, raise } = fixture();
    const shim = flakyGit(root, ["push", "fetch"]);

    const result = push(work, origin, base, shim.bin);

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("Fetching main failed on attempt 1");
    expect(remoteMain(origin)).toBe(raise);
    expect(calls(shim.log)).toEqual(["push", "fetch", "push"]);
  });

  it("fails closed after a bounded number of attempts", () => {
    const { root, work, base } = fixture();
    const shim = flakyGit(root, []);

    const result = push(
      work,
      path.join(root, "unreachable.git"),
      base,
      shim.bin
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain("after 3 attempts; nothing was pushed");
    expect(calls(shim.log).filter(call => call === "push")).toHaveLength(3);
  });

  it("refuses to run with an empty argument", () => {
    const { work, origin } = fixture();

    const result = push(work, origin, "");

    expect(result.code).toBe(2);
  });
});
