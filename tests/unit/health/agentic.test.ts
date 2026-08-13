/* eslint-disable @eslint-community/eslint-comments/disable-enable-pair, jsdoc/require-jsdoc, max-lines, sonarjs/no-duplicate-string -- explicit hostile-boundary matrix */
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance as monotonicClock } from "node:perf_hooks";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deterministic: undefined as unknown,
  runDeterministic: vi.fn(),
}));

vi.mock("../../../src/health/deterministic.js", () => ({
  runDeterministicHealth: mocks.runDeterministic,
}));

import {
  runHealth,
  type AgenticHealthEvaluation,
  type AgenticHealthEvaluator,
  type AgenticHealthJudgment,
  type AgenticHealthRequest,
} from "../../../src/health/agentic.js";
import {
  summarizeHealthFindings,
  type HealthResult,
  validateHealthResult,
} from "../../../src/health/contract.js";
import { startCpuStopwatch } from "../../helpers/cpu-budget.js";

/**
 * Budget used by every case that is *not* about the deadline. It has to be far
 * larger than the work these cases do, because an expired deadline silently
 * changes the code path under test: `runHealth` degrades to the deterministic
 * result, which is indistinguishable from the behavior several of these cases
 * assert. A tight budget therefore turned any scheduling hiccup under parallel
 * load into a failure in whichever case the hiccup happened to land in
 * (CodySwannGT/lisa#2474). Only the abort case below sets a short deadline,
 * because there the deadline is the behavior under test.
 */
const GENEROUS_TIMEOUT_MS = 60_000;
/**
 * Work budget for the cases that guard against super-linear collection —
 * **CPU** milliseconds, not wall-clock ones.
 *
 * The predecessor was a 5,000ms wall-clock bound. It was not under-budgeted:
 * the cases it covered run in single-digit milliseconds and the abort case in
 * ~500ms, so it carried 10x-to-500x headroom. It still failed at **10,026ms**
 * inside a full-suite run of 639 files (CodySwannGT/lisa#2516) on a branch that
 * never touched `health/`, because wall time bills descheduling as if it were
 * work. Widening it further would have retired the guard's whole purpose while
 * leaving the starvation untouched, so the instrument changed instead of the
 * number. See `tests/helpers/cpu-budget.ts` for the measurements.
 *
 * Sizing, all four figures stated with their conditions on 18 cores:
 *
 * | condition | wall | CPU |
 * |---|---|---|
 * | isolated, load 4.6 | 1.4–1.9ms | 1.8–2.7ms |
 * | one full suite, load 12 | 3.9–5.9ms | 2.8–4.2ms |
 * | four concurrent full suites, load 28, 73 vitest processes | 3.4–37.9ms | 3.6–7.0ms |
 *
 * | eight concurrent full suites, load 54, 144 vitest processes | 386–3,593ms | 1.4–11.3ms |
 *
 * Wall inflated to **3,593ms** for operations that take 1.4ms quiet — a 2,000x
 * spread that was closing on the old 5,000ms bound. CPU over the identical runs
 * peaked at **11.3ms**, under 5x its quiet value. That is the whole argument in
 * two columns.
 *
 * 50ms is ~4.4x the worst CPU ever observed here and ~20x the quiet-box figure.
 * The margin is deliberately much tighter than a wall budget could ever be,
 * because CPU inflation is bounded where wall inflation is not, and a loose
 * budget has a real cost: a busy-poll cancellation regression measured at
 * 114ms of wasted CPU slipped clean under a 250ms first draft of this number.
 */
const SUPERLINEAR_CPU_GUARD_MS = 50;
/** Deadline the abort case configures, in virtual milliseconds. */
const ABORT_DEADLINE_MS = 500;
const STARTED_AT = "2026-07-20T12:00:00.000Z";
const DETERMINISTIC_COMPLETED_AT = "2026-07-20T12:01:00.000Z";
const AGENTIC_COMPLETED_AT = "2026-07-20T12:02:00.000Z";

let projectRoot: string;

function deterministicResult(
  count = 1,
  status: "pass" | "fail" = "pass"
): HealthResult {
  const findings = Array.from({ length: count }, (_unused, index) => ({
    check: index === 0 ? "config.sync" : `deterministic.check-${index}`,
    layer: "deterministic" as const,
    status,
    reason:
      status === "pass"
        ? "The deterministic check passed."
        : "The deterministic check found intentional drift.",
  }));
  return validateHealthResult({
    schemaVersion: 1,
    runId: "health-run-agentic-unit",
    mode: "deterministic",
    startedAt: STARTED_AT,
    completedAt: DETERMINISTIC_COMPLETED_AT,
    findings,
    summary: summarizeHealthFindings(findings),
  });
}

function managedEslintDriftResult(): HealthResult {
  const findings = [
    {
      check: "templates.managed",
      layer: "deterministic" as const,
      status: "fail" as const,
      reason: "Managed files do not match templates: eslint.config.ts",
    },
  ];
  return validateHealthResult({
    schemaVersion: 1,
    runId: "health-run-managed-drift",
    mode: "deterministic",
    startedAt: STARTED_AT,
    completedAt: DETERMINISTIC_COMPLETED_AT,
    findings,
    summary: summarizeHealthFindings(findings),
  });
}

async function writeFixture(): Promise<void> {
  await mkdir(path.join(projectRoot, ".github", "workflows"), {
    recursive: true,
  });
  await writeFile(
    path.join(projectRoot, ".lisa.config.json"),
    JSON.stringify({
      quality: { mutation: { gate: { enabled: false } } },
      privateToken: "config-secret-must-not-cross-boundary",
    })
  );
  await writeFile(
    path.join(projectRoot, "eslint.config.local.ts"),
    "export default [{ rules: { noConsole: 'off' } }];\n"
  );
  await writeFile(
    path.join(projectRoot, "eslint.ignore.config.local.json"),
    '["generated/**"]\n'
  );
  await writeFile(
    path.join(projectRoot, "eslint.config.ts"),
    "export default ['managed-content-must-stay-gated'];\n"
  );
  await writeFile(
    path.join(projectRoot, ".github", "workflows", "ci.yml"),
    [
      "name: private workflow name",
      "jobs:",
      "  quality:",
      "    uses: org/private-repository/.github/workflows/quality.yml@main",
      "    with:",
      "      # temporarily skipped because the vendor is down",
      "      # resume after vendor ticket VENDOR-42 closes",
      "      skip_jobs: 'lint'",
      "      # expires on 2026-07-21",
      "      verify_enforced: false",
      "      unrelated_secret: do-not-expose",
      "  release:",
      "    steps:",
      "      - run: echo private-command",
      "",
    ].join("\n")
  );
}

async function collect(
  evaluator?: AgenticHealthEvaluator
): Promise<HealthResult> {
  return runHealth(projectRoot, {
    now: () => new Date(AGENTIC_COMPLETED_AT),
    agentic: { enabled: true, evaluator, timeoutMs: GENEROUS_TIMEOUT_MS },
  });
}

beforeEach(async () => {
  projectRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "lisa-health-agentic-unit-"))
  );
  await writeFixture();
  mocks.deterministic = deterministicResult();
  mocks.runDeterministic.mockReset();
  mocks.runDeterministic.mockImplementation(async () => mocks.deterministic);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("runHealth deterministic-first behavior", () => {
  it("publishes the closed evaluator judgment and evaluation types", () => {
    const judgment: AgenticHealthJudgment = {
      check: "agentic.public-contract",
      reason: "The public judgment shape is available.",
    };
    const evaluation: AgenticHealthEvaluation = {
      status: "completed",
      judgments: [judgment],
    };

    expect(evaluation).toEqual({ status: "completed", judgments: [judgment] });
  });

  it("returns the exact deterministic result when agentic review is disabled or absent", async () => {
    const evaluator = vi.fn(async () => ({
      status: "completed",
      judgments: [],
    }));
    const disabled = await runHealth(projectRoot, {
      agentic: { enabled: false, evaluator },
    });
    const unavailable = await collect();

    expect(disabled).toBe(mocks.deterministic);
    expect(unavailable).toBe(mocks.deterministic);
    expect(evaluator).not.toHaveBeenCalled();
    expect(mocks.runDeterministic).toHaveBeenCalledTimes(2);
  });

  it("composes frozen, sorted, warning-only judgments after deterministic facts", async () => {
    let request: AgenticHealthRequest | undefined;
    const beforeConfig = await readFile(
      path.join(projectRoot, ".lisa.config.json"),
      "utf8"
    );
    const result = await collect(async received => {
      request = received;
      return {
        status: "completed",
        judgments: [
          { check: "agentic.workflow-skip", reason: "Lint is skipped." },
          { check: "agentic.mutation-gate", reason: "Mutation is disabled." },
        ],
      };
    });

    expect(request).toBeDefined();
    expect(Object.keys(request ?? {})).toEqual([
      "schemaVersion",
      "deterministicFindings",
      "config",
      "artifacts",
    ]);
    expect(request?.config).toEqual({
      quality: { mutation: { gate: { enabled: false } } },
    });
    expect(JSON.stringify(request)).not.toContain("config-secret");
    expect(JSON.stringify(request)).not.toContain(
      "managed-content-must-stay-gated"
    );
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request?.deterministicFindings)).toBe(true);
    expect(Object.isFrozen(request?.deterministicFindings[0])).toBe(true);
    expect(Object.isFrozen(request?.config.quality.mutation.gate)).toBe(true);
    expect(Object.isFrozen(request?.artifacts)).toBe(true);
    expect(request?.artifacts.map(artifact => artifact.path)).toEqual([
      ".github/workflows/ci.yml",
      "eslint.config.local.ts",
      "eslint.ignore.config.local.json",
    ]);
    const workflow = request?.artifacts.find(
      artifact => artifact.kind === "workflow"
    )?.content;
    expect(workflow).toContain("quality:");
    expect(workflow).toContain(
      "# temporarily skipped because the vendor is down"
    );
    expect(workflow).toContain("# resume after vendor ticket VENDOR-42 closes");
    expect(workflow).toContain("# expires on 2026-07-21");
    expect(workflow).toContain("skip_jobs: 'lint'");
    expect(workflow).toContain("verify_enforced: false");
    expect(workflow).not.toContain("private workflow name");
    expect(workflow).not.toContain("private-repository");
    expect(workflow).not.toContain("do-not-expose");
    expect(result.mode).toBe("full");
    expect(result.completedAt).toBe(AGENTIC_COMPLETED_AT);
    expect(result.findings.map(finding => finding.check)).toEqual([
      "config.sync",
      "agentic.mutation-gate",
      "agentic.workflow-skip",
    ]);
    expect(result.findings.slice(1).map(finding => finding.status)).toEqual([
      "warn",
      "warn",
    ]);
    expect(result.summary).toEqual({
      verdict: "in band",
      counts: { pass: 1, warn: 2, fail: 0 },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(
      await readFile(path.join(projectRoot, ".lisa.config.json"), "utf8")
    ).toBe(beforeConfig);
  });

  it("composes a full result when the evaluator is slower than the machine is fast", async () => {
    const result = await collect(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 400);
      });
      return { status: "completed", judgments: [] };
    });

    expect(result.mode).toBe("full");
  });

  it("records a completed clean evaluation as full without fabricating a finding", async () => {
    const result = await collect(async () => ({
      status: "completed",
      judgments: [],
    }));

    expect(result).not.toBe(mocks.deterministic);
    expect(result.mode).toBe("full");
    expect(result.findings).toEqual(
      (mocks.deterministic as HealthResult).findings
    );
    expect(result.findings.some(finding => finding.layer === "agentic")).toBe(
      false
    );
  });

  it("projects explicit gate truth while keeping missing values unknown", async () => {
    const projected: Array<boolean | null> = [];
    const evaluator: AgenticHealthEvaluator = async request => {
      projected.push(request.config.quality.mutation.gate.enabled);
      return { status: "completed", judgments: [] };
    };
    await collect(evaluator);
    await writeFile(
      path.join(projectRoot, ".lisa.config.local.json"),
      JSON.stringify({ quality: { mutation: { gate: { enabled: true } } } })
    );
    await collect(evaluator);
    await rm(path.join(projectRoot, ".lisa.config.local.json"));
    await writeFile(
      path.join(projectRoot, ".lisa.config.json"),
      JSON.stringify({ quality: { mutation: { gate: { enabled: true } } } })
    );
    await collect(evaluator);
    await writeFile(
      path.join(projectRoot, ".lisa.config.json"),
      JSON.stringify({ quality: { mutation: { gate: { enabled: "false" } } } })
    );
    await collect(evaluator);
    await rm(path.join(projectRoot, ".lisa.config.json"));
    await collect(evaluator);

    expect(projected).toEqual([false, true, true, null, null]);
  });

  it("observes completion only after the evaluator resolves", async () => {
    let observed = DETERMINISTIC_COMPLETED_AT;
    const result = await runHealth(projectRoot, {
      now: () => new Date(observed),
      agentic: {
        enabled: true,
        evaluator: async () => {
          observed = AGENTIC_COMPLETED_AT;
          return { status: "completed", judgments: [] };
        },
      },
    });

    expect(result.completedAt).toBe(AGENTIC_COMPLETED_AT);
  });

  it("preserves deterministic drift and keeps agentic judgments warning-only", async () => {
    mocks.deterministic = deterministicResult(1, "fail");
    const result = await collect(async () => ({
      status: "completed",
      judgments: [
        { check: "agentic.context", reason: "Context needs review." },
      ],
    }));

    expect(result.findings[0]).toEqual(
      (mocks.deterministic as HealthResult).findings[0]
    );
    expect(result.findings.at(-1)?.status).toBe("warn");
    expect(result.summary.verdict).toBe("drift detected");
  });

  it("exposes gated current managed drift so identical justification can be judged by content", async () => {
    mocks.deterministic = managedEslintDriftResult();
    await writeFile(
      path.join(projectRoot, "eslint.config.local.ts"),
      "// justification: temporary migration\nexport default [];\n"
    );
    const observedManagedContent: string[] = [];
    const evaluator: AgenticHealthEvaluator = async request => {
      const managed = request.artifacts.find(
        artifact => artifact.kind === "managed-drift"
      );
      observedManagedContent.push(managed?.content ?? "missing");
      return managed?.content.includes("disable-security-rule") === true
        ? {
            status: "completed",
            judgments: [
              {
                check: "agentic.intentional-drift",
                reason: "The current managed drift disables a security rule.",
              },
            ],
          }
        : { status: "completed", judgments: [] };
    };

    await writeFile(
      path.join(projectRoot, "eslint.config.ts"),
      "export default ['benign-formatting-drift'];\n"
    );
    const benign = await collect(evaluator);
    await writeFile(
      path.join(projectRoot, "eslint.config.ts"),
      "export default ['disable-security-rule'];\n"
    );
    const suspicious = await collect(evaluator);

    expect(observedManagedContent).toEqual([
      "export default ['benign-formatting-drift'];\n",
      "export default ['disable-security-rule'];\n",
    ]);
    expect(benign.mode).toBe("full");
    expect(benign.findings).toHaveLength(1);
    expect(suspicious.findings.at(-1)).toMatchObject({
      check: "agentic.intentional-drift",
      layer: "agentic",
      status: "warn",
    });
  });
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
            check: "agentic.test",
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
          { check: "agentic.test", status: "fail", reason: "Forged severity." },
        ],
      }),
    ],
    [
      "wrong namespace",
      () => ({
        status: "completed",
        judgments: [{ check: "config.sync", reason: "Collision." }],
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
        judgments: [{ check: "agentic.test", reason: " " }],
      }),
    ],
    [
      "controlled reason",
      () => ({
        status: "completed",
        judgments: [{ check: "agentic.test", reason: "hidden\u0000text" }],
      }),
    ],
    [
      "oversized reason",
      () => ({
        status: "completed",
        judgments: [{ check: "agentic.test", reason: "x".repeat(2_001) }],
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
          1: { check: "agentic.test", reason: "Sparse." },
        }),
      }),
    ],
  ] as const;

  it.each(invalidEvaluation)(
    "degrades malformed output atomically: %s",
    async (_name, make) => {
      const result = await collect(async () => make());
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
    const result = await collect(async () => proxy);

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
    const result = await collect(async () => candidate);

    expect(result).toBe(mocks.deterministic);
    expect(invoked).toBe(false);
  });

  it("does not let an evaluator mutate its frozen request", async () => {
    const result = await collect(async request => {
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
          check: "agentic.context",
          layer: "deterministic",
          status: "pass",
          reason: "A deterministic check owns this identifier.",
        },
      ],
      summary: { verdict: "in band", counts: { pass: 1, warn: 0, fail: 0 } },
    });
    const result = await collect(async () => ({
      status: "completed",
      judgments: [
        { check: "agentic.context", reason: "The evaluator collided." },
      ],
    }));

    expect(result).toBe(mocks.deterministic);
  });

  it.each([
    ["unavailable", async () => ({ status: "unavailable" })],
    [
      "throw",
      async () => Promise.reject(new Error("private evaluator failure")),
    ],
  ])(
    "returns the exact deterministic object when the evaluator is %s",
    async (_name, evaluator) => {
      expect(await collect(evaluator)).toBe(mocks.deterministic);
    }
  );

  /**
   * The deadline runs on a virtual clock, and that is the whole fix for
   * CodySwannGT/lisa#2516.
   *
   * `HealthDeadline` reads two clocks: `setTimeout` for expiry and
   * `node:perf_hooks` `performance.now()` for `remainingMs()`. Vitest's fake
   * timers replace the first and `globalThis.performance`, but NOT the
   * `node:perf_hooks` export — they are separate objects here, verified by
   * measurement — so the spy below is load-bearing rather than belt-and-braces.
   * Both clocks are pointed at the same virtual time, which makes the deadline
   * advance only when this test says so.
   *
   * That matters because the real failure was never the elapsed-time
   * assertion. Under starvation the 500ms deadline expired *during evidence
   * collection*, so `runHealth` degraded before the evaluator was ever
   * invoked, and the original test — which awaited a promise the evaluator
   * resolves — hung until vitest's 10,000ms limit. That is the reported
   * `10026ms`, a test timeout wearing an assertion's clothes. Reproduced 8 of 8
   * at load 54 with 144 vitest processes, failing on the evaluator-call count.
   *
   * Freezing the clock removes the race by construction: no amount of
   * scheduling delay can consume a budget that only advances on command. The
   * pre/post checks around the boundary then pin the deadline to the exact
   * millisecond, which no real-time assertion could ever state.
   */
  it("aborts a timed-out evaluator at its exact deadline and returns exact deterministic output", async () => {
    let aborted = false;
    let calls = 0;
    let liveAtEntry: boolean | undefined;
    let evaluatorEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      evaluatorEntered = resolve;
    });

    vi.useFakeTimers();
    const clock = vi
      .spyOn(monotonicClock, "now")
      .mockImplementation(() => globalThis.performance.now());
    try {
      const stopwatch = startCpuStopwatch();
      const running = runHealth(projectRoot, {
        agentic: {
          enabled: true,
          timeoutMs: ABORT_DEADLINE_MS,
          evaluator: async (_request, signal) => {
            calls += 1;
            liveAtEntry = !signal.aborted;
            evaluatorEntered();
            return new Promise(resolve => {
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  resolve({ status: "unavailable" });
                },
                { once: true }
              );
            });
          },
        },
      });
      await entered;

      await vi.advanceTimersByTimeAsync(ABORT_DEADLINE_MS - 1);
      expect(aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const result = await running;
      const elapsed = stopwatch.elapsed();

      expect(result).toBe(mocks.deterministic);
      expect(calls).toBe(1);
      expect(liveAtEntry).toBe(true);
      expect(aborted).toBe(true);
      expect(elapsed.cpuMs).toBeLessThan(SUPERLINEAR_CPU_GUARD_MS);
    } finally {
      clock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("degrades when completed output exceeds the final 200-finding capacity", async () => {
    mocks.deterministic = deterministicResult(151);
    const result = await collect(async () => ({
      status: "completed",
      judgments: Array.from({ length: 50 }, (_unused, index) => ({
        check: `agentic.capacity-${index}`,
        reason: "Bounded warning.",
      })),
    }));

    expect(result).toBe(mocks.deterministic);
  });

  it("accepts completed output at the exact 200-finding capacity", async () => {
    mocks.deterministic = deterministicResult(150);
    const result = await collect(async () => ({
      status: "completed",
      judgments: Array.from({ length: 50 }, (_unused, index) => ({
        check: `agentic.capacity-${index}`,
        reason: "Bounded warning.",
      })),
    }));

    expect(result.mode).toBe("full");
    expect(result.findings).toHaveLength(200);
  });
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
    const evaluator = vi.fn(async () => ({
      status: "completed",
      judgments: [],
    }));
    const outside = path.join(
      tmpdir(),
      `lisa-health-outside-${process.pid}.ts`
    );
    await writeFile(outside, "private outside evidence");
    await rm(path.join(projectRoot, "eslint.config.local.ts"));
    await symlink(outside, path.join(projectRoot, "eslint.config.local.ts"));

    try {
      expect(await collect(evaluator)).toBe(mocks.deterministic);
      expect(evaluator).not.toHaveBeenCalled();
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("degrades before evaluation for oversized or invalid UTF-8 evidence", async () => {
    const evaluator = vi.fn(async () => ({
      status: "completed",
      judgments: [],
    }));
    await writeFile(
      path.join(projectRoot, "eslint.config.local.ts"),
      "x".repeat(128 * 1024 + 1)
    );
    expect(await collect(evaluator)).toBe(mocks.deterministic);
    await writeFile(
      path.join(projectRoot, "eslint.config.local.ts"),
      Buffer.from([0xc3, 0x28])
    );
    expect(await collect(evaluator)).toBe(mocks.deterministic);
    expect(evaluator).not.toHaveBeenCalled();
  });

  it("degrades when workflow enumeration exceeds its fixed limit", async () => {
    const evaluator = vi.fn(async () => ({
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

    expect(await collect(evaluator)).toBe(mocks.deterministic);
    expect(evaluator).not.toHaveBeenCalled();
  });
});
