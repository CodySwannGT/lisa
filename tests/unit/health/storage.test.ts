/* eslint-disable max-lines -- storage fault and concurrency cases share one isolated-root fixture */
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
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HEALTH_RESULT_PATH,
  MAX_HEALTH_RESULT_BYTES,
  readLatestHealthResult,
  writeLatestHealthResult,
} from "../../../src/health/storage.js";
import { withFileTargetLock } from "../../../src/core/learnings-lock.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-health-storage-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const NEWER_COMPLETED_AT = "2026-07-20T12:02:00.000Z";
const validResult = (completedAt = "2026-07-20T12:01:00.000Z") => ({
  schemaVersion: 1,
  runId: `health-${completedAt.slice(11, 19).replaceAll(":", "")}`,
  mode: "deterministic",
  startedAt: "2026-07-20T12:00:00.000Z",
  completedAt,
  findings: [
    {
      check: "config.sync",
      layer: "deterministic",
      status: "pass",
      reason: "Configuration is synchronized.",
    },
  ],
  summary: { verdict: "in band", counts: { pass: 1, warn: 0, fail: 0 } },
});

/**
 * Build an otherwise valid result whose pretty JSON plus newline is exact.
 * @param targetBytes - Exact serialized byte size
 * @param runId - Unique result identity
 * @returns Valid candidate with the requested serialized size
 */
const resultWithSerializedBytes = (targetBytes: number, runId: string) => {
  const count = 130;
  const base = {
    ...validResult(),
    runId,
    findings: Array.from({ length: count }, (_unused, index) => ({
      ...validResult().findings[0],
      check: `check.${index}`,
      reason: "x",
    })),
    summary: {
      verdict: "in band",
      counts: { pass: count, warn: 0, fail: 0 },
    },
  };
  const baseBytes = Buffer.byteLength(`${JSON.stringify(base, null, 2)}\n`);
  const additional = targetBytes - baseBytes;
  const perFinding = Math.floor(additional / count);
  const remainder = additional % count;
  if (additional < 0 || perFinding > 1_999) {
    throw new Error("test target is outside the valid HealthResult envelope");
  }
  return {
    ...base,
    findings: base.findings.map((entry, index) => ({
      ...entry,
      reason: "x".repeat(1 + perFinding + (index < remainder ? 1 : 0)),
    })),
  };
};

describe("health result storage", () => {
  it("reports never-run without mutating the project", async () => {
    expect(await readLatestHealthResult(projectRoot)).toEqual({
      status: "never-run",
    });
    await expect(readdir(projectRoot)).resolves.toEqual([]);
  });

  it("writes the exact path and reads completedAt as the last-run stamp", async () => {
    const candidate = validResult();
    const written = await writeLatestHealthResult(projectRoot, candidate);
    const read = await readLatestHealthResult(projectRoot);

    expect(written.status).toBe("written");
    expect(written.path.endsWith(HEALTH_RESULT_PATH)).toBe(true);
    expect(read).toMatchObject({
      status: "available",
      lastRun: candidate.completedAt,
    });
    expect(JSON.parse(await readFile(written.path, "utf8"))).toEqual(candidate);
    expect(
      (await readdir(path.dirname(written.path))).filter(name =>
        name.endsWith(".tmp")
      )
    ).toEqual([]);
  });

  it("replaces with newer results but never regresses completedAt", async () => {
    const old = validResult();
    const newer = validResult(NEWER_COMPLETED_AT);
    await writeLatestHealthResult(projectRoot, old);
    expect((await writeLatestHealthResult(projectRoot, newer)).status).toBe(
      "written"
    );
    expect((await writeLatestHealthResult(projectRoot, old)).status).toBe(
      "unchanged"
    );
    expect(await readLatestHealthResult(projectRoot)).toMatchObject({
      status: "available",
      result: { completedAt: newer.completedAt },
    });
  });

  it("serializes concurrent writers into one complete monotonic result", async () => {
    const results = await Promise.all([
      writeLatestHealthResult(projectRoot, validResult()),
      writeLatestHealthResult(
        projectRoot,
        validResult("2026-07-20T12:03:00.000Z")
      ),
      writeLatestHealthResult(projectRoot, validResult(NEWER_COMPLETED_AT)),
    ]);
    expect(results).toHaveLength(3);
    expect(await readLatestHealthResult(projectRoot)).toMatchObject({
      status: "available",
      result: { completedAt: "2026-07-20T12:03:00.000Z" },
    });
  });

  it("validates before mutation and preserves the completed result", async () => {
    await writeLatestHealthResult(projectRoot, validResult());
    const before = await readFile(
      path.join(projectRoot, HEALTH_RESULT_PATH),
      "utf8"
    );
    await expect(
      writeLatestHealthResult(projectRoot, { schemaVersion: 1 })
    ).rejects.toThrow();
    expect(
      await readFile(path.join(projectRoot, HEALTH_RESULT_PATH), "utf8")
    ).toBe(before);
  });

  it("roundtrips the exact byte cap and rejects cap-plus-one before mutation", async () => {
    const exact = resultWithSerializedBytes(
      MAX_HEALTH_RESULT_BYTES,
      "health-max-envelope"
    );
    const written = await writeLatestHealthResult(projectRoot, exact);
    expect(Buffer.byteLength(await readFile(written.path))).toBe(
      MAX_HEALTH_RESULT_BYTES
    );
    expect(await readLatestHealthResult(projectRoot)).toMatchObject({
      status: "available",
      result: { runId: "health-max-envelope" },
    });
    const before = await readFile(written.path);
    const over = resultWithSerializedBytes(
      MAX_HEALTH_RESULT_BYTES + 1,
      "health-over-envelope"
    );
    await expect(writeLatestHealthResult(projectRoot, over)).rejects.toThrow(
      /256 KiB/
    );
    expect(await readFile(written.path)).toStrictEqual(before);
  });

  it("defines idempotent and conflicting run identity semantics", async () => {
    const initial = validResult();
    await writeLatestHealthResult(projectRoot, initial);
    expect((await writeLatestHealthResult(projectRoot, initial)).status).toBe(
      "unchanged"
    );
    await expect(
      writeLatestHealthResult(projectRoot, {
        ...initial,
        findings: [
          { ...initial.findings[0], reason: "A different completed payload." },
        ],
      })
    ).rejects.toThrow(/runId was reused/);
    await expect(
      writeLatestHealthResult(projectRoot, {
        ...initial,
        runId: "health-same-time-different-run",
      })
    ).rejects.toThrow(/completedAt/);
    await expect(
      writeLatestHealthResult(projectRoot, {
        ...validResult(NEWER_COMPLETED_AT),
        runId: initial.runId,
      })
    ).rejects.toThrow(/runId was reused/);
  });

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
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const { withFileTargetLock } = await import(${JSON.stringify(moduleUrl)}); const { writeFile } = await import("node:fs/promises"); await withFileTargetLock(process.argv.at(-2), async () => { await writeFile(process.argv.at(-1), "held"); await new Promise(resolve => setTimeout(resolve, 150)); });`,
        target,
        marker,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    await vi.waitFor(async () => {
      expect(await readFile(marker, "utf8")).toBe("held");
    });
    const pending = writeLatestHealthResult(projectRoot, validResult());
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => {
        if (code === 0) resolve();
        else reject(new Error(`health lock child exited ${String(code)}`));
      });
    });
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
/* eslint-enable max-lines -- restore repository defaults */
