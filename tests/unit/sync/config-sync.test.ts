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

/** Holder for the per-test temp project directory. */
interface TempProject {
  dir: string;
}

const project: TempProject = { dir: "" };

beforeEach(async () => {
  project.dir = await mkdtemp(path.join(tmpdir(), "lisa-sync-"));
});

afterEach(async () => {
  await rm(project.dir, { recursive: true, force: true });
});

/**
 * Read the committed config from the temp project.
 * @returns Parsed config object
 */
async function readConfig(): Promise<Record<string, unknown>> {
  return readJson<Record<string, unknown>>(path.join(project.dir, CONFIG));
}

describe("runConfigSync — populate direction", () => {
  it("populates built-in defaults into an empty project and records provenance", async () => {
    const report = await runConfigSync(project.dir);

    const config = await readConfig();
    expect(config.harness).toBe("claude");
    expect(config.quality).toMatchObject({
      testCoverage: {
        global: { statements: 70, branches: 70, functions: 70, lines: 70 },
      },
      lintBudgets: {
        cognitiveComplexity: 10,
        maxLines: 300,
        maxLinesPerFunction: 75,
      },
    });
    const meta = config._lisaSync as { populated: Record<string, unknown> };
    expect(meta.populated["quality.testCoverage"]).toBeDefined();
    expect(
      report.actions.filter(action => action.kind === "populated-default")
        .length
    ).toBeGreaterThan(0);
  });

  it("absorbs an existing artifact value instead of the default when config is missing it", async () => {
    await writeJson(path.join(project.dir, VITEST_THRESHOLDS), {
      global: { statements: 85, branches: 80, functions: 82, lines: 88 },
    });

    const report = await runConfigSync(project.dir);

    const config = await readConfig();
    expect(config.quality).toMatchObject({
      testCoverage: {
        global: { statements: 85, branches: 80, functions: 82, lines: 88 },
      },
    });
    const meta = config._lisaSync as { populated: Record<string, unknown> };
    expect(meta.populated["quality.testCoverage"]).toBeUndefined();
    expect(
      report.actions.some(action => action.kind === "absorbed-artifact")
    ).toBe(true);
  });

  it("does not populate vendor sections the project does not use", async () => {
    await writeJson(path.join(project.dir, CONFIG), { tracker: "jira" });

    await runConfigSync(project.dir);

    const config = await readConfig();
    expect(config.jira).toMatchObject({ workflow: { ready: "Ready" } });
    expect(config.github).toBeUndefined();
    expect(config.linear).toBeUndefined();
    expect(config.notion).toBeUndefined();
  });

  it("fills only the missing sub-keys of a partially configured object", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      quality: { testCoverage: { global: { statements: 90 } } },
    });

    await runConfigSync(project.dir);

    const config = await readConfig();
    expect(config.quality).toMatchObject({
      testCoverage: {
        global: { statements: 90, branches: 70, functions: 70, lines: 70 },
      },
    });
  });

  it("reports required keys it cannot default", async () => {
    const report = await runConfigSync(project.dir);

    expect(report.missingRequired.map(missing => missing.key)).toContain(
      "tracker"
    );
  });
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

describe("runConfigSync — default evolution and idempotency", () => {
  it("is idempotent: a second run reports no actions", async () => {
    await runConfigSync(project.dir);

    const second = await runConfigSync(project.dir);

    expect(second.actions).toEqual([]);
  });

  it("leaves a user-chosen value alone even when it differs from the default", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      quality: {
        lintBudgets: {
          cognitiveComplexity: 20,
          maxLines: 400,
          maxLinesPerFunction: 100,
        },
      },
    });

    await runConfigSync(project.dir);

    const config = await readConfig();
    expect(config.quality).toMatchObject({
      lintBudgets: { cognitiveComplexity: 20, maxLines: 400 },
    });
  });

  it("updates an auto-populated value when the recorded default evolves", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      wiki: { source: { path: "wiki" }, ttlSeconds: 120 },
      _lisaSync: { populated: { "wiki.ttlSeconds": 120 } },
    });

    const report = await runConfigSync(project.dir);

    const config = await readConfig();
    expect((config.wiki as Record<string, unknown>).ttlSeconds).toBe(300);
    expect(
      report.actions.some(action => action.kind === "default-evolved")
    ).toBe(true);
  });

  it("dry-run reports actions without writing anything", async () => {
    const report = await runConfigSync(project.dir, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.actions.length).toBeGreaterThan(0);
    const config = await readJsonOrNull(path.join(project.dir, CONFIG));
    expect(config).toBeNull();
  });
});
