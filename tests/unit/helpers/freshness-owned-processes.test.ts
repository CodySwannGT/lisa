/** @module tests/unit/helpers/freshness-owned-processes */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownedProcesses } from "../../helpers/freshness-owned-processes.js";
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
 * Complete only this controlled census, without starting a real process.
 * @param child Controlled census handle.
 * @param output Complete native output to deliver.
 */
function complete(child: ReturnType<typeof pendingCensus>, output: string) {
  child.stdout.write(output);
  child.emit("close", 0, null);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("freshness process census", () => {
  it("lets file timers advance during one shared pending census", async () => {
    vi.useFakeTimers();
    const child = pendingCensus();
    const owned = ownedProcesses(101);
    const first = owned.observe();
    const second = owned.observe();
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
    await Promise.all([first, second]);
  });

  it("rejects a timed-out census by name instead of reporting no survivors", async () => {
    vi.useFakeTimers();
    const child = pendingCensus();
    const owned = ownedProcesses(101);
    const observed = expect(owned.observe()).rejects.toThrow(
      /freshness.*census.*timeout/iu
    );
    await vi.advanceTimersByTimeAsync(ioLatencyBudgetMs(1_000));
    await observed;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(owned.active()).rejects.toThrow(/timeout/iu);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("rejects capture overflow even if the truncated prefix contains valid ownership", async () => {
    const child = pendingCensus();
    const owned = ownedProcesses(101);
    const observed = expect(owned.observe()).rejects.toThrow(
      /capture.*limit/iu
    );
    child.stdout.write(row(101, process.pid, 101));
    child.stdout.write("x".repeat(2 * 1024 * 1024));
    await observed;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(owned.active()).rejects.toThrow(/capture.*limit/iu);
  });

  it("rejects signal, spawn, and malformed census failures", async () => {
    const killed = pendingCensus();
    const signalled = expect(ownedProcesses(101).observe()).rejects.toThrow(
      /SIGKILL/u
    );
    killed.emit("close", null, "SIGKILL");
    await signalled;
    const absent = pendingCensus();
    const errored = expect(ownedProcesses(101).observe()).rejects.toThrow(
      /ENOENT/u
    );
    absent.emit("error", new Error("ENOENT"));
    await errored;
    const malformed = pendingCensus();
    const invalid = expect(ownedProcesses(101).observe()).rejects.toThrow(
      /invalid.*row/iu
    );
    complete(malformed, "truncated native census row\n");
    await invalid;
  });

  it("captures descendants through the live leader and refuses reused birth or group identities", async () => {
    const initial = pendingCensus();
    const owned = ownedProcesses(101);
    const observed = owned.observe();
    complete(
      initial,
      row(101, process.pid, 101) + row(102, 101, 102) + row(999, 1, 999)
    );
    await observed;
    expect(owned.captured()).toEqual([101, 102]);
    const fresh = pendingCensus();
    const active = owned.active();
    complete(
      fresh,
      row(101, process.pid, 999) +
        row(102, 1, 102, "12:00:01") +
        row(999, 1, 999)
    );
    expect(await active).toEqual([]);
    const census = pendingCensus();
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const drained = owned.drain();
    complete(census, row(999, 1, 999));
    await drained;
    expect(kill).not.toHaveBeenCalled();
  });

  it("rechecks matching ownership immediately before signalling a group", async () => {
    const initial = pendingCensus();
    const owned = ownedProcesses(101);
    const observed = owned.observe();
    complete(initial, row(101, process.pid, 101));
    await observed;
    const candidate = pendingCensus();
    const recheck = pendingCensus();
    vi.mocked(spawn)
      .mockReturnValueOnce(candidate as unknown as ReturnType<typeof spawn>)
      .mockReturnValueOnce(recheck as unknown as ReturnType<typeof spawn>);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const drained = owned.drain();
    complete(candidate, row(101, process.pid, 101));
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(3));
    complete(recheck, row(101, process.pid, 101));
    await drained;
    expect(kill).toHaveBeenCalledExactlyOnceWith(-101, "SIGKILL");
  });
});
