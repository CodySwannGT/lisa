/**
 * Cleanup that survives the payload, for the Rails scratch supervisor.
 *
 * Pass, fail, SIGTERM, SIGINT, SIGHUP, a SIGKILLed payload and a SIGKILLed
 * foreground supervisor all have to end the same way: the owned process group
 * boundedly drained and the owned run root absent, before the managed
 * invocation reports its outcome. The SIGKILL cases are the ones that decide
 * whether the design is right, because they are the ones where the process that
 * would normally tidy up is the process that is gone.
 *
 * Cleanup is done by an authority forked from THIS invocation before the
 * payload was allowed to start. No successor Lisa run is launched to do it, and
 * nothing sweeps the temp namespace at large.
 * @module tests/integration/rails-scratch-lifecycle
 */
import { describe, expect, it, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ioLatencyBudgetMs } from "../helpers/io-latency-budget";
import {
  collect,
  isAlive,
  makeScratchBase,
  namespaceEntries,
  readTrace,
  runSupervisor,
  spawnSupervisor,
  startOutsideService,
  waitFor,
  type ScratchBase,
} from "./support/rails-scratch-supervisor";

/** Basename of the sentinel a held payload touches once it is really running. */
const RUNNING_SENTINEL = "payload.running";

const bases: ScratchBase[] = [];

/**
 * Allocate a temp base that is torn down when the test finishes.
 * @returns A fresh isolated scratch base
 */
function base(): ScratchBase {
  const created = makeScratchBase();
  bases.push(created);
  return created;
}

/**
 * Read a pid a payload wrote to a file.
 * @param file - Path the payload wrote
 * @returns The pid
 */
function readPid(file: string): number {
  return Number(fs.readFileSync(file, "utf-8").trim());
}

afterEach(() => {
  while (bases.length > 0) bases.pop()?.cleanup();
});

describe("the payload's verdict survives cleanup unchanged", () => {
  it.each([
    ["passes", "exit 0", 0],
    ["fails", "exit 3", 3],
    ["fails with a high status", "exit 77", 77],
  ])(
    "removes the run root when the payload %s",
    async (_label, script, code) => {
      const scratch = base();
      const run = await runSupervisor(scratch.base, [
        "--suite",
        "verdict",
        "--",
        "sh",
        "-c",
        script,
      ]);
      expect(run.code).toBe(code);
      expect(namespaceEntries(scratch.namespace)).toEqual([]);
    }
  );
});

describe("a terminal signal is honoured, then re-raised", () => {
  it.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)(
    "cleans up and re-raises %s",
    async signal => {
      const scratch = base();
      const running = path.join(scratch.base, RUNNING_SENTINEL);
      const child = spawnSupervisor(scratch.base, [
        "--suite",
        `sig${signal.toLowerCase()}`,
        "--",
        "sh",
        "-c",
        `touch "${running}"; sleep 60`,
      ]);
      const done = collect(child);

      // Wait for the payload itself, not merely for the run root: the case is a
      // run interrupted with scratch already allocated and a payload already
      // executing.
      expect(await waitFor(() => fs.existsSync(running))).toBe(true);
      child.kill(signal);
      const run = await done;

      // The caller must see what really happened, after cleanup, not a
      // laundered zero.
      expect(run.signal).toBe(signal);
      expect(
        await waitFor(() => namespaceEntries(scratch.namespace).length === 0)
      ).toBe(true);
    }
  );

  it("boundedly drains the whole owned process group, including grandchildren", async () => {
    const scratch = base();
    const grandchild = path.join(scratch.base, "grandchild.pid");
    const child = spawnSupervisor(scratch.base, [
      "--suite",
      "drain",
      "--",
      "sh",
      "-c",
      `sh -c 'echo $$ > "${grandchild}"; sleep 90' & sleep 90`,
    ]);
    const done = collect(child);

    expect(
      await waitFor(() => fs.existsSync(grandchild) && readPid(grandchild) > 0)
    ).toBe(true);
    const pid = readPid(grandchild);
    expect(isAlive(pid)).toBe(true);

    child.kill("SIGTERM");
    await done;

    expect(await waitFor(() => !isAlive(pid))).toBe(true);
    expect(
      await waitFor(() => namespaceEntries(scratch.namespace).length === 0)
    ).toBe(true);
  });

  it(
    "escalates to SIGKILL within the budget when the payload ignores SIGTERM",
    async () => {
      const scratch = base();
      const stubborn = path.join(scratch.base, "stubborn.pid");
      // A payload that traps SIGTERM and keeps going. This is what a wedged
      // suite, or a job hitting its wall-clock timeout, actually looks like:
      // "drained" has to mean drained, not "asked politely and moved on".
      const child = spawnSupervisor(
        scratch.base,
        [
          "--suite",
          "stubborn",
          "--",
          "sh",
          "-c",
          `trap '' TERM; echo $$ > "${stubborn}"; while :; do sleep 1; done`,
        ],
        { LISA_SCRATCH_DRAIN_MS: "1000" }
      );
      const done = collect(child);

      expect(
        await waitFor(() => fs.existsSync(stubborn) && readPid(stubborn) > 0)
      ).toBe(true);
      const pid = readPid(stubborn);

      child.kill("SIGTERM");
      await done;

      expect(await waitFor(() => !isAlive(pid))).toBe(true);
      expect(
        await waitFor(() => namespaceEntries(scratch.namespace).length === 0)
      ).toBe(true);
    },
    ioLatencyBudgetMs(30_000)
  );
});

describe("SIGKILL, where the process that would tidy up is the one that is gone", () => {
  it(
    "removes the run root and drains the orphans when the payload is SIGKILLed",
    async () => {
      const scratch = base();
      const leader = path.join(scratch.base, "payload.pid");
      const orphan = path.join(scratch.base, "orphan.pid");
      const child = spawnSupervisor(scratch.base, [
        "--suite",
        "payloadkill",
        "--",
        "sh",
        "-c",
        `sh -c 'echo $$ > "${orphan}"; sleep 90' & echo $$ > "${leader}"; sleep 90`,
      ]);
      const done = collect(child);

      expect(
        await waitFor(
          () =>
            fs.existsSync(leader) &&
            fs.existsSync(orphan) &&
            readPid(leader) > 0 &&
            readPid(orphan) > 0
        )
      ).toBe(true);
      const orphanPid = readPid(orphan);

      // Kill the process-group LEADER outright. Its children keep running and
      // keep the run's inherited stdout and stderr open, so a supervisor that
      // gives up on a dead leader cannot even report its own outcome until they
      // finish on their own — measured as a 60-second hang on a run that had
      // already been killed.
      process.kill(readPid(leader), "SIGKILL");

      const run = await done;
      expect(run.code).toBe(137);
      expect(await waitFor(() => !isAlive(orphanPid))).toBe(true);
      expect(
        await waitFor(() => namespaceEntries(scratch.namespace).length === 0)
      ).toBe(true);
    },
    ioLatencyBudgetMs(30_000)
  );

  it("removes the run root when the FOREGROUND supervisor is SIGKILLed, with no successor run", async () => {
    const scratch = base();
    const trace = path.join(scratch.base, "trace.log");
    const running = path.join(scratch.base, RUNNING_SENTINEL);
    const child = spawnSupervisor(
      scratch.base,
      ["--suite", "supkill", "--", "sh", "-c", `touch "${running}"; sleep 60`],
      { LISA_SCRATCH_TRACE: trace }
    );
    const done = collect(child);

    expect(await waitFor(() => fs.existsSync(running))).toBe(true);
    const observed = namespaceEntries(scratch.namespace)[0];
    expect(observed).toMatch(/^supkill\.[0-9a-f]{64}$/);

    child.kill("SIGKILL");
    await done;

    // Cleanup is done by THIS invocation's already-armed authority.
    expect(
      await waitFor(() => namespaceEntries(scratch.namespace).length === 0)
    ).toBe(true);

    const events = readTrace(trace);
    expect(events).toContain("authority reap-begin");
    expect(events).toContain("authority reap-end");
    // The supervisor never reached its own finish path — it was killed.
    expect(events).not.toContain("supervisor finish-root-absent");
  });
});

describe("the external database service is preserved", () => {
  it("never signals a process outside the owned group", async () => {
    const scratch = base();
    // Stand-in for the workflow's PostgreSQL/MySQL service container or a
    // developer's already-running database: a long-lived process in a DIFFERENT
    // process group that the run neither started nor owns.
    const service = startOutsideService();
    const running = path.join(scratch.base, RUNNING_SENTINEL);

    try {
      const child = spawnSupervisor(scratch.base, [
        "--suite",
        "dblifecycle",
        "--",
        "sh",
        "-c",
        `touch "${running}"; sleep 60`,
      ]);
      const done = collect(child);
      expect(await waitFor(() => fs.existsSync(running))).toBe(true);
      child.kill("SIGTERM");
      await done;

      expect(
        await waitFor(() => namespaceEntries(scratch.namespace).length === 0)
      ).toBe(true);
      // Cleaned its own process tree and its own scratch; left the service
      // running and usable.
      expect(isAlive(service.pid)).toBe(true);
    } finally {
      service.stop();
    }
  });
});
