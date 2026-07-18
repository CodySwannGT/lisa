/**
 * Parse the project's calling `ci.yml` quality workflow inputs.
 * @module cli/ui-ci-quality-jobs-parse
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import { isJsonObject } from "../sync/json-path.js";
import type { CiWorkflowInputs } from "./ui-ci-quality-jobs-compute.js";

/**
 * Read `ci.yml` from the project workflows directory.
 * @param cwd - Project root
 * @returns File contents
 */
export async function readCiYmlFile(cwd: string): Promise<string> {
  return await readFile(
    path.join(cwd, ".github", "workflows", "ci.yml"),
    "utf8"
  );
}

/**
 * Split a comma-separated skip_jobs string into trimmed non-empty ids.
 * @param raw - Raw skip_jobs value from YAML
 * @returns Normalized job ids
 */
function parseSkipJobs(raw: unknown): readonly string[] {
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

/**
 * Coerce a YAML scalar to boolean with an explicit default.
 * @param value - Candidate YAML value
 * @param fallback - Default when absent or unreadable
 * @returns Boolean
 */
function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

/**
 * Coerce a YAML scalar to a trimmed string with a default.
 * @param value - Candidate YAML value
 * @param fallback - Default when absent
 * @returns String
 */
function asString(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

/**
 * Find the `with:` map on the job that calls Lisa's quality workflow.
 * @param document - Parsed ci.yml root
 * @returns The with-block object, or undefined
 */
function qualityWithBlock(
  document: unknown
): Record<string, unknown> | undefined {
  if (!isJsonObject(document) || !isJsonObject(document.jobs)) {
    return undefined;
  }
  for (const job of Object.values(document.jobs)) {
    if (!isJsonObject(job) || typeof job.uses !== "string") {
      continue;
    }
    if (
      !job.uses.includes("quality.yml") &&
      !job.uses.includes("quality-rails.yml")
    ) {
      continue;
    }
    if (isJsonObject(job.with)) {
      return job.with as Record<string, unknown>;
    }
    return {};
  }
  return undefined;
}

/**
 * Parse the project's calling `ci.yml` into quality workflow inputs.
 * @param cwd - Project root
 * @param readCiYml - Injectable file reader
 * @returns Normalized inputs
 */
export async function parseCiWorkflowInputs(
  cwd: string,
  readCiYml: (projectRoot: string) => Promise<string> = readCiYmlFile
): Promise<CiWorkflowInputs> {
  const source = await readCiYml(cwd);
  const document: unknown = yaml.load(source);
  const withBlock = qualityWithBlock(document);
  if (withBlock === undefined) {
    throw new Error(
      "ci.yml does not call quality.yml or quality-rails.yml with a with-block"
    );
  }
  return {
    skipJobs: parseSkipJobs(withBlock.skip_jobs),
    verifyEnforced: asBoolean(withBlock.verify_enforced, false),
    complianceFramework: asString(
      withBlock.compliance_framework,
      "none"
    ).toLowerCase(),
    requireApproval: asBoolean(withBlock.require_approval, false),
    zapTargetUrl: asString(withBlock.zap_target_url, ""),
  };
}
