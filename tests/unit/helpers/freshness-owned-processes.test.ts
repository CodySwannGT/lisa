/** @module tests/unit/helpers/freshness-owned-processes */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  census,
  drainOwnership,
  liveOwned,
  observeOwnership,
  ownershipOf,
} from "../../helpers/freshness-owned-processes.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

vi.mock("node:child_process", async importOriginal => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

/**
 * A pending census whose streams and completion remain under test control.
 * @returns The controlled child handle and its output streams.
 */
function pendingCensus() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>
  );
  return child;
}

/**
 * Native ps row, including the birth time that distinguishes reused PIDs.
 * @param pid Process identifier.
 * @param parent Observed parent identifier.
 * @param group Observed process group.
 * @param birth Native process birth time.
 * @returns One complete native census row.
 */
function row(pid: number, parent: number, group: number, birth = "12:00:00") {
  return `${pid} ${parent} ${group} Fri Oct 9 ${birth} 2026 S\n`;
}

/**
 * Close a controlled census the way a real child closes: its streams end
 * first, then the process reports its exit.
 * @param child Controlled census handle.
 * @param status Exit status to report.
 * @param signal Terminating signal to report.
 */
function close(
  child: ReturnType<typeof pendingCensus>,
  status: number | null,
  signal: NodeJS.Signals | null
) {
  child.stdout.end();
  child.stderr.end();
  setImmediate(() => child.emit("close", status, signal));
}

/**
 * Complete only this controlled census, without starting a real process.
 * @param child Controlled census handle.
 * @param output Complete native output to deliver.
 */
function complete(child: ReturnType<typeof pendingCensus>, output: string) {
  child.stdout.write(output);
  close(child, 0, null);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("freshness process census", () => {
  it("lets file timers advance during a pending census", async () => {
    vi.useFakeTimers();
    const child = pendingCensus();
    const observed = observeOwnership(ownershipOf(101));
    const filePoll = vi.fn();
    setTimeout(filePoll, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(filePoll).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith("/bin/ps", expect.any(Array), {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: ioLatencyBudgetMs(1_000),
      killSignal: "SIGKILL",
    });
    complete(child, row(101, process.pid, 101));
    await vi.advanceTimersByTimeAsync(0);
    expect([...(await observed).owned.keys()]).toEqual([101]);
  });

  it("rejects a timed-out census by name instead of reporting no survivors", async () => {
    vi.useFakeTimers();
    const child = pendingCensus();
    const observed = expect(census()).rejects.toThrow(
      /freshness.*census.*timeout/iu
    );
    await vi.advanceTimersByTimeAsync(ioLatencyBudgetMs(1_000));
    await observed;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("rejects capture overflow even if the truncated prefix contains valid ownership", async () => {
    const child = pendingCensus();
    const observed = expect(observeOwnership(ownershipOf(101))).rejects.toThrow(
      /capture.*limit/iu
    );
    child.stdout.write(row(101, process.pid, 101));
    child.stdout.write("x".repeat(2 * 1024 * 1024));
    await observed;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("rejects signal, spawn, and malformed census failures", async () => {
    const killed = pendingCensus();
    const signalled = expect(census()).rejects.toThrow(/SIGKILL/u);
    close(killed, null, "SIGKILL");
    await signalled;
    const absent = pendingCensus();
    const errored = expect(census()).rejects.toThrow(/ENOENT/u);
    absent.emit("error", new Error("ENOENT"));
    await errored;
    const malformed = pendingCensus();
    const invalid = expect(census()).rejects.toThrow(/invalid.*row/iu);
    complete(malformed, "truncated native census row\n");
    await invalid;
  });

  it("refuses a leader that is not this process's fresh detached child", async () => {
    const foreign = pendingCensus();
    const refused = expect(observeOwnership(ownershipOf(101))).rejects.toThrow(
      /leader identity unavailable/u
    );
    complete(foreign, row(101, 1, 101));
    await refused;
  });

  it("captures descendants through the live leader and refuses reused birth or group identities", async () => {
    const initial = pendingCensus();
    const observed = observeOwnership(ownershipOf(101));
    complete(
      initial,
      row(101, process.pid, 101) + row(102, 101, 102) + row(999, 1, 999)
    );
    const owned = await observed;
    expect([...owned.owned.keys()]).toEqual([101, 102]);
    const fresh = pendingCensus();
    const active = liveOwned(owned);
    complete(
      fresh,
      row(101, process.pid, 999) +
        row(102, 1, 102, "12:00:01") +
        row(999, 1, 999)
    );
    expect(await active).toEqual([]);
    const drainCensus = pendingCensus();
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const drained = drainOwnership(owned);
    complete(drainCensus, row(999, 1, 999));
    await drained;
    expect(kill).not.toHaveBeenCalled();
  });

  it("rechecks matching ownership immediately before signalling a group", async () => {
    const initial = pendingCensus();
    const observed = observeOwnership(ownershipOf(101));
    complete(initial, row(101, process.pid, 101));
    const owned = await observed;
    const candidate = pendingCensus();
    const recheck = pendingCensus();
    vi.mocked(spawn)
      .mockReturnValueOnce(candidate as unknown as ReturnType<typeof spawn>)
      .mockReturnValueOnce(recheck as unknown as ReturnType<typeof spawn>);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const drained = drainOwnership(owned);
    complete(candidate, row(101, process.pid, 101));
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(3));
    complete(recheck, row(101, process.pid, 101));
    await drained;
    expect(kill).toHaveBeenCalledExactlyOnceWith(-101, "SIGKILL");
  });
});
