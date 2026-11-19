import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runHealth,
  type AgenticHealthEvaluator,
} from "../../../src/health/agentic.js";
import { startCpuStopwatch } from "../../helpers/cpu-budget.js";
import {
  ESLINT_LOCAL_CONFIG_FILE,
  GENEROUS_TIMEOUT_MS,
  SUPERLINEAR_CPU_GUARD_MS,
  collect,
  deterministicResult,
  writeFixture,
} from "./agentic-fixtures.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const mocks = vi.hoisted(() => ({
  deterministic: undefined as unknown,
  runDeterministic: vi.fn(),
}));

vi.mock("../../../src/health/deterministic.js", () => ({
  runDeterministicHealth: mocks.runDeterministic,
}));

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "lisa-health-agentic-unit-"))
  );
  await writeFixture(projectRoot);
  mocks.deterministic = deterministicResult();
  mocks.runDeterministic.mockReset();
  mocks.runDeterministic.mockImplementation(async () => mocks.deterministic);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("runHealth confined evidence collection", () => {
  it("extracts a large control-heavy workflow in linear time", async () => {
    const controls = Array.from(
      { length: 3_000 },
      (_unused, index) => `      skip_jobs: 'job-${index % 10}'`
    ).join("\n");
    await writeFile(
      path.join(projectRoot, ".github", "workflows", "ci.yml"),
      `jobs:\n  quality:\n${controls}\n`
    );
    const evaluator = vi.fn(async () => ({
      status: "completed" as const,
      judgments: [],
    }));
    const stopwatch = startCpuStopwatch();

    const result = await runHealth(projectRoot, {
      agentic: { enabled: true, evaluator, timeoutMs: GENEROUS_TIMEOUT_MS },
    });

    expect(result.mode).toBe("full");
    expect(evaluator).toHaveBeenCalledTimes(1);
    expect(stopwatch.elapsed().cpuMs).toBeLessThan(SUPERLINEAR_CPU_GUARD_MS);
  });

  it("degrades before evaluation when line prefixes expand an excerpt past its byte limit", async () => {
    const controls = Array.from({ length: 6_000 }, () => "      skip_jobs:");
    const source = controls.join("\n");
    const expanded = controls
      .map((line, index) => `${index + 1}: ${line}`)
      .join("\n");
    expect(Buffer.byteLength(source, "utf8")).toBeLessThanOrEqual(128 * 1024);
    expect(Buffer.byteLength(expanded, "utf8")).toBeGreaterThan(128 * 1024);
    await writeFile(
      path.join(projectRoot, ".github", "workflows", "ci.yml"),
      source
    );
    const evaluator = vi.fn(async () => ({
      status: "completed" as const,
      judgments: [],
    }));
    const stopwatch = startCpuStopwatch();

    const result = await runHealth(projectRoot, {
      agentic: { enabled: true, evaluator, timeoutMs: GENEROUS_TIMEOUT_MS },
    });

    expect(result).toBe(mocks.deterministic);
    expect(evaluator).not.toHaveBeenCalled();
    expect(stopwatch.elapsed().cpuMs).toBeLessThan(SUPERLINEAR_CPU_GUARD_MS);
  });

  it("degrades without calling the evaluator for an escaping symlink", async () => {
    const evaluator = vi.fn<AgenticHealthEvaluator>(async () => ({
      status: "completed",
      judgments: [],
    }));
    const outside = path.join(
      tmpdir(),
      `lisa-health-outside-${process.pid}.ts`
    );
    await writeFile(outside, "private outside evidence");
    await rm(path.join(projectRoot, ESLINT_LOCAL_CONFIG_FILE));
    createSymlink(outside, path.join(projectRoot, ESLINT_LOCAL_CONFIG_FILE));

    try {
      expect(await collect(projectRoot, evaluator)).toBe(mocks.deterministic);
      expect(evaluator).not.toHaveBeenCalled();
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("degrades before evaluation for oversized or invalid UTF-8 evidence", async () => {
    const evaluator = vi.fn<AgenticHealthEvaluator>(async () => ({
      status: "completed",
      judgments: [],
    }));
    await writeFile(
      path.join(projectRoot, ESLINT_LOCAL_CONFIG_FILE),
      "x".repeat(128 * 1024 + 1)
    );
    expect(await collect(projectRoot, evaluator)).toBe(mocks.deterministic);
    await writeFile(
      path.join(projectRoot, ESLINT_LOCAL_CONFIG_FILE),
      Buffer.from([0xc3, 0x28])
    );
    expect(await collect(projectRoot, evaluator)).toBe(mocks.deterministic);
    expect(evaluator).not.toHaveBeenCalled();
  });

  it("degrades when workflow enumeration exceeds its fixed limit", async () => {
    const evaluator = vi.fn<AgenticHealthEvaluator>(async () => ({
      status: "completed",
      judgments: [],
    }));
    await Promise.all(
      Array.from({ length: 65 }, (_unused, index) =>
        writeFile(
          path.join(projectRoot, ".github", "workflows", `extra-${index}.yml`),
          "jobs:\n  quality:\n    with:\n      skip_jobs: ''\n"
        )
      )
    );

    expect(await collect(projectRoot, evaluator)).toBe(mocks.deterministic);
    expect(evaluator).not.toHaveBeenCalled();
  });
});
