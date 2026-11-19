/**
 * Native dual-lock fixtures for tests/integration/npm-update-dual-lock.test.ts.
 *
 * Every lock here is genuine installer output against the public registry;
 * nothing is synthesized.
 * @module tests/integration/support/npm-update-dual-lock-fixture
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import type { qualifiedBun } from "../../../all/copy-overwrite/scripts/lib/npm-update-bun.mjs";
import {
  runNpm,
  runProcess,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

export const BUN_LOCK_FILE = "bun.lock";
export const PACKAGE_FILE = "package.json";
export const NPM_LOCK_FILE = "package-lock.json";
export const FILES = [BUN_LOCK_FILE, NPM_LOCK_FILE, PACKAGE_FILE];
const IGNORE_SCRIPTS = "--ignore-scripts";
export const FROZEN = ["install", "--frozen-lockfile", IGNORE_SCRIPTS];
export const INSTALL_FLAGS = [IGNORE_SCRIPTS, "--no-audit", "--no-fund"];

/**
 * A native Bun runner bound to one checkout.
 * @param cwd - Fixture checkout.
 * @param env - Original sanitized candidate environment.
 * @returns A runner that accepts the listed exit codes.
 */
export function bunIn(cwd: string, env: NodeJS.ProcessEnv) {
  return (args: string[], allowed = [0]) =>
    runProcess("bun", args, { cwd, env, timeout: 120_000, allowed });
}

/**
 * Commit genuine installer output; no lock or registry response is synthesized.
 * @param root - Positively owned native fixture root.
 * @param env - Original sanitized candidate environment.
 * @param dual - Whether the host actually commits both locks.
 * @param aliases - Genuine root aliases and their registry parent fixture.
 * @returns Actual checkout and its native Bun runner.
 */
export async function baseline(
  root: string,
  env: NodeJS.ProcessEnv,
  dual = true,
  aliases: Record<string, string> = {}
) {
  const cwd = join(root, "host");
  const npm = (args: string[]) => runNpm(args, { cwd, env, timeout: 120_000 });
  const bun = bunIn(cwd, env);
  const git = (args: string[]) => runProcess("git", args, { cwd, env });
  mkdirSync(cwd, { mode: 0o700 });
  writeFileSync(
    join(cwd, PACKAGE_FILE),
    JSON.stringify({
      name: "anonymous-dual-lock-host",
      version: "1.0.0",
      private: true,
      devDependencies: { "is-number": "6.0.0", ...aliases },
    }),
    { mode: 0o600 }
  );
  await npm(["install", "--package-lock-only", ...INSTALL_FLAGS]);
  if (dual) {
    expect((await bun(["--version"])).stdout.toString().trim()).toBe("1.4.4");
    await bun(["install", "--lockfile-only", IGNORE_SCRIPTS]);
    await bun(FROZEN);
  }
  await git(["init"]);
  await git([
    "add",
    "--",
    ...FILES.filter(file => dual || file !== BUN_LOCK_FILE),
  ]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "Committed native dual locks",
  ]);
  return { cwd, bun };
}

/**
 * Copy a committed baseline checkout so one case can change it freely.
 *
 * Symlinks are copied as written: `node_modules/.bin` holds relative links,
 * and resolving them would point the copy back into the source checkout.
 * @param source - Committed baseline checkout.
 * @param target - New checkout path inside the same private root.
 * @param env - Original sanitized candidate environment.
 * @returns The copy and its native Bun runner.
 */
export function copyCheckout(
  source: string,
  target: string,
  env: NodeJS.ProcessEnv
) {
  cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  return { cwd: target, bun: bunIn(target, env) };
}

/**
 * Parse the checkout's Bun lock with the qualified native Bun.
 * @param native - Qualified native Bun runner.
 * @param cwd - Fixture checkout.
 * @returns The parsed lock.
 */
export async function parseBunLock(
  native: Awaited<ReturnType<typeof qualifiedBun>>,
  cwd: string
) {
  return JSON.parse(
    (
      await native(
        [
          "--eval",
          "process.stdout.write(JSON.stringify(Bun.JSONC.parse(await Bun.stdin.text())))",
        ],
        { cwd, input: readFileSync(join(cwd, BUN_LOCK_FILE)) }
      )
    ).stdout.toString()
  );
}

/**
 * A promise with its resolver, for a fixture whose lifetime spans hooks.
 * @returns The promise and the function that resolves it.
 */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  const settle: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>(resolve => {
    settle.resolve = resolve;
  });
  return {
    promise,
    resolve: value => (settle.resolve as (value: T) => void)(value),
  };
}
