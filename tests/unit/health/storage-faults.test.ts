/**
 * Health result storage: unreadable states, lock reclamation and contention,
 * and unsafe storage paths.
 * @module tests/unit/health/storage-faults.test
 */
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

import {
  HEALTH_RESULT_PATH,
  readLatestHealthResult,
  writeLatestHealthResult,
} from "../../../src/health/storage.js";
import { withFileTargetLock } from "../../../src/core/learnings-lock.js";
import { NEWER_COMPLETED_AT, validResult } from "./storage-fixtures.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-health-storage-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("health result storage", () => {
  it.each([
    ["malformed", "{bad json"],
    ["unsupported", JSON.stringify({ ...validResult(), schemaVersion: 2 })],
    ["oversized", "x".repeat(256 * 1024 + 1)],
  ])("reports %s state as unreadable", async (_name, payload) => {
    const target = path.join(projectRoot, HEALTH_RESULT_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, payload);
    expect(await readLatestHealthResult(projectRoot)).toMatchObject({
      status: "unreadable",
    });
  });

  it("reports a special-file target as unreadable", async () => {
    const target = path.join(projectRoot, HEALTH_RESULT_PATH);
    await mkdir(target, { recursive: true });
    expect(await readLatestHealthResult(projectRoot)).toMatchObject({
      status: "unreadable",
    });
  });

  it("reports invalid UTF-8 bytes as unreadable", async () => {
    const target = path.join(projectRoot, HEALTH_RESULT_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from([0xc3, 0x28]));
    expect(await readLatestHealthResult(projectRoot)).toMatchObject({
      status: "unreadable",
    });
  });

  it("reports a dangling storage-parent symlink as unreadable", async () => {
    await mkdir(path.join(projectRoot, ".lisa"));
    await symlink(
      path.join(projectRoot, "missing-health"),
      path.join(projectRoot, ".lisa", "health")
    );
    expect(await readLatestHealthResult(projectRoot)).toMatchObject({
      status: "unreadable",
    });
  });

  it("reclaims dead and malformed expired health locks", async () => {
    const target = path.join(projectRoot, HEALTH_RESULT_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    const lockPath = `${target}.lock`;
    await writeFile(
      lockPath,
      JSON.stringify({
        token: "dead-health-owner",
        pid: 2_147_483_647,
        createdAt: Date.now() - 60_000,
      })
    );
    expect(
      (await writeLatestHealthResult(projectRoot, validResult())).status
    ).toBe("written");
    await writeFile(lockPath, "{");
    const stale = new Date(Date.now() - 60_000);
    await utimes(lockPath, stale, stale);
    expect(
      (
        await writeLatestHealthResult(
          projectRoot,
          validResult(NEWER_COMPLETED_AT)
        )
      ).status
    ).toBe("written");
    expect(await readdir(path.dirname(target))).not.toContain(
      path.basename(lockPath)
    );
    expect(
      (await readdir(path.dirname(target))).some(name =>
        name.endsWith(".owner")
      )
    ).toBe(false);
  });

  it("does not steal a live expired lock", async () => {
    const target = path.join(projectRoot, HEALTH_RESULT_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    const lockPath = `${target}.lock`;
    await writeFile(
      lockPath,
      JSON.stringify({
        token: "live-health-owner",
        pid: process.pid,
        createdAt: Date.now() - 60_000,
      })
    );
    const pending = writeLatestHealthResult(projectRoot, validResult());
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(await readFile(lockPath, "utf8")).toContain("live-health-owner");
    await unlink(lockPath);
    expect((await pending).status).toBe("written");
  });

  it("serializes a health write behind a separate process", async () => {
    const target = path.join(projectRoot, HEALTH_RESULT_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    const marker = `${target}.held`;
    const moduleUrl = pathToFileURL(
      path.resolve("src/core/learnings-lock.ts")
    ).href;
    // Run under `bun`, not `process.execPath`: inside vitest that path is
    // node, which strips types but does NOT rewrite a `./x.js` specifier to
    // `./x.ts`, so a node child can only import a lock module that happens to
    // have no relative imports at all — an accidental property nothing
    // declared, which broke the moment `learnings-lock.ts` grew a sibling.
    // `execFileAsync("bun", ["--eval", ...])` is how the repo's other
    // cross-process lock test already spawns its writers.
    const child = execFileAsync(
      "bun",
      [
        "--eval",
        `const { withFileTargetLock } = await import(${JSON.stringify(moduleUrl)}); const { writeFile } = await import("node:fs/promises"); await withFileTargetLock(process.argv.at(-2), async () => { await writeFile(process.argv.at(-1), "held"); await new Promise(resolve => setTimeout(resolve, 150)); });`,
        target,
        marker,
      ],
      { cwd: path.resolve(".") }
    );
    await vi.waitFor(async () => {
      expect(await readFile(marker, "utf8")).toBe("held");
    });
    const pending = writeLatestHealthResult(projectRoot, validResult());
    await child;
    expect((await pending).status).toBe("written");
  });

  it("rejects special lock paths and preserves stolen lock inodes", async () => {
    const target = path.join(projectRoot, HEALTH_RESULT_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    const lockPath = `${target}.lock`;
    await mkdir(lockPath);
    await expect(
      writeLatestHealthResult(projectRoot, validResult())
    ).rejects.toThrow(/lock/i);
    await rm(lockPath, { recursive: true });

    await withFileTargetLock(target, async () => {
      const stolen = `${lockPath}.stolen`;
      await unlink(lockPath);
      await writeFile(stolen, "stolen-owner");
      await link(stolen, lockPath);
      await unlink(stolen);
    });
    expect(await readFile(lockPath, "utf8")).toBe("stolen-owner");
  });

  it("rejects symlinked storage parents without touching the external target", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "lisa-health-outside-"));
    try {
      await mkdir(path.join(projectRoot, ".lisa"));
      await symlink(outside, path.join(projectRoot, ".lisa", "health"));
      await expect(
        writeLatestHealthResult(projectRoot, validResult())
      ).rejects.toThrow(/Unsafe/);
      await expect(readdir(outside)).resolves.toEqual([]);
      expect(await readLatestHealthResult(projectRoot)).toMatchObject({
        status: "unreadable",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
