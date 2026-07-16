import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

const MONITOR_THRESHOLD_CONFIG_CHECK_NAME = "Monitor threshold keys current?";

const CONFIG_FILES = [".lisa.config.json", ".lisa.config.local.json"] as const;

const LEGACY_MONITOR_THRESHOLDS = [
  {
    legacy: "monitor.thresholds.sentryMinEvents24h",
    current: "monitor.thresholds.minEvents24h",
    property: "sentryMinEvents24h",
  },
  {
    legacy: "monitor.thresholds.xrayFaultRatePct",
    current: "monitor.thresholds.faultRatePct",
    property: "xrayFaultRatePct",
  },
] as const;

/** Result of inspecting one optional config file. */
interface ConfigInspection {
  findings: string[];
  uninspectable?: string;
}

/**
 * Return an object-shaped value as a string-keyed record.
 * @param value - Value to narrow
 * @returns Record for objects, otherwise undefined
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Find legacy monitor threshold keys in one raw config file.
 * Parse failures are reported by doctor's existing project-config check.
 * @param targetPath - Project path to inspect
 * @param fileName - Raw config file to inspect
 * @returns Legacy-path migration findings
 */
async function legacyFindingsForFile(
  targetPath: string,
  fileName: (typeof CONFIG_FILES)[number]
): Promise<ConfigInspection> {
  const configPath = path.join(targetPath, fileName);
  if (!existsSync(configPath)) return { findings: [] };

  try {
    const config = asRecord(JSON.parse(await readFile(configPath, "utf8")));
    const monitor = asRecord(config?.["monitor"]);
    const thresholds = asRecord(monitor?.["thresholds"]);

    return {
      findings: LEGACY_MONITOR_THRESHOLDS.filter(threshold =>
        Object.hasOwn(thresholds ?? {}, threshold.property)
      ).map(
        threshold => `${fileName}: ${threshold.legacy} -> ${threshold.current}`
      ),
    };
  } catch {
    return { findings: [], uninspectable: fileName };
  }
}

/**
 * Find legacy monitor keys in committed and local config independently.
 * @param targetPath - Project path to inspect
 * @returns One named doctor check result
 */
export async function checkLegacyMonitorThresholds(
  targetPath: string
): Promise<{
  name: string;
  status: "ok" | "warn";
  detail: string;
}> {
  const inspections = await Promise.all(
    CONFIG_FILES.map(fileName => legacyFindingsForFile(targetPath, fileName))
  );
  const findings = inspections.flatMap(inspection => inspection.findings);
  const uninspectable = inspections.flatMap(inspection =>
    inspection.uninspectable ? [inspection.uninspectable] : []
  );

  return findings.length === 0 && uninspectable.length === 0
    ? {
        name: MONITOR_THRESHOLD_CONFIG_CHECK_NAME,
        status: "ok",
        detail: "No legacy monitor threshold keys found",
      }
    : {
        name: MONITOR_THRESHOLD_CONFIG_CHECK_NAME,
        status: "warn",
        detail: [
          findings.length > 0
            ? `Replace legacy monitor threshold keys: ${findings.join(", ")}`
            : undefined,
          uninspectable.length > 0
            ? `Could not inspect monitor threshold keys in: ${uninspectable.join(", ")}`
            : undefined,
        ]
          .filter((message): message is string => message !== undefined)
          .join(". "),
      };
}
