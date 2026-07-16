import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConfigSync } from "../../../src/sync/config-sync.js";
import { readJson, writeJson } from "../../../src/utils/index.js";

const CONFIG = ".lisa.config.json";

/** Holder for the per-test temp project directory. */
interface TempProject {
  dir: string;
}

const project: TempProject = { dir: "" };

beforeEach(async () => {
  project.dir = await mkdtemp(path.join(tmpdir(), "lisa-sync-legacy-"));
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

describe("runConfigSync — legacy monitor threshold migration", () => {
  it("migrates auto-populated legacy monitor thresholds to provider-neutral keys", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      monitor: {
        thresholds: {
          sentryMinEvents24h: 1,
          xrayFaultRatePct: 5,
        },
      },
      _lisaSync: {
        populated: {
          "monitor.thresholds.sentryMinEvents24h": 1,
          "monitor.thresholds.xrayFaultRatePct": 5,
        },
      },
    });

    const report = await runConfigSync(project.dir);

    const config = await readConfig();
    expect(config.monitor).toMatchObject({
      thresholds: {
        minEvents24h: 1,
        faultRatePct: 5,
      },
    });
    const thresholds = (config.monitor as Record<string, unknown>)
      .thresholds as Record<string, unknown>;
    expect(thresholds.sentryMinEvents24h).toBeUndefined();
    expect(thresholds.xrayFaultRatePct).toBeUndefined();
    const meta = config._lisaSync as { populated: Record<string, unknown> };
    expect(meta.populated["monitor.thresholds.minEvents24h"]).toBe(1);
    expect(meta.populated["monitor.thresholds.faultRatePct"]).toBe(5);
    expect(
      meta.populated["monitor.thresholds.sentryMinEvents24h"]
    ).toBeUndefined();
    expect(
      meta.populated["monitor.thresholds.xrayFaultRatePct"]
    ).toBeUndefined();
    expect(
      report.actions.filter(action => action.kind === "default-evolved")
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "monitor.thresholds.minEvents24h" }),
        expect.objectContaining({ key: "monitor.thresholds.faultRatePct" }),
      ])
    );
  });

  it("does not shadow a human-chosen legacy monitor threshold with a current default", async () => {
    await writeJson(path.join(project.dir, CONFIG), {
      monitor: {
        thresholds: {
          sentryMinEvents24h: 50,
          xrayFaultRatePct: 12,
        },
      },
    });

    await runConfigSync(project.dir);

    const config = await readConfig();
    const thresholds = (config.monitor as Record<string, unknown>)
      .thresholds as Record<string, unknown>;
    expect(thresholds.sentryMinEvents24h).toBe(50);
    expect(thresholds.xrayFaultRatePct).toBe(12);
    expect(thresholds.minEvents24h).toBeUndefined();
    expect(thresholds.faultRatePct).toBeUndefined();
  });
});
