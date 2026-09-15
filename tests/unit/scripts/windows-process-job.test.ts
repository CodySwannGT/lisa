/** Windows helper cleanup must release scratch even after a delayed close. */
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { startWindowsProcessJob } from "../../../all/copy-overwrite/scripts/lib/windows-process-job.mjs";

vi.mock("node:child_process", async importOriginal => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

/** Simulate only the helper process; its scratch files remain real. */
function helper() {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const job = startWindowsProcessJob("exit /b 0");
  const options = vi.mocked(spawn).mock.calls[0]?.[2];
  const directory = options?.env?.["TEMP"];
  if (!directory) throw new Error("Helper scratch directory missing");
  return { child, job, directory };
}

it("waits for the killed helper to close and cleans scratch before rejecting", async () => {
  vi.useFakeTimers();
  const { child, job, directory } = helper();
  const settled = vi.fn();
  const result = job.reap().catch(settled);
  await vi.advanceTimersByTimeAsync(30000);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  expect(settled).not.toHaveBeenCalled();
  expect(existsSync(directory)).toBe(true);
  child.emit("close");
  await result;
  expect(settled).toHaveBeenCalledWith(expect.any(Error));
  expect(existsSync(directory)).toBe(false);
});

it("bounds the final close wait and cleans scratch if a surviving caller sees a later close", async () => {
  vi.useFakeTimers();
  const { child, job, directory } = helper();
  try {
    const rejected = expect(job.reap()).rejects.toThrow(
      "did not complete its cleanup wait"
    );
    await vi.advanceTimersByTimeAsync(31000);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(existsSync(directory)).toBe(true);
    child.emit("close");
    expect(existsSync(directory)).toBe(false);
  } finally {
    child.emit("close");
  }
});

it("reads the receipt before removing a normally closed helper's scratch", async () => {
  const { child, job, directory } = helper();
  writeFileSync(path.join(directory, "reaped"), "reaped");
  child.emit("close");
  await expect(job.reap()).resolves.toBeUndefined();
  expect(existsSync(directory)).toBe(false);
});

it("stops the helper and awaits close when its stop marker cannot be written", async () => {
  vi.useFakeTimers();
  const { child, job, directory } = helper();
  mkdirSync(path.join(directory, "stop"));
  const settled = vi.fn();
  const result = job.reap().catch(settled);
  try {
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).not.toHaveBeenCalled();
    child.emit("close");
    await result;
    expect(settled).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("stop") })
    );
    expect(existsSync(directory)).toBe(false);
  } finally {
    child.emit("close");
    await result;
  }
});
