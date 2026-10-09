/**
 * @file history-preimage-batch.test.ts
 * @description Independent native fixture proofs retain exact bytes and fail closed after batching.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertChildCompleted,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import {
  createHarness,
  provePreimage,
} from "../../fixtures/git-history-secrets/harness.mjs";
import { verifyPreimageBatch } from "../../fixtures/git-history-secrets/preimage-batch.mjs";

useIoLatencyBudget();
let harness: ReturnType<typeof createHarness>;
let cwd: string;
let revision: string;
const bytes = Buffer.from([0, 255, 10, 32, 120, 10]);
const digest = createHash("sha256").update(bytes).digest("hex");
const linked = "linked.bin";
const unproved = "Unproved native preimage";
const path = "config/é original.bin";
const replacementPath = "config/replacement-\uFFFD.bin";
const git = (args: string[], input?: string) => {
  const result = spawnSync("git", ["--no-replace-objects", ...args], {
    cwd,
    input,
    timeout: ioLatencyBudgetMs(6000),
    killSignal: "SIGKILL",
  });
  assertChildCompleted(result, "independent preimage falsification native Git");
  expect(result.status).toBe(0);
  return result.stdout;
};

beforeAll(() => {
  harness = createHarness([]);
  cwd = harness.initialize("batch-proof").cwd;
  harness.write(cwd, replacementPath, bytes);
  revision = harness.commit(cwd, path, bytes);
  harness.git(cwd, "add", ".");
  harness.git(cwd, "commit", "-qm", "exact replacement character path");
  harness.write(cwd, linked, "placeholder");
  rmSync(join(cwd, linked));
  symlinkSync(path, join(cwd, linked));
  harness.git(cwd, "add", ".");
  harness.git(cwd, "commit", "-qm", "independent symlink refusal");
});
afterAll(() => {
  rmSync(harness.scratch, { recursive: true, force: true });
  expect(existsSync(harness.scratch)).toBe(false);
});
const tuple = () => [revision, path, digest];
const fault = (kind: string) => (args: string[], input?: string) => {
  const raw = git(args, input);
  if (args.includes("ls-tree")) {
    if (kind === "mode")
      return Buffer.from(raw.toString().replace("100644", "120000"));
    if (kind === "path")
      return Buffer.from(raw.toString().replace(path, "foreign.bin"));
  }
  if (args.includes("--batch")) {
    if (kind === "oid")
      return Buffer.from(
        raw.toString("binary").replace(/^[a-f0-9]{40}/u, "f".repeat(40)),
        "binary"
      );
    if (kind === "truncated") return raw.subarray(0, raw.length - 1);
    if (kind === "bytes") {
      const changed = Buffer.from(raw);
      changed[changed.indexOf(10) + 1] ^= 1;
      return changed;
    }
  }
  return raw;
};

describe("independent native preimage batches", () => {
  it("retains binary bytes, duplicate tuple order and native child verification", () => {
    const tuples = [tuple(), [revision, path, null], tuple()];
    const inventory = verifyPreimageBatch(tuples, git);
    expect(inventory).toHaveLength(3);
    expect(inventory.map(row => [row.commit, row.path, row.size])).toEqual(
      tuples.map(row => [row[0], row[1], bytes.length])
    );
    expect(provePreimage(harness, cwd, tuples)).toEqual(inventory);
  });
  it.each(["mode", "path", "oid", "truncated", "bytes"])(
    "rejects actual Git reply falsified at %s",
    kind => {
      expect(() => verifyPreimageBatch([tuple()], fault(kind))).toThrow(
        unproved
      );
    }
  );
  it("rejects malformed tree bytes that decode to a genuine replacement character path", () => {
    const head = harness.git(cwd, "rev-parse", "HEAD");
    const tuples = [[head, replacementPath, digest]];
    expect(verifyPreimageBatch(tuples, git)).toHaveLength(1);
    const read = (args: string[], input?: string) => {
      const raw = git(args, input);
      if (!args.includes("ls-tree")) return raw;
      const offset = raw.indexOf(Buffer.from("\uFFFD"));
      expect(offset).toBeGreaterThan(0);
      return Buffer.concat([
        raw.subarray(0, offset),
        Buffer.from([0xff]),
        raw.subarray(offset + 3),
      ]);
    };
    expect(() => verifyPreimageBatch(tuples, read)).toThrow(unproved);
  });
  it("rejects high-bit header bytes that an ASCII decoder aliases to the real object identity", () => {
    const read = (args: string[], input?: string) => {
      const raw = git(args, input);
      if (!args.includes("--batch")) return raw;
      const changed = Buffer.from(raw);
      const offset = changed
        .subarray(0, changed.indexOf(10))
        .findIndex(byte => byte >= 0x61 && byte <= 0x66);
      expect(offset).toBeGreaterThanOrEqual(0);
      changed[offset] |= 0x80;
      return changed;
    };
    expect(() => verifyPreimageBatch([tuple()], read)).toThrow(unproved);
  });
  it("refuses a requested path with an unmatched surrogate before native Git runs", () => {
    const read = vi.fn(() => Buffer.alloc(0));
    expect(() =>
      verifyPreimageBatch([[revision, String.fromCharCode(0xd800), null]], read)
    ).toThrow("Invalid native preimage proof batch");
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects a mismatching expected digest and genuine symlink mode", () => {
    expect(() =>
      verifyPreimageBatch([[revision, path, "f".repeat(64)]], git)
    ).toThrow(unproved);
    const head = harness.git(cwd, "rev-parse", "HEAD");
    expect(() => verifyPreimageBatch([[head, linked, null]], git)).toThrow(
      unproved
    );
  });
  it("admits all 256 original rows while refusing unsafe or oversized batches before Git", () => {
    expect(
      verifyPreimageBatch(Array.from({ length: 256 }, tuple), git)
    ).toHaveLength(256);
    const read = vi.fn();
    for (const tuples of [
      Array.from({ length: 257 }, tuple),
      [[revision, "../foreign.bin", null]],
      [],
    ]) {
      expect(() => verifyPreimageBatch(tuples, read)).toThrow(
        "Invalid native preimage proof batch"
      );
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("retrieves 20 distinct real binary objects in bounded chunks instead of per-tuple children", () => {
    const tuples: (string | null)[][] = [];
    for (let index = 0; index < 20; index++)
      harness.write(cwd, `binary-${index}`, Buffer.from([0, 255, index]));
    harness.git(cwd, "add", ".");
    harness.git(cwd, "commit", "-qm", "bounded binary batch");
    const head = harness.git(cwd, "rev-parse", "HEAD");
    for (let index = 0; index < 20; index++)
      tuples.push([head, `binary-${index}`, null]);
    const calls: string[][] = [];
    const inventory = verifyPreimageBatch(tuples, (args, input) => {
      calls.push(args);
      return git(args, input);
    });
    expect(inventory).toHaveLength(20);
    expect(calls.filter(args => args.includes("ls-tree"))).toHaveLength(1);
    expect(calls.filter(args => args.includes("--batch"))).toHaveLength(2);
    expect(inventory.map(row => row.path)).toEqual(tuples.map(row => row[1]));
  });
});
