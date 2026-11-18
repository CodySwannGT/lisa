import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runHealth,
  type AgenticHealthEvaluation,
  type AgenticHealthEvaluator,
  type AgenticHealthJudgment,
  type AgenticHealthRequest,
} from "../../../src/health/agentic.js";
import type { HealthResult } from "../../../src/health/contract.js";
import {
  AGENTIC_COMPLETED_AT,
  AGENTIC_CONTEXT_CHECK,
  CONFIG_SYNC_CHECK,
  DETERMINISTIC_COMPLETED_AT,
  ESLINT_LOCAL_CONFIG_FILE,
  ESLINT_MANAGED_CONFIG_FILE,
  LISA_CONFIG_FILE,
  collect,
  deterministicResult,
  managedEslintDriftResult,
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
    const evaluator = vi.fn<AgenticHealthEvaluator>(async () => ({
      status: "completed",
      judgments: [],
    }));
    const disabled = await runHealth(projectRoot, {
      agentic: { enabled: false, evaluator },
    });
    const unavailable = await collect(projectRoot);

    expect(disabled).toBe(mocks.deterministic);
    expect(unavailable).toBe(mocks.deterministic);
    expect(evaluator).not.toHaveBeenCalled();
    expect(mocks.runDeterministic).toHaveBeenCalledTimes(2);
  });

  it("composes frozen, sorted, warning-only judgments after deterministic facts", async () => {
    let request: AgenticHealthRequest | undefined;
    const beforeConfig = await readFile(
      path.join(projectRoot, LISA_CONFIG_FILE),
      "utf8"
    );
    const result = await collect(projectRoot, async received => {
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
      // Reported so an evaluator can judge it. `null` is NOT off: an undeclared
      // gate still runs its built-in check, so this says "on Lisa's default",
      // never "not enforced".
      gates: { traceability: { level: null } },
    });
    expect(JSON.stringify(request)).not.toContain("config-secret");
    expect(JSON.stringify(request)).not.toContain(
      "managed-content-must-stay-gated"
    );
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request?.deterministicFindings)).toBe(true);
    expect(Object.isFrozen(request?.deterministicFindings[0])).toBe(true);
    expect(Object.isFrozen(request?.config.quality.mutation.gate)).toBe(true);
    expect(Object.isFrozen(request?.config.gates.traceability)).toBe(true);
    expect(Object.isFrozen(request?.artifacts)).toBe(true);
    expect(request?.artifacts.map(artifact => artifact.path)).toEqual([
      ".github/workflows/ci.yml",
      ESLINT_LOCAL_CONFIG_FILE,
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
      CONFIG_SYNC_CHECK,
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
      await readFile(path.join(projectRoot, LISA_CONFIG_FILE), "utf8")
    ).toBe(beforeConfig);
  });

  it("composes a full result when the evaluator is slower than the machine is fast", async () => {
    const result = await collect(projectRoot, async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 400);
      });
      return { status: "completed", judgments: [] };
    });

    expect(result.mode).toBe("full");
  });

  it("records a completed clean evaluation as full without fabricating a finding", async () => {
    const result = await collect(projectRoot, async () => ({
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
    await collect(projectRoot, evaluator);
    await writeFile(
      path.join(projectRoot, ".lisa.config.local.json"),
      JSON.stringify({ quality: { mutation: { gate: { enabled: true } } } })
    );
    await collect(projectRoot, evaluator);
    await rm(path.join(projectRoot, ".lisa.config.local.json"));
    await writeFile(
      path.join(projectRoot, LISA_CONFIG_FILE),
      JSON.stringify({ quality: { mutation: { gate: { enabled: true } } } })
    );
    await collect(projectRoot, evaluator);
    await writeFile(
      path.join(projectRoot, LISA_CONFIG_FILE),
      JSON.stringify({ quality: { mutation: { gate: { enabled: "false" } } } })
    );
    await collect(projectRoot, evaluator);
    await rm(path.join(projectRoot, LISA_CONFIG_FILE));
    await collect(projectRoot, evaluator);

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
    const result = await collect(projectRoot, async () => ({
      status: "completed",
      judgments: [
        { check: AGENTIC_CONTEXT_CHECK, reason: "Context needs review." },
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
      path.join(projectRoot, ESLINT_LOCAL_CONFIG_FILE),
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
      path.join(projectRoot, ESLINT_MANAGED_CONFIG_FILE),
      "export default ['benign-formatting-drift'];\n"
    );
    const benign = await collect(projectRoot, evaluator);
    await writeFile(
      path.join(projectRoot, ESLINT_MANAGED_CONFIG_FILE),
      "export default ['disable-security-rule'];\n"
    );
    const suspicious = await collect(projectRoot, evaluator);

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
