import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConfigSync } from "../../../src/sync/config-sync.js";
import {
  readJson,
  readJsonOrNull,
  writeJson,
} from "../../../src/utils/index.js";

const CONFIG = ".lisa.config.json";
const LOCAL_CONFIG = ".lisa.config.local.json";
const VITEST_THRESHOLDS = "vitest.thresholds.json";
const project = { dir: "" };

beforeEach(async () => {
  project.dir = await mkdtemp(path.join(tmpdir(), "lisa-sync-artifacts-"));
});

afterEach(async () => {
  await rm(project.dir, { recursive: true, force: true });
});

describe("runConfigSync — sync direction (config wins)", () => {
  it("overwrites an existing artifact file from the config value", async () => {
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

    const report = await runConfigSync(project.dir);

    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, VITEST_THRESHOLDS)
    );
    expect(artifact).toEqual({
      global: { statements: 92, branches: 91, functions: 90, lines: 93 },
    });
    expect(
      report.actions.some(action => action.kind === "artifact-synced")
    ).toBe(true);
  });

  it("writes a pointered value without disturbing sibling keys", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      quality: {
        mutation: { strykerThresholds: { high: 90, low: 70, break: 65 } },
      },
    });
    await writeJson(path.join(project.dir, "stryker.conf.json"), {
      testRunner: "vitest",
      thresholds: { high: 80, low: 60, break: 60 },
    });

    await runConfigSync(project.dir);

    const artifact = await readJson<Record<string, unknown>>(
      path.join(project.dir, "stryker.conf.json")
    );
    expect(artifact.testRunner).toBe("vitest");
    expect(artifact.thresholds).toEqual({ high: 90, low: 70, break: 65 });
  });

  it("never scaffolds an artifact file that does not exist", async () => {
    await runConfigSync(project.dir);

    const artifact = await readJsonOrNull(
      path.join(project.dir, VITEST_THRESHOLDS)
    );
    expect(artifact).toBeNull();
  });

  it("prefers the local overlay value when writing artifacts", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      quality: { lintBudgets: { cognitiveComplexity: 10 } },
    });
    await writeJson(path.join(project.dir, LOCAL_CONFIG), {
      quality: { lintBudgets: { cognitiveComplexity: 25 } },
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
    expect(artifact.cognitiveComplexity).toBe(25);
  });
});
