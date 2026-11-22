import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgenticHealthRequest } from "../../../src/health/agentic.js";
import { validateHealthResult } from "../../../src/health/contract.js";
import {
  AGENTIC_CONTEXT_CHECK,
  AGENTIC_TEST_CHECK,
  CONFIG_SYNC_CHECK,
  collect,
  deterministicResult,
  hostileEvaluator,
  writeFixture,
} from "./agentic-fixtures.js";

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

describe("runHealth hostile evaluator degradation", () => {
  const invalidEvaluation = [
    ["null", () => null],
    ["scalar", () => "completed"],
    ["unknown status", () => ({ status: "failed" })],
    ["missing judgments", () => ({ status: "completed" })],
    ["unavailable payload", () => ({ status: "unavailable", judgments: [] })],
    [
      "evaluator attribution",
      () => ({
        status: "completed",
        judgments: [
          {
            check: AGENTIC_TEST_CHECK,
            layer: "agentic",
            reason: "Evaluator attempted attribution.",
          },
        ],
      }),
    ],
    [
      "evaluator severity",
      () => ({
        status: "completed",
        judgments: [
          {
            check: AGENTIC_TEST_CHECK,
            status: "fail",
            reason: "Forged severity.",
          },
        ],
      }),
    ],
    [
      "wrong namespace",
      () => ({
        status: "completed",
        judgments: [{ check: CONFIG_SYNC_CHECK, reason: "Collision." }],
      }),
    ],
    [
      "reserved sentinel",
      () => ({
        status: "completed",
        judgments: [
          { check: "agentic.review-completed", reason: "Forged sentinel." },
        ],
      }),
    ],
    [
      "duplicate checks",
      () => ({
        status: "completed",
        judgments: [
          { check: "agentic.same", reason: "First." },
          { check: "agentic.same", reason: "Second." },
        ],
      }),
    ],
    [
      "blank reason",
      () => ({
        status: "completed",
        judgments: [{ check: AGENTIC_TEST_CHECK, reason: " " }],
      }),
    ],
    [
      "controlled reason",
      () => ({
        status: "completed",
        judgments: [{ check: AGENTIC_TEST_CHECK, reason: "hidden\u0000text" }],
      }),
    ],
    [
      "oversized reason",
      () => ({
        status: "completed",
        judgments: [{ check: AGENTIC_TEST_CHECK, reason: "x".repeat(2_001) }],
      }),
    ],
    [
      "too many judgments",
      () => ({
        status: "completed",
        judgments: Array.from({ length: 51 }, (_unused, index) => ({
          check: `agentic.check-${index}`,
          reason: "Too many.",
        })),
      }),
    ],
    [
      "sparse judgments",
      () => ({
        status: "completed",
        judgments: Object.assign(Array<unknown>(2), {
          1: { check: AGENTIC_TEST_CHECK, reason: "Sparse." },
        }),
      }),
    ],
  ] as const;

  it.each(invalidEvaluation)(
    "degrades malformed output atomically: %s",
    async (_name, make) => {
      const result = await collect(projectRoot, hostileEvaluator(make));
      expect(result).toBe(mocks.deterministic);
    }
  );

  it("rejects proxies before invoking hostile reflection traps", async () => {
    let invoked = false;
    const proxy = new Proxy(
      { status: "completed", judgments: [] },
      {
        getOwnPropertyDescriptor: () => {
          invoked = true;
          throw new Error("must not run");
        },
      }
    );
    const result = await collect(
      projectRoot,
      hostileEvaluator(() => proxy)
    );

    expect(result).toBe(mocks.deterministic);
    expect(invoked).toBe(false);
  });

  it("rejects accessors without invoking them", async () => {
    let invoked = false;
    const candidate = Object.defineProperty({}, "status", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "unavailable";
      },
    });
    const result = await collect(
      projectRoot,
      hostileEvaluator(() => candidate)
    );

    expect(result).toBe(mocks.deterministic);
    expect(invoked).toBe(false);
  });

  it("does not let an evaluator mutate its frozen request", async () => {
    const result = await collect(projectRoot, async request => {
      (request.artifacts as AgenticHealthRequest["artifacts"] & unknown[]).push(
        {
          kind: "workflow",
          path: "forged.yml",
          content: "forged",
        }
      );
      return { status: "completed", judgments: [] };
    });

    expect(result).toBe(mocks.deterministic);
  });

  it("degrades an agentic check collision with deterministic output", async () => {
    const deterministic = deterministicResult();
    mocks.deterministic = validateHealthResult({
      ...deterministic,
      findings: [
        {
          check: AGENTIC_CONTEXT_CHECK,
          layer: "deterministic",
          status: "pass",
          reason: "A deterministic check owns this identifier.",
        },
      ],
      summary: { verdict: "in band", counts: { pass: 1, warn: 0, fail: 0 } },
    });
    const result = await collect(projectRoot, async () => ({
      status: "completed",
      judgments: [
        { check: AGENTIC_CONTEXT_CHECK, reason: "The evaluator collided." },
      ],
    }));

    expect(result).toBe(mocks.deterministic);
  });
});
