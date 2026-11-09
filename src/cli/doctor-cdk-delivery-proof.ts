/**
 * `lisa doctor` check: can this CDK host prove that a change was delivered?
 *
 * Lisa closes a work item only when its completion record proves delivery,
 * and the mechanism that proves it is declared under
 * `verification.completion.delivery.<env>`. A CDK app's GitHub Actions
 * workflow releases but does not deploy — CodePipeline does — so a CDK host
 * with no declaration has nothing Lisa can verify, and every lifecycle
 * completion stops at pending-proof with no hint of what to set
 * (CodySwannGT/lisa#4646).
 *
 * This check REPORTS and names the setting. It edits nothing: the delivery
 * declaration names a real pipeline, which only the host knows. A config that
 * cannot be parsed is reported as uninspected rather than passed, matching
 * the monitor-threshold check; doctor's project-config check owns the parse
 * failure itself.
 * @module cli/doctor-cdk-delivery-proof
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { CDK_APP_MARKER } from "../core/cdk-preset-adoption.js";
import type { DoctorCheck } from "./doctor.js";

/** Name of the delivery-proof check as doctor reports it. */
export const CDK_DELIVERY_PROOF_CHECK_NAME = "CDK delivery proof configured?";

const CONFIG_FILES = [".lisa.config.json", ".lisa.config.local.json"] as const;
const SETTING = "verification.completion.delivery";
const CODEPIPELINE = "aws-codepipeline";

/** Operator-facing remedy for a CDK host with no delivery declaration. */
const MISSING_DETAIL =
  `This CDK project declares no ${SETTING}.<env>, so lifecycle completion ` +
  "cannot prove a change was delivered and stops at pending-proof. Declare " +
  `the pipeline that delivers each environment, e.g. ${SETTING}.production = ` +
  `{ "mechanism": "${CODEPIPELINE}", "pipeline_name": "<your pipeline>", ` +
  '"region": "<aws-region>" }, and give verification read-only ' +
  "codepipeline:GetPipelineExecution access";

/** One config file's delivery declarations, or why it could not be read. */
interface Inspection {
  environments: Record<string, unknown>;
  uninspectable?: string;
}

/**
 * Narrow an object-shaped value to a string-keyed record.
 * @param value - Value to narrow
 * @returns Record for plain objects, otherwise undefined
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read `verification.completion.delivery` from one optional config file.
 * @param targetPath - Project root
 * @param fileName - Config file to read
 * @returns Declared environments, or the file name when it could not be parsed
 */
async function inspect(
  targetPath: string,
  fileName: (typeof CONFIG_FILES)[number]
): Promise<Inspection> {
  const configPath = path.join(targetPath, fileName);
  if (!existsSync(configPath)) return { environments: {} };
  try {
    const config = asRecord(JSON.parse(await readFile(configPath, "utf8")));
    const verification = asRecord(config?.["verification"]);
    const completion = asRecord(verification?.["completion"]);
    return { environments: asRecord(completion?.["delivery"]) ?? {} };
  } catch {
    return { environments: {}, uninspectable: fileName };
  }
}

/**
 * Settings a declared CodePipeline delivery still lacks.
 * @param environments - Merged delivery declarations, local winning
 * @returns Dotted paths of every missing pipeline_name or region
 */
function incompletePipelines(environments: Record<string, unknown>): string[] {
  return Object.entries(environments).flatMap(([environment, value]) => {
    const declared = asRecord(value);
    if (declared?.["mechanism"] !== CODEPIPELINE) return [];
    return (["pipeline_name", "region"] as const)
      .filter(key => typeof declared[key] !== "string")
      .map(key => `${SETTING}.${environment}.${key}`);
  });
}

/**
 * Report whether a CDK host declares how its delivery is proven.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkCdkDeliveryProof(
  targetPath: string
): Promise<DoctorCheck> {
  if (!existsSync(path.join(targetPath, CDK_APP_MARKER))) {
    return row("ok", "Not a CDK project");
  }
  const inspections = await Promise.all(
    CONFIG_FILES.map(fileName => inspect(targetPath, fileName))
  );
  const uninspectable = inspections.flatMap(inspection =>
    inspection.uninspectable ? [inspection.uninspectable] : []
  );
  if (uninspectable.length > 0) {
    return row(
      "warn",
      `Could not inspect ${uninspectable.join(", ")} for ${SETTING}`
    );
  }
  const environments = Object.assign(
    {},
    ...inspections.map(inspection => inspection.environments)
  ) as Record<string, unknown>;
  const declared = Object.keys(environments).filter(environment =>
    asRecord(environments[environment])
  );
  if (declared.length === 0) return row("warn", MISSING_DETAIL);
  const missing = incompletePipelines(environments);
  if (missing.length > 0) {
    return row(
      "warn",
      `The ${CODEPIPELINE} delivery needs ${missing.join(", ")} naming the pipeline that delivers it`
    );
  }
  return row("ok", `${SETTING} declares ${declared.join(", ")}`);
}

/**
 * A line for this check.
 * @param status - Check status
 * @param detail - What was found
 * @returns Doctor check result
 */
function row(status: DoctorCheck["status"], detail: string): DoctorCheck {
  return { name: CDK_DELIVERY_PROOF_CHECK_NAME, status, detail };
}
