/**
 * Headroom admission across real processes (CodySwannGT/lisa#4596).
 *
 * Every case starts real `lisa admit` processes (the built CLI) against one
 * private state directory: the decision lock, the reservation files and the
 * liveness probes are all real. Only the machine reading is stated, through
 * `LISA_ADMISSION_FAKE_MACHINE`, so the headroom does not depend on whatever
 * else this host is running.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../../dist/index.js");

/** Room for exactly one four-worker run. */
const ROOM_FOR_ONE = JSON.stringify({ cores: 4, load1: 0, freeMemoryMb: 8192 });

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A private directory. Short, so the lock socket stays under the platform's
 * socket-path limit.
 * @returns Path
 */
function dir(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lisa-test-")));
  roots.push(root);
  return root;
}

/** A finished client. */
interface Finished {
  readonly code: number | null;
  readonly output: string;
}

/**
 * Start one `lisa admit` client.
 * @param options - Client options
 * @param options.state - Shared state directory
 * @param options.cwd - Repository it runs from
 * @param options.script - Node source the admitted command runs
 * @param options.maxWait - Wait bound
 * @returns The child and a promise of its result
 */
function client(options: {
  state: string;
  cwd: string;
  script: string;
  maxWait: string;
}): { child: ChildProcess; done: Promise<Finished> } {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.startsWith("LISA_ADMISSION") &&
        name !== "LISA_ADMITTED_WORKERS" &&
        name !== "CI"
    )
  );
  const child = spawn(
    process.execPath,
    [
      CLI,
      "admit",
      "--workers",
      "4",
      "--max-wait",
      options.maxWait,
      "--",
      process.execPath,
      "-e",
      options.script,
    ],
    {
      cwd: options.cwd,
      env: {
        ...environment,
        LISA_ADMISSION_STATE_DIR: options.state,
        LISA_ADMISSION_FAKE_MACHINE: ROOM_FOR_ONE,
        LISA_ADMISSION_POLL_MS: "100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const chunks: string[] = [];
  const done = new Promise<Finished>(settle => {
    child.once("close", code => settle({ code, output: chunks.join("") }));
  });
  children.push(child);
  child.stdout?.on("data", chunk => chunks.push(String(chunk)));
  child.stderr?.on("data", chunk => chunks.push(String(chunk)));
  return { child, done };
}

/**
 * Wait until a predicate holds.
 * @param predicate - Condition
 * @param timeoutMs - Bound
 */
async function until(
  predicate: () => boolean,
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise(settle => setTimeout(settle, 50));
  }
}

/**
 * Node source that records it started, then holds the machine a while.
 * @param marker - File the command writes its pid to
 * @param ms - How long it runs
 * @returns Node source
 */
const hold = (marker: string, ms: number): string =>
  `require("fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setTimeout(() => {}, ${String(ms)});`;

describe("lisa admit across processes", () => {
  it("two simultaneous starts with room for one: exactly one waits, then both run", async () => {
    const state = dir();
    const repo = dir();
    const a = client({
      state,
      cwd: repo,
      script: hold(join(repo, "a"), 1_500),
      maxWait: "30s",
    });
    const b = client({
      state,
      cwd: repo,
      script: hold(join(repo, "b"), 1_500),
      maxWait: "30s",
    });
    const [first, second] = await Promise.all([a.done, b.done]);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const waited = [first, second].filter(run =>
      /waiting for headroom/u.test(run.output)
    );
    expect(waited).toHaveLength(1);
    expect(waited[0]?.output).toMatch(/Held by: pid \d+/u);
    expect(readdirSync(state).filter(name => name.endsWith(".json"))).toEqual(
      []
    );
  }, 60_000);

  it("ignores and removes the reservation of a run killed with SIGKILL", async () => {
    const state = dir();
    const repo = dir();
    const marker = join(repo, "victim");
    const victim = client({
      state,
      cwd: repo,
      script: hold(marker, 30_000),
      maxWait: "5s",
    });
    await until(() => existsSync(marker));
    const reservation = `${String(victim.child.pid)}.json`;
    expect(readdirSync(state)).toContain(reservation);
    victim.child.kill("SIGKILL");
    process.kill(Number(readFileSync(marker, "utf8")), "SIGKILL");
    await victim.done;
    const next = client({
      state,
      cwd: repo,
      script: hold(join(repo, "next"), 10),
      maxWait: "5s",
    });
    const result = await next.done;
    expect(result.code).toBe(0);
    expect(result.output).not.toMatch(/waiting for headroom/u);
    expect(readdirSync(state)).not.toContain(reservation);
  }, 60_000);

  it("a run from repository B counts repository A's run and is refused, never started, after the bound", async () => {
    const state = dir();
    const repoA = dir();
    const repoB = dir();
    const startedA = join(repoA, "started");
    const holder = client({
      state,
      cwd: repoA,
      script: hold(startedA, 30_000),
      maxWait: "5s",
    });
    await until(() => existsSync(startedA));
    const startedB = join(repoB, "started");
    const refused = await client({
      state,
      cwd: repoB,
      script: hold(startedB, 10),
      maxWait: "1s",
    }).done;
    expect(refused.code).toBe(75);
    expect(refused.output).toMatch(/refused .* after 1s/u);
    expect(refused.output).toContain(`in ${repoA}`);
    expect(existsSync(startedB)).toBe(false);
    holder.child.kill("SIGTERM");
    await holder.done;
  }, 60_000);
});
