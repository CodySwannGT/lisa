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
const DEFAULT_EVOLVED = "default-evolved";

const LEGACY_MONITOR_DEFAULT = {
  maxCandidates: 20,
  gapTiers: "core",
  backoffHours: 24,
  thresholds: {
    sentryMinEvents24h: 10,
    errorRateSpikeMultiplier: 2,
    p95LatencyMs: 1000,
    xrayFaultRatePct: 5,
  },
};

const PROVIDER_NEUTRAL_MONITOR_DEFAULT = {
  maxCandidates: 20,
  gapTiers: "core",
  backoffHours: 24,
  thresholds: {
    minEvents24h: 1,
    errorRateSpikeMultiplier: 2,
    p95LatencyMs: 1000,
    faultRatePct: 5,
  },
};

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
    expect(report.actions.some(action => action.kind === DEFAULT_EVOLVED)).toBe(
      true
    );
  });

  it("migrates the recorded legacy monitor default to neutral keys exactly once", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      monitor: LEGACY_MONITOR_DEFAULT,
      _lisaSync: { populated: { monitor: LEGACY_MONITOR_DEFAULT } },
    });

    const dryRun = await runConfigSync(project.dir, { dryRun: true });
    expect(dryRun.actions).toContainEqual(
      expect.objectContaining({ key: "monitor", kind: DEFAULT_EVOLVED })
    );
    expect(await readConfig()).toEqual({
      monitor: LEGACY_MONITOR_DEFAULT,
      _lisaSync: { populated: { monitor: LEGACY_MONITOR_DEFAULT } },
    });

    const first = await runConfigSync(project.dir);

    const config = await readConfig();
    expect(config.monitor).toEqual(PROVIDER_NEUTRAL_MONITOR_DEFAULT);
    expect(
      (config._lisaSync as { populated: Record<string, unknown> }).populated
        .monitor
    ).toEqual(PROVIDER_NEUTRAL_MONITOR_DEFAULT);
    expect(first.actions).toContainEqual(
      expect.objectContaining({ key: "monitor", kind: DEFAULT_EVOLVED })
    );

    const second = await runConfigSync(project.dir);
    expect(second.actions).toEqual([]);
  });

  it("fills safe monitor defaults without shadowing a partial human legacy value", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      monitor: { thresholds: { sentryMinEvents24h: 50 } },
    });

    const report = await runConfigSync(project.dir);

    const monitor = (await readConfig()).monitor as Record<string, unknown>;
    expect(monitor).toMatchObject({
      maxCandidates: 20,
      gapTiers: "core",
      backoffHours: 24,
      thresholds: {
        sentryMinEvents24h: 50,
        faultRatePct: 5,
        errorRateSpikeMultiplier: 2,
        p95LatencyMs: 1000,
      },
    });
    expect(
      (monitor.thresholds as Record<string, unknown>).minEvents24h
    ).toBeUndefined();
    expect(report.actions).toContainEqual(
      expect.objectContaining({ key: "monitor", kind: "filled-missing" })
    );
  });

  it.each([
    ["has no provenance", undefined],
    ["differs from its recorded provenance", LEGACY_MONITOR_DEFAULT],
  ])(
    "preserves a human-chosen legacy monitor value when it %s",
    async (_scenario, recordedMonitor) => {
      const humanMonitor = {
        ...LEGACY_MONITOR_DEFAULT,
        thresholds: {
          ...LEGACY_MONITOR_DEFAULT.thresholds,
          sentryMinEvents24h: 50,
          xrayFaultRatePct: 12,
        },
      };
      await writeJson(path.join(project.dir, CONFIG), {
        monitor: humanMonitor,
        ...(recordedMonitor === undefined
          ? {}
          : { _lisaSync: { populated: { monitor: recordedMonitor } } }),
      });

      const report = await runConfigSync(project.dir);

      const config = await readConfig();
      expect(config.monitor).toEqual(humanMonitor);
      expect(report.actions.filter(action => action.key === "monitor")).toEqual(
        []
      );
    }
  );

  it("preserves conflicting legacy aliases while current monitor keys remain authoritative", async () => {
    const bothKeyMonitor = {
      ...PROVIDER_NEUTRAL_MONITOR_DEFAULT,
      thresholds: {
        ...PROVIDER_NEUTRAL_MONITOR_DEFAULT.thresholds,
        sentryMinEvents24h: 99,
        xrayFaultRatePct: 33,
      },
    };
    await writeJson(path.join(project.dir, CONFIG), {
      monitor: bothKeyMonitor,
    });

    const report = await runConfigSync(project.dir);

    const config = await readConfig();
    expect(config.monitor).toEqual(bothKeyMonitor);
    expect(report.actions.filter(action => action.key === "monitor")).toEqual(
      []
    );
  });

  it.each([
    ["an unrelated override", { maxCandidates: 7 }, true],
    ["a current-key override", { thresholds: { minEvents24h: 7 } }, true],
    ["a legacy-key override", { thresholds: { sentryMinEvents24h: 7 } }, false],
  ])(
    "handles recorded monitor provenance with local %s",
    async (_scenario, localMonitor, shouldEvolve) => {
      const local = { monitor: localMonitor };
      await writeJson(path.join(project.dir, CONFIG), {
        monitor: LEGACY_MONITOR_DEFAULT,
        _lisaSync: { populated: { monitor: LEGACY_MONITOR_DEFAULT } },
      });
      await writeJson(path.join(project.dir, LOCAL_CONFIG), local);

      const report = await runConfigSync(project.dir);

      expect((await readConfig()).monitor).toEqual(
        shouldEvolve ? PROVIDER_NEUTRAL_MONITOR_DEFAULT : LEGACY_MONITOR_DEFAULT
      );
      expect(await readJson(path.join(project.dir, LOCAL_CONFIG))).toEqual(
        local
      );
      expect(
        report.actions.some(
          action => action.key === "monitor" && action.kind === DEFAULT_EVOLVED
        )
      ).toBe(shouldEvolve);
    }
  );

  it("does not copy explicit local-only legacy aliases into committed config", async () => {
    const local = {
      monitor: {
        thresholds: { sentryMinEvents24h: 0, xrayFaultRatePct: null },
      },
    };
    await writeJson(path.join(project.dir, LOCAL_CONFIG), local);

    const report = await runConfigSync(project.dir);

    expect((await readConfig()).monitor).toBeUndefined();
    expect(report.actions.filter(action => action.key === "monitor")).toEqual(
      []
    );
    expect(await readJson(path.join(project.dir, LOCAL_CONFIG))).toEqual(local);
  });

  it("dry-run reports actions without writing anything", async () => {
    const report = await runConfigSync(project.dir, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.actions.length).toBeGreaterThan(0);
    const config = await readJsonOrNull(path.join(project.dir, CONFIG));
    expect(config).toBeNull();
  });
});
