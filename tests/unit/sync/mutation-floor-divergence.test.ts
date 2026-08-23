/**
 * The mutation-score floor lives in two files. `stryker.conf.json` is the only
 * partial sync binding in the registry (pointer `thresholds`; every other
 * artifact is written wholesale), and it is the only one that ever drifted.
 * These tests pin the failure path: a sync that finds the two floors disagreeing
 * must refuse and name both values, and must leave the five wholesale artifacts
 * behaving exactly as before.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConfigSync } from "../../../src/sync/config-sync.js";
import { MutationFloorDivergenceError } from "../../../src/sync/stryker-thresholds-ownership.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { readJson, writeJson } from "../../../src/utils/index.js";

const CONFIG = ".lisa.config.json";
const STRYKER = "stryker.conf.json";
const VITEST_THRESHOLDS = "vitest.thresholds.json";
const project = { dir: "" };

beforeEach(async () => {
  project.dir = await mkdtemp(path.join(tmpdir(), "lisa-mutation-floor-"));
});

afterEach(async () => {
  await rm(project.dir, { recursive: true, force: true });
});

const REASON =
  "deferred until the true aggregate score is measurable; see the tracked blocker";

/**
 * Write a project whose two mutation floors disagree.
 * @param enforced - Value carried by stryker.conf.json
 * @param declared - Value carried by .lisa.config.json
 * @param declaration - Optional `_thresholdsDivergence` block
 */
async function writeDivergedProject(
  enforced: Record<string, number>,
  declared: Record<string, number>,
  declaration?: Record<string, unknown>
): Promise<void> {
  await writeJson(path.join(project.dir, CONFIG), {
    quality: { mutation: { strykerThresholds: declared } },
  });
  await writeJson(path.join(project.dir, STRYKER), {
    testRunner: "vitest",
    ...(declaration === undefined
      ? {}
      : { _thresholdsDivergence: declaration }),
    thresholds: enforced,
  });
}

describe("runConfigSync — the two mutation floors cannot silently disagree", () => {
  it("fails instead of writing when the declared floor differs from the enforced one", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 60, break: 60 }
    );

    await expect(runConfigSync(project.dir)).rejects.toBeInstanceOf(
      MutationFloorDivergenceError
    );
  });

  it("names both values and the file each came from", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 60, break: 60 }
    );

    const message = await runConfigSync(project.dir).then(
      () => "sync did not fail",
      (error: unknown) => (error as Error).message
    );

    expect(message).toContain(".lisa.config.json");
    expect(message).toContain("quality.mutation.strykerThresholds");
    expect(message).toContain(STRYKER);
    expect(message).toContain("thresholds");
    expect(message).toContain('"break":60');
    expect(message).toContain('"break":32');
  });

  it("leaves the diverged floor on disk untouched", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 60, break: 60 }
    );

    await runConfigSync(project.dir).catch(() => undefined);

    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, STRYKER)
    );
    expect(artifact.thresholds).toEqual({ high: 80, low: 40, break: 32 });
  });

  it("fails on a dry run too — a dry run that reports success would be the same silence", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 60, break: 60 }
    );

    await expect(
      runConfigSync(project.dir, { dryRun: true })
    ).rejects.toBeInstanceOf(MutationFloorDivergenceError);
  });

  it("proceeds unchanged when the two floors are equal", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 40, break: 32 }
    );

    const report = await runConfigSync(project.dir);

    expect(
      report.actions.some(
        action =>
          action.kind === "artifact-synced" && action.detail.includes(STRYKER)
      )
    ).toBe(false);
    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, STRYKER)
    );
    expect(artifact.thresholds).toEqual({ high: 80, low: 40, break: 32 });
    expect(artifact.testRunner).toBe("vitest");
  });

  it("still populates a stryker.conf.json that carries no thresholds, keeping siblings", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      quality: {
        mutation: { strykerThresholds: { high: 90, low: 70, break: 65 } },
      },
    });
    await writeJson(path.join(project.dir, STRYKER), { testRunner: "vitest" });

    await runConfigSync(project.dir);

    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, STRYKER)
    );
    expect(artifact.testRunner).toBe("vitest");
    expect(artifact.thresholds).toEqual({ high: 90, low: 70, break: 65 });
  });
});

describe("a recorded divergence is honoured, not blocked", () => {
  it("completes the sync and leaves the enforced floor alone", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 60, break: 60 },
      {
        reason: REASON,
        enforced: { high: 80, low: 40, break: 32 },
        declared: { high: 80, low: 60, break: 60 },
      }
    );

    const report = await runConfigSync(project.dir);

    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, STRYKER)
    );
    expect(artifact.thresholds).toEqual({ high: 80, low: 40, break: 32 });
    expect(report.actions.map(action => action.kind)).toContain(
      "divergence-honoured"
    );
  });

  it("says so, naming both values and the recorded reason", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 60, break: 60 },
      {
        reason: REASON,
        enforced: { high: 80, low: 40, break: 32 },
        declared: { high: 80, low: 60, break: 60 },
      }
    );

    const report = await runConfigSync(project.dir);

    const detail =
      report.actions.find(action => action.kind === "divergence-honoured")
        ?.detail ?? "";
    expect(detail).toContain('"break":32');
    expect(detail).toContain('"break":60');
    expect(detail).toContain(REASON);
  });

  it("does not exempt a declaration that no longer records the enforced floor", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 20 },
      { high: 80, low: 60, break: 60 },
      {
        reason: REASON,
        enforced: { high: 80, low: 40, break: 32 },
        declared: { high: 80, low: 60, break: 60 },
      }
    );

    await expect(runConfigSync(project.dir)).rejects.toBeInstanceOf(
      MutationFloorDivergenceError
    );
  });

  it("does not exempt a declaration that no longer records the declared floor", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 60, break: 55 },
      {
        reason: REASON,
        enforced: { high: 80, low: 40, break: 32 },
        declared: { high: 80, low: 60, break: 60 },
      }
    );

    await expect(runConfigSync(project.dir)).rejects.toBeInstanceOf(
      MutationFloorDivergenceError
    );
  });

  it("does not exempt a declaration carrying no reason", async () => {
    await writeDivergedProject(
      { high: 80, low: 40, break: 32 },
      { high: 80, low: 60, break: 60 },
      {
        enforced: { high: 80, low: 40, break: 32 },
        declared: { high: 80, low: 60, break: 60 },
      }
    );

    await expect(runConfigSync(project.dir)).rejects.toBeInstanceOf(
      MutationFloorDivergenceError
    );
  });
});

describe("the guard is one instance, not general machinery", () => {
  it("stryker.conf.json is the registry's only partial artifact binding", () => {
    const partial = SYNC_REGISTRY.flatMap(entry =>
      (entry.artifacts ?? [])
        .filter(binding => binding.pointer !== "")
        .map(binding => `${entry.key} -> ${binding.file}#${binding.pointer}`)
    );

    expect(partial).toEqual([
      "quality.mutation.strykerThresholds -> stryker.conf.json#thresholds",
    ]);
  });

  it("still overwrites a diverged wholesale artifact without failing", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      quality: {
        testCoverage: {
          global: { statements: 92, branches: 91, functions: 90, lines: 93 },
        },
      },
    });
    await writeJson(path.join(project.dir, VITEST_THRESHOLDS), {
      global: { statements: 70, branches: 70, functions: 70, lines: 70 },
    });

    await runConfigSync(project.dir);

    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, VITEST_THRESHOLDS)
    );
    expect(artifact.global).toEqual({
      statements: 92,
      branches: 91,
      functions: 90,
      lines: 93,
    });
  });

  it("still overwrites a diverged lint-budget artifact without failing", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      quality: {
        lintBudgets: {
          cognitiveComplexity: 12,
          maxLines: 400,
          maxLinesPerFunction: 80,
        },
      },
    });
    await writeJson(path.join(project.dir, "eslint.thresholds.json"), {
      cognitiveComplexity: 10,
      maxLines: 300,
      maxLinesPerFunction: 75,
    });

    await runConfigSync(project.dir);

    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, "eslint.thresholds.json")
    );
    expect(artifact.cognitiveComplexity).toBe(12);
  });

  it("still overwrites a diverged mutation-gate artifact without failing", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      quality: { mutation: { gate: { enabled: true, since: "main" } } },
    });
    await writeJson(path.join(project.dir, "mutation.gate.json"), {
      enabled: false,
      since: "main",
    });

    await runConfigSync(project.dir);

    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, "mutation.gate.json")
    );
    expect(artifact.enabled).toBe(true);
  });
});
