import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { createDetectorRegistry } from "../detection/index.js";
import type { DoctorCheck } from "./doctor.js";

const PROJECT_TYPE_CHECK = "Project type detection";
const LISA_CONFIG = ".lisa.config.json";
const LISA_LOCAL_CONFIG = ".lisa.config.local.json";

/**
 * Detect the target project type, including an explicitly configured wiki
 * wrapper that intentionally has no software-stack marker.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkProjectType(
  targetPath: string
): Promise<DoctorCheck> {
  const detectorRegistry = createDetectorRegistry();
  const detectedTypes = detectorRegistry.expandAndOrderTypes(
    await detectorRegistry.detectAll(targetPath)
  );
  if (detectedTypes.length > 0) {
    return {
      name: PROJECT_TYPE_CHECK,
      status: "ok",
      detail: detectedTypes.join(", "),
    };
  }

  const wikiSource = await detectDeclaredWikiSource(targetPath);
  return wikiSource === null
    ? {
        name: PROJECT_TYPE_CHECK,
        status: "warn",
        detail: "No Lisa project type detected",
      }
    : {
        name: PROJECT_TYPE_CHECK,
        status: "ok",
        detail: `wiki (${wikiSource})`,
      };
}

/**
 * Detect a configured embedded-wiki shape without promoting `wiki` into the
 * software-stack template hierarchy. Malformed config remains the dedicated
 * project-config check's failure and never becomes a project-type pass here.
 * @param targetPath - Project path to inspect
 * @returns A human-readable wiki source kind, or null when undeclared
 */
async function detectDeclaredWikiSource(
  targetPath: string
): Promise<"local source" | "remote source" | null> {
  const configPaths = [LISA_LOCAL_CONFIG, LISA_CONFIG].map(fileName =>
    path.join(targetPath, fileName)
  );
  for (const configPath of configPaths) {
    const source = await readWikiSource(configPath);
    if (isNonEmptyString(source?.path)) return "local source";
    if (isNonEmptyString(source?.url)) return "remote source";
  }
  return null;
}

/**
 * Read the wiki source object from one config file.
 * @param configPath - Absolute config path
 * @returns The wiki source record, or null when absent or invalid
 */
async function readWikiSource(
  configPath: string
): Promise<Record<string, unknown> | null> {
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    if (!isObjectRecord(parsed) || !isObjectRecord(parsed.wiki)) return null;
    return isObjectRecord(parsed.wiki.source) ? parsed.wiki.source : null;
  } catch {
    return null;
  }
}

/**
 * Return true for a non-array object record.
 * @param value - Value to classify
 * @returns Whether the value is an object record
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Return true for a non-empty string after trimming.
 * @param value - Value to classify
 * @returns Whether the value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
