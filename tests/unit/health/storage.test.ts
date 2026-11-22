/**
 * Health result storage: write/read contract, monotonic replacement, byte cap,
 * and run identity semantics.
 * @module tests/unit/health/storage.test
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HEALTH_RESULT_PATH,
  MAX_HEALTH_RESULT_BYTES,
  readLatestHealthResult,
  serializeHealthResult,
  writeLatestHealthResult,
} from "../../../src/health/storage.js";
import { NEWER_COMPLETED_AT, validResult } from "./storage-fixtures.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-health-storage-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
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
    expect(await readFile(written.path, "utf8")).toBe(
      `${JSON.stringify(candidate, null, 2)}\n`
    );
    expect(
      (await readdir(path.dirname(written.path))).filter(name =>
        name.endsWith(".tmp")
      )
    ).toEqual([]);
  });

  it("exposes the validated canonical storage serialization", () => {
    expect(serializeHealthResult(validResult())).toBe(
      `${JSON.stringify(validResult(), null, 2)}\n`
    );
    expect(() => serializeHealthResult({ schemaVersion: 1 })).toThrow();
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
});
