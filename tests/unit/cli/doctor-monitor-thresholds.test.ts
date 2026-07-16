/**
 * Runtime regression coverage for legacy monitor threshold diagnostics.
 *
 * Issue #1527 keeps legacy threshold configuration actionable while projects
 * migrate to provider-neutral key names. These tests exercise `runDoctor`
 * against real config files rather than checking implementation text.
 * @module tests/unit/cli/doctor-monitor-thresholds
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../../src/cli/doctor.js";

const COMMITTED_CONFIG = ".lisa.config.json";
const LOCAL_CONFIG = ".lisa.config.local.json";
const LEGACY_MIN_EVENTS = "monitor.thresholds.sentryMinEvents24h";
const CURRENT_MIN_EVENTS = "monitor.thresholds.minEvents24h";
const LEGACY_FAULT_RATE = "monitor.thresholds.xrayFaultRatePct";
const CURRENT_FAULT_RATE = "monitor.thresholds.faultRatePct";
const MONITOR_THRESHOLD_CHECK = "Monitor threshold keys current?";

let tempDir: string | undefined;

/**
 * Create one isolated project fixture.
 * @returns Temporary fixture path
 */
async function fixtureDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-monitor-"));
  return tempDir;
}

/**
 * Write JSON to a project configuration file.
 * @param fileName - Config file to write
 * @param value - JSON-compatible fixture value
 */
async function writeConfig(
  fileName: typeof COMMITTED_CONFIG | typeof LOCAL_CONFIG,
  value: unknown
): Promise<void> {
  const cwd = await fixtureDir();
  await writeFile(path.join(cwd, fileName), `${JSON.stringify(value)}\n`);
}

/**
 * Run doctor without network access or console output.
 * @returns Machine-readable doctor result
 */
async function doctor() {
  return runDoctor(
    await fixtureDir(),
    { offline: true },
    { runUpdateCheck: vi.fn(), setExitCode: vi.fn(), write: vi.fn() }
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("doctor legacy monitor threshold diagnostics (#1527)", () => {
  it("warns for legacy-only keys and names each exact replacement path", async () => {
    await writeConfig(COMMITTED_CONFIG, {
      monitor: {
        thresholds: {
          sentryMinEvents24h: 50,
          xrayFaultRatePct: 17,
        },
      },
    });

    const result = await doctor();
    const monitorKeyCheck = result.checks.find(check =>
      /monitor threshold/i.test(`${check.name} ${check.detail}`)
    );

    expect(monitorKeyCheck?.status).toBe("warn");
    expect(monitorKeyCheck?.detail).toContain(LEGACY_MIN_EVENTS);
    expect(monitorKeyCheck?.detail).toContain(CURRENT_MIN_EVENTS);
    expect(monitorKeyCheck?.detail).toContain(LEGACY_FAULT_RATE);
    expect(monitorKeyCheck?.detail).toContain(CURRENT_FAULT_RATE);
  });

  it("reports an OK monitor-key check for current-only keys", async () => {
    await writeConfig(COMMITTED_CONFIG, {
      monitor: {
        thresholds: { minEvents24h: 50, faultRatePct: 17 },
      },
    });

    const result = await doctor();
    const monitorKeyChecks = result.checks.filter(check =>
      /monitor threshold/i.test(`${check.name} ${check.detail}`)
    );

    expect(monitorKeyChecks).toContainEqual(
      expect.objectContaining({ status: "ok" })
    );
    expect(monitorKeyChecks).not.toContainEqual(
      expect.objectContaining({ status: "warn" })
    );
  });

  it("still warns when current and legacy keys coexist", async () => {
    await writeConfig(COMMITTED_CONFIG, {
      monitor: {
        thresholds: {
          minEvents24h: 3,
          sentryMinEvents24h: 50,
          faultRatePct: 4,
          xrayFaultRatePct: 17,
        },
      },
    });

    const result = await doctor();
    const warningText = result.checks
      .filter(check => check.status === "warn")
      .map(check => check.detail)
      .join("\n");

    expect(warningText).toContain(LEGACY_MIN_EVENTS);
    expect(warningText).toContain(CURRENT_MIN_EVENTS);
    expect(warningText).toContain(LEGACY_FAULT_RATE);
    expect(warningText).toContain(CURRENT_FAULT_RATE);
  });

  it("detects a legacy key that exists only in local configuration", async () => {
    await writeConfig(COMMITTED_CONFIG, {
      monitor: { thresholds: { minEvents24h: 3 } },
    });
    await writeConfig(LOCAL_CONFIG, {
      monitor: { thresholds: { xrayFaultRatePct: 17 } },
    });

    const result = await doctor();
    const warningText = result.checks
      .filter(check => check.status === "warn")
      .map(check => check.detail)
      .join("\n");

    expect(warningText).toContain(LEGACY_FAULT_RATE);
    expect(warningText).toContain(CURRENT_FAULT_RATE);
  });

  it("treats null-valued legacy keys as present own properties", async () => {
    await writeConfig(LOCAL_CONFIG, {
      monitor: { thresholds: { sentryMinEvents24h: null } },
    });

    const result = await doctor();
    const monitorKeyCheck = result.checks.find(
      check => check.name === MONITOR_THRESHOLD_CHECK
    );

    expect(monitorKeyCheck?.status).toBe("warn");
    expect(monitorKeyCheck?.detail).toContain(LEGACY_MIN_EVENTS);
    expect(monitorKeyCheck?.detail).toContain(CURRENT_MIN_EVENTS);
  });

  it("does not crash the added check when either config file is malformed", async () => {
    const cwd = await fixtureDir();
    await writeFile(path.join(cwd, COMMITTED_CONFIG), "{\n");
    await writeFile(path.join(cwd, LOCAL_CONFIG), "[\n");

    const result = await doctor();
    const monitorChecks = result.checks.filter(
      check => check.name === MONITOR_THRESHOLD_CHECK
    );

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "Project Lisa config present?",
        status: "fail",
      })
    );
    expect(monitorChecks).toHaveLength(1);
    expect(monitorChecks).toContainEqual(
      expect.objectContaining({
        name: MONITOR_THRESHOLD_CHECK,
        status: "warn",
        detail: expect.stringContaining(COMMITTED_CONFIG),
      })
    );
    expect(monitorChecks[0]?.detail).toContain(LOCAL_CONFIG);
    expect(monitorChecks).not.toContainEqual(
      expect.objectContaining({
        name: MONITOR_THRESHOLD_CHECK,
        status: "ok",
      })
    );
  });
});
