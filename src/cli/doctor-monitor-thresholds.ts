import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { DoctorCheck } from "./doctor.js";

const CHECK_NAME = "Monitor threshold keys current?";
const COMMITTED_CONFIG = ".lisa.config.json";
const LOCAL_CONFIG = ".lisa.config.local.json";
const MONITOR_THRESHOLDS_PREFIX = "monitor.thresholds.";
const LEGACY_MONITOR_THRESHOLD_KEYS = [
  {
    legacy: `${MONITOR_THRESHOLDS_PREFIX}sentryMinEvents24h`,
    replacement: `${MONITOR_THRESHOLDS_PREFIX}minEvents24h`,
  },
  {
    legacy: `${MONITOR_THRESHOLDS_PREFIX}xrayFaultRatePct`,
    replacement: `${MONITOR_THRESHOLDS_PREFIX}faultRatePct`,
  },
] as const;

/**
 * Safely parse a Lisa config file for non-blocking advisory checks.
 * @param configPath - Config path to parse
 * @returns Parsed config or undefined when unavailable/malformed
 */
async function readConfigForAdvisoryCheck(
  configPath: string
): Promise<unknown | undefined> {
  if (!existsSync(configPath)) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Determine whether an object owns a dotted config path.
 * @param value - Object to inspect
 * @param segments - Config key path segments
 * @returns True when every segment exists as an own property
 */
function hasConfigPathSegments(value: unknown, segments: string[]): boolean {
  if (segments.length === 0) {
    return true;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const segment = segments[0];
  const remaining = segments.slice(1);
  if (segment === undefined) {
    return true;
  }
  if (!Object.prototype.hasOwnProperty.call(value, segment)) {
    return false;
  }
  return hasConfigPathSegments(
    (value as Record<string, unknown>)[segment],
    remaining
  );
}

/**
 * Determine whether an object owns a dotted config path.
 * @param value - Object to inspect
 * @param dottedPath - Dot-separated config key path
 * @returns True when every segment exists as an own property
 */
function hasConfigPath(value: unknown, dottedPath: string): boolean {
  return hasConfigPathSegments(value, dottedPath.split("."));
}

/**
 * Warn when projects still carry deprecated monitor threshold keys.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkLegacyMonitorThresholds(
  targetPath: string
): Promise<DoctorCheck> {
  const configs = await Promise.all(
    [COMMITTED_CONFIG, LOCAL_CONFIG].map(async fileName => ({
      fileName,
      config: await readConfigForAdvisoryCheck(path.join(targetPath, fileName)),
    }))
  );
  const findings = configs.flatMap(({ fileName, config }) =>
    LEGACY_MONITOR_THRESHOLD_KEYS.filter(({ legacy }) =>
      hasConfigPath(config, legacy)
    ).map(
      ({ legacy, replacement }) => `${fileName}: ${legacy} -> ${replacement}`
    )
  );

  if (findings.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No legacy monitor threshold keys present",
    };
  }

  return {
    name: CHECK_NAME,
    status: "warn",
    detail: `Legacy monitor threshold keys found; migrate ${findings.join(", ")}`,
  };
}
