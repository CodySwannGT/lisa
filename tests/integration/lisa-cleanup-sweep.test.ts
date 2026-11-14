/**
 * Integration proof of the start-of-run cleanup sweep against the real
 * filesystem and real processes (CodySwannGT/lisa#4597).
 *
 * The temp half runs the shipped CLI with `TMPDIR` pointed at a private root
 * holding really back-dated folders. The process half starts two real
 * long-lived `node` children — one whose `LISA_TEST_RUN_OWNER` names a dead owner, one
 * whose marker names this live test process with its real start time — and
 * lets the real listing, start-time lookup and signals decide. The listing is
 * narrowed to those two children so this file can never signal anything it
 * did not start.
 *
 * `node`, not `sleep`: macOS hides the environment of Apple-signed binaries
 * (`/bin/sleep`, `/bin/sh`, the system `ruby`) from `ps -E`, so a marked
 * `sleep` is invisible to the sweep there. Test processes are `node`, `bun`
 * and the like, whose environment `ps -E` does show.
 * @module tests/integration/lisa-cleanup-sweep
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isAlive,
  listProcesses,
  ownerMarkerFor,
  sweepOrphans,
} from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep-processes.mjs";
import { boundedSpawnSync } from "../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs";
import { fsLatencyBudgetMs } from "../helpers/fs-latency-budget.js";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs"
);
const HOUR_MS = 60 * 60 * 1000;
/** Entries in the piped-output corpus: the #4694 reproduction's own count. */
const PIPED_ENTRY_COUNT = 10_000;
/** Room to seed, sweep and delete the 10,000-entry corpus, scaled by fs load. */
const PIPED_BASE_MS = 120_000;
const children: ChildProcess[] = [];
const roots: string[] = [];

/**
 * Create a directory whose mtime is `ageHours` in the past.
 * @param root - Private root
 * @param name - Entry name
 * @param ageHours - Age
 * @returns Absolute path
 */
function agedDir(root: string, name: string, ageHours: number): string {
  const entry = path.join(root, name);
  const when = new Date(Date.now() - ageHours * HOUR_MS);
  // 0700, as `mkdtemp` makes it: the sweep skips anything group or other can open.
  fs.mkdirSync(entry, { mode: 0o700 });
  fs.utimesSync(entry, when, when);
  return entry;
}

/**
 * Start a long-lived `node` child carrying an owner marker.
 * @param marker - `LISA_TEST_RUN_OWNER` value
 * @returns The child
 */
function markedChild(marker: string): ChildProcess {
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 600000)"],
    {
      env: { ...process.env, LISA_TEST_RUN_OWNER: marker },
      stdio: "ignore",
    }
  );
  children.push(child);
  return child;
}

/**
 * The marker of an owner that has certainly exited: a real child whose start
 * time is read while it runs, then killed and awaited.
 * @returns `<pid>:<start>` naming a dead process
 */
async function deadOwnerMarker(): Promise<string> {
  const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  const exited = new Promise(resolve => owner.once("exit", resolve));
  const marker = await new Promise<string>(resolve =>
    setTimeout(() => resolve(ownerMarkerFor(owner.pid as number)), 100)
  );
  children.push(owner);
  owner.kill("SIGKILL");
  await exited;
  // An unread start time would make this a different case from the one under
  // test; say so instead of failing later as a missing kill.
  if (marker.endsWith(":0"))
    throw new Error(`dead owner's start time was unreadable: ${marker}`);
  return marker;
}

/**
 * Wait until a pid is no longer alive, or a deadline passes.
 * @param pid - Process id
 * @param deadlineMs - Longest wait
 * @returns Whether the process ended
 */
async function ended(pid: number, deadlineMs = 5_000): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (!isAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return !isAlive(pid);
}

/**
 * Wait until every pid is listed with an owner marker, or fail at a deadline.
 * @param pids - Children the sweep must see
 * @param deadlineMs - Longest wait
 */
async function markersListed(
  pids: ReadonlySet<number | undefined>,
  deadlineMs = 10_000
): Promise<void> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    const marked = listProcesses().filter(
      row => pids.has(row.pid) && row.owner !== null
    );
    if (marked.length === pids.size) return;
    if (Date.now() >= until)
      throw new Error(
        `only ${marked.length} of ${pids.size} children listed with a marker after ${deadlineMs} ms`
      );
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("cleanup sweep, real filesystem and processes", () => {
  it("removes the 25-hour Lisa folder and keeps the 1-hour one and the non-Lisa one", () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-sweep-int-"));
    roots.push(root);
    const stale = agedDir(root, "lisa-sweep-demo-old", 25);
    const fresh = agedDir(root, "lisa-sweep-demo-new", 1);
    const foreign = agedDir(root, "other-sweep-demo-old", 25);
    // `--no-processes` and a private TMPDIR: this case must never touch the
    // machine's real processes or its real temp directory.
    const child = boundedSpawnSync(
      process.execPath,
      [SCRIPT, "--json", "--no-processes"],
      {
        encoding: "utf8",
        env: { ...process.env, TMPDIR: root },
      }
    );
    expect(child.status).toBe(0);
    const report = JSON.parse(String(child.stdout).trim());
    expect(report.removed.map((entry: string) => path.basename(entry))).toEqual(
      ["lisa-sweep-demo-old"]
    );
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it.runIf(process.platform === "darwin" || process.platform === "linux")(
    "kills the orphan of a dead owner and leaves a live run's child running",
    async () => {
      const orphan = markedChild(await deadOwnerMarker());
      const liveChild = markedChild(ownerMarkerFor(process.pid));
      const ours = new Set([orphan.pid, liveChild.pid]);
      // Wait until the real listing shows both children with their markers.
      // A fixed sleep lost this race under full-suite load: a child not yet
      // listed with its environment is (correctly) spared, so nothing died.
      await markersListed(ours);
      const result = await sweepOrphans({
        listProcesses: () => listProcesses().filter(row => ours.has(row.pid)),
        graceMs: 200,
      });
      expect(result.errors).toEqual([]);
      expect(result.killed).toEqual([orphan.pid]);
      expect(await ended(orphan.pid as number)).toBe(true);
      expect(isAlive(liveChild.pid as number)).toBe(true);
    }
  );

  it(
    "writes the whole --json report into a pipe, listing all 10,000 stale entries",
    () => {
      // CodySwannGT/lisa#4694: the CLI called `process.exit` straight after
      // writing its JSON, and a write to a pipe is asynchronous, so a reader
      // got only the first 65,536 bytes — invalid JSON. The sweep's stdout
      // must be a PIPE for this to bite: `| cat` gives it one, exactly as the
      // ticket's reproduction does (spawnSync captures `sh`, not the sweep).
      // Pipe writes are asynchronous on macOS but synchronous on Linux, so the
      // red-before-green control of this case is only reachable on darwin;
      // elsewhere it guards the contract.
      const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-sweep-pipe-"));
      roots.push(root);
      const names = Array.from(
        { length: PIPED_ENTRY_COUNT },
        (_, index) => `lisa-sweep-pipe-${index}`
      );
      for (const name of names) agedDir(root, name, 48);
      const child = boundedSpawnSync(
        "sh",
        [
          "-c",
          // A pipeline's status is `cat`'s, so the sweep reports its own
          // exit status on stderr, where the assertion below reads it.
          '{ "$0" "$1" --json --dry-run --no-processes; echo "sweep-exit=$?" >&2; } | cat',
          process.execPath,
          SCRIPT,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, TMPDIR: root },
          maxBuffer: 16 * 1024 * 1024,
          timeout: fsLatencyBudgetMs(PIPED_BASE_MS),
        }
      );
      expect(child.status).toBe(0);
      expect(String(child.stderr)).toContain("sweep-exit=0");
      const output = String(child.stdout);
      expect(Buffer.byteLength(output)).toBeGreaterThan(65_536);
      const report = JSON.parse(output.trim());
      expect(report.removed).toHaveLength(PIPED_ENTRY_COUNT);
      expect(
        new Set(report.removed.map((entry: string) => path.basename(entry)))
      ).toEqual(new Set(names));
      // `--dry-run`: the report lists them, the disk still holds them.
      expect(fs.readdirSync(root)).toHaveLength(PIPED_ENTRY_COUNT);
    },
    fsLatencyBudgetMs(PIPED_BASE_MS)
  );

  it("prints one summary line and exits 0 without --json", () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-sweep-int-"));
    roots.push(root);
    agedDir(root, "lisa-sweep-summary-old", 25);
    const child = boundedSpawnSync(
      process.execPath,
      [SCRIPT, "--dry-run", "--no-processes"],
      {
        encoding: "utf8",
        env: { ...process.env, TMPDIR: root },
      }
    );
    expect(child.status).toBe(0);
    const lines = String(child.stdout).trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^🧹 would sweep 1 stale temp dir, 0 orphaned test processes \(\d+ ms\)$/u
    );
  });
});
