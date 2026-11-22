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
import {
  ACCOUNT_ID_PATTERN,
  CODEPIPELINE,
  DELIVERY_MECHANISMS,
  PIPELINE_NAME_PATTERN,
  REGION_PATTERN,
} from "../../all/copy-overwrite/scripts/lib/completion-proof-codepipeline.mjs";
import { CDK_APP_MARKER } from "../core/cdk-preset-adoption.js";
import type { DoctorCheck } from "./doctor.js";

/** Name of the delivery-proof check as doctor reports it. */
export const CDK_DELIVERY_PROOF_CHECK_NAME = "CDK delivery proof configured?";

const CONFIG_FILES = [".lisa.config.json", ".lisa.config.local.json"] as const;
const SETTING = "verification.completion.delivery";

/**
 * The environment lifecycle completion proves delivery for. The completion
 * CLI always resolves it to this literal, whatever `deploy.branches` maps.
 */
const PRODUCTION = "production";

/** Operator-facing remedy for a CDK host with no usable delivery declaration. */
const MISSING_DETAIL =
  `This CDK project declares no usable ${SETTING}.<env>, so lifecycle completion ` +
  "cannot prove a change was delivered and stops at pending-proof. Declare " +
  `the pipeline that delivers each environment, e.g. ${SETTING}.production = ` +
  `{ "mechanism": "${CODEPIPELINE}", "pipeline_name": "<your pipeline>", ` +
  '"region": "<aws-region>" }, and give verification read-only ' +
  "codepipeline:GetPipelineExecution access";

/** One config file's parsed contents, or why it could not be read. */
interface Inspection {
  config: Record<string, unknown>;
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
 * Merge local config over shared config exactly as the lifecycle CLI does:
 * objects merge per key, while arrays and scalars are replaced.
 * @param base - Shared config value
 * @param override - Local config value
 * @returns Effective merged value
 */
function deepMerge(base: unknown, override: unknown): unknown {
  const left = asRecord(base);
  const right = asRecord(override);
  if (!left || !right) return override;
  return Object.fromEntries([
    ...Object.entries(left).filter(([key]) => !(key in right)),
    ...Object.entries(right).map(([key, value]) => [
      key,
      key in left ? deepMerge(left[key], value) : value,
    ]),
  ]);
}

/**
 * Read one optional config file.
 * @param targetPath - Project root
 * @param fileName - Config file to read
 * @returns Parsed config, or the file name when it could not be parsed
 */
async function inspect(
  targetPath: string,
  fileName: (typeof CONFIG_FILES)[number]
): Promise<Inspection> {
  const configPath = path.join(targetPath, fileName);
  if (!existsSync(configPath)) return { config: {} };
  try {
    const parsed = asRecord(JSON.parse(await readFile(configPath, "utf8")));
    return { config: parsed ?? {} };
  } catch {
    return { config: {}, uninspectable: fileName };
  }
}

/**
 * The effective `verification.completion.delivery` declarations.
 * @param configs - Shared then local config
 * @returns Delivery declarations keyed by environment
 */
function deliveryOf(
  configs: readonly Record<string, unknown>[]
): Record<string, unknown> {
  const merged = asRecord(configs.reduce<unknown>(deepMerge, {}));
  const completion = asRecord(
    asRecord(merged?.["verification"])?.["completion"]
  );
  return asRecord(completion?.["delivery"]) ?? {};
}

/**
 * Settings a declared CodePipeline delivery lacks or spells invalidly.
 * @param environments - Effective delivery declarations
 * @returns Dotted paths of every missing or invalid pipeline_name or region
 */
function incompletePipelines(environments: Record<string, unknown>): string[] {
  const patterns = {
    pipeline_name: PIPELINE_NAME_PATTERN,
    region: REGION_PATTERN,
  };
  return Object.entries(environments).flatMap(([environment, value]) => {
    const declared = asRecord(value);
    if (declared?.["mechanism"] !== CODEPIPELINE) return [];
    return (["pipeline_name", "region"] as const)
      .filter(key => {
        const field = declared[key];
        return typeof field !== "string" || !patterns[key].test(field);
      })
      .map(key => `${SETTING}.${environment}.${key}`);
  });
}

/**
 * Account findings for every CodePipeline declaration: a missing account lets
 * credentials for another stage's account read a same-named pipeline there as
 * this environment's delivery; a malformed one is refused by completion.
 * @param environments - Effective delivery declarations
 * @returns One finding per declaration with a missing or malformed account_id
 */
function accountFindings(environments: Record<string, unknown>): string[] {
  return Object.entries(environments).flatMap(([environment, value]) => {
    const declared = asRecord(value);
    if (declared?.["mechanism"] !== CODEPIPELINE) return [];
    const account = declared["account_id"];
    const setting = `${SETTING}.${environment}.account_id`;
    if (account === undefined)
      return [
        `${setting} is not set, so credentials for another stage's AWS account could read a same-named pipeline there as ${environment} delivery; set it to the 12-digit account that runs this pipeline`,
      ];
    return typeof account === "string" && ACCOUNT_ID_PATTERN.test(account)
      ? []
      : [`${setting} is not a 12-digit AWS account id`];
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
  const environments = deliveryOf(
    inspections.map(inspection => inspection.config)
  );
  const declared = Object.keys(environments).filter(environment =>
    DELIVERY_MECHANISMS.includes(
      String(asRecord(environments[environment])?.["mechanism"])
    )
  );
  if (declared.length === 0) return row("warn", MISSING_DETAIL);
  const missing = incompletePipelines(environments);
  const findings = [
    ...(declared.includes(PRODUCTION)
      ? []
      : [
          `Lifecycle completion proves delivery for ${PRODUCTION}, but ${SETTING}.${PRODUCTION} declares no accepted mechanism (declared: ${declared.join(", ")}), so completion stops at pending-proof`,
        ]),
    ...(missing.length > 0
      ? [
          `The ${CODEPIPELINE} delivery needs a valid ${missing.join(", ")} naming the pipeline that delivers it`,
        ]
      : []),
    ...accountFindings(environments),
  ];
  return findings.length > 0
    ? row("warn", findings.join("; "))
    : row("ok", `${SETTING} declares ${declared.join(", ")}`);
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
