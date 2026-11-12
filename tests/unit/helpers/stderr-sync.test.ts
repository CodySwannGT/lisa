/**
 * @file stderr-sync.test.ts
 * @description The exit-safe stderr writer (CodySwannGT/lisa#4621): it writes
 * the whole message exactly once through `writeSync` on the stderr
 * descriptor, even when the pipe accepts only part of it, retries a full pipe
 * a bounded number of times, and never throws.
 * @module tests/unit/helpers/stderr-sync
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeStderrSync } from "../../helpers/stderr-sync.js";

/** How the stubbed stderr descriptor answers each `writeSync` call. */
const pipe = vi.hoisted(() => ({
  writes: [] as string[],
  attempts: 0,
  failure: undefined as NodeJS.ErrnoException | undefined,
  halveFirstWrite: false,
}));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const writeSync = vi.fn((fd: number, ...rest: unknown[]) => {
    if (fd !== process.stderr.fd)
      return (actual.writeSync as (...args: unknown[]) => number)(fd, ...rest);
    pipe.attempts += 1;
    if (pipe.failure !== undefined) throw pipe.failure;
    const [data, offset] = rest as [Buffer, number];
    const pending = data.subarray(offset);
    const accepted =
      pipe.halveFirstWrite && pipe.attempts === 1
        ? pending.subarray(0, Math.floor(pending.length / 2))
        : pending;
    pipe.writes.push(accepted.toString("utf8"));
    return accepted.length;
  });
  return { ...actual, default: actual, writeSync };
});

afterEach(() => {
  pipe.writes.length = 0;
  pipe.attempts = 0;
  pipe.failure = undefined;
  pipe.halveFirstWrite = false;
});

describe("writeStderrSync", () => {
  const message = "history-scanner stderr probe\n";

  it("writes the message once, in one call, when the pipe takes it all", () => {
    writeStderrSync(message);

    expect(pipe.writes.join("")).toBe(message);
    expect(pipe.attempts).toBe(1);
  });

  it("finishes a message the pipe accepted only part of, writing it exactly once", () => {
    pipe.halveFirstWrite = true;

    writeStderrSync(message);

    expect(pipe.writes.join("")).toBe(message);
    expect(pipe.attempts).toBe(2);
  });

  it.each([
    ["gives up after a bounded number of EAGAIN retries", "EAGAIN", 100],
    ["stops at once when stderr refuses the write outright", "EBADF", 1],
  ])("%s, without throwing", (_name, code, attempts) => {
    pipe.failure = Object.assign(new Error(code), { code });

    expect(() => writeStderrSync(message)).not.toThrow();

    expect(pipe.attempts).toBe(attempts);
    expect(pipe.writes).toEqual([]);
  });
});
