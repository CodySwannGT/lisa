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

const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs"
);
const HOUR_MS = 60 * 60 * 1000;
const DEAD_OWNER = "999999:0";
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
  fs.mkdirSync(entry);
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
    const child = boundedSpawnSync(process.execPath, [SCRIPT, "--json"], {
      encoding: "utf8",
      env: { ...process.env, TMPDIR: root },
    });
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
      const orphan = markedChild(DEAD_OWNER);
      const liveChild = markedChild(ownerMarkerFor(process.pid));
      const ours = new Set([orphan.pid, liveChild.pid]);
      // Let both start so the listing shows their real environment.
      await new Promise(resolve => setTimeout(resolve, 200));
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
});
