/** Closed standards-check registry shared by every supported harness. */
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { ProjectType } from "../core/config.js";
import { projectPathKind, readProjectText } from "../health/read-only-fs.js";
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import {
  direct,
  RAILS_CHECKS,
  type ScriptCheck,
  type StandardsCheckSpec,
  TYPESCRIPT_SCRIPT_CHECKS,
} from "./registry-checks.js";
import { inferTestEvidenceFormat } from "./test-evidence.js";

export type { StandardsCheckSpec } from "./registry-checks.js";

/** Fully resolved current check plan and its tamper-evident registry digest. */
export interface StandardsCheckPlan {
  readonly checks: readonly StandardsCheckSpec[];
  readonly registryDigest: string;
  readonly configDigest: string;
}

/**
 * Resolve the exact ordered union of checks for current detected stacks.
 * Missing managed scripts and threshold tooling fail before any command runs.
 * @param projectRoot - Canonical project root
 * @param projectTypes - Expanded, canonical detected types
 * @param config - Current bounded merged Lisa config
 * @returns Closed current check plan
 */
export async function resolveStandardsCheckPlan(
  projectRoot: string,
  projectTypes: readonly ProjectType[],
  config: JsonObject
): Promise<StandardsCheckPlan> {
  const root = await realpath(projectRoot);
  if (projectTypes.length === 0) {
    throw new Error("No supported Lisa project type was detected.");
  }
  // Each stack's checks resolve in turn, so the first missing requirement in
  // registry order is the one reported — exactly as a single sequential pass.
  const typescriptChecks = projectTypes.includes("typescript")
    ? await resolveTypescriptChecks(root, config)
    : [];
  const railsChecks = projectTypes.includes("rails")
    ? await resolveRailsChecks(root, config)
    : [];
  const phaserChecks = projectTypes.includes("phaser")
    ? await resolvePhaserChecks(root)
    : [];
  const sharedChecks = await resolveSharedChecks(root);
  const checks = [
    ...typescriptChecks,
    ...railsChecks,
    ...phaserChecks,
    ...sharedChecks,
  ];
  if (new Set(checks.map(check => check.id)).size !== checks.length) {
    throw new Error("Standards registry produced duplicate check identifiers.");
  }
  return freezePlan(checks, config);
}

/**
 * Resolve the package-script-backed TypeScript checks in registry order.
 * @param root - Canonical project root
 * @param config - Current bounded merged Lisa config
 * @returns Frozen TypeScript checks
 */
async function resolveTypescriptChecks(
  root: string,
  config: JsonObject
): Promise<readonly StandardsCheckSpec[]> {
  const manifest = await readPackageManifest(root);
  const scripts = isJsonObject(manifest.scripts) ? manifest.scripts : {};
  const packageManager = await resolvePackageManager(root);
  const mutationEnabled = mutationGateEnabled(config);
  return TYPESCRIPT_SCRIPT_CHECKS.flatMap(check =>
    check.mutation === true && !mutationEnabled
      ? []
      : scriptCheck(check, scripts[check.script], packageManager)
  );
}

/**
 * Resolve one package-script check against the manifest's script entry.
 * @param check - Registry entry for the script
 * @param script - The manifest's value for the script name
 * @param packageManager - Package runner selected by lockfile
 * @returns The frozen check, or nothing when an optional script is absent
 */
function scriptCheck(
  check: ScriptCheck,
  script: unknown,
  packageManager: string
): readonly StandardsCheckSpec[] {
  if (typeof script !== "string" || script.trim().length === 0) {
    if (check.optional === true) return [];
    throw new Error(`Required package script is missing: ${check.script}.`);
  }
  return [
    Object.freeze({
      id: check.id,
      category: check.category,
      argv: Object.freeze([packageManager, "run", check.script]) as readonly [
        string,
        ...string[],
      ],
      timeoutMs: check.timeoutMs,
      ...(check.requiresTestEvidence === true
        ? { testEvidence: inferTestEvidenceFormat(script) }
        : {}),
    }),
  ];
}

/**
 * Resolve the Rails checks, adding the mutation command when the gate is on.
 * @param root - Canonical project root
 * @param config - Current bounded merged Lisa config
 * @returns Rails checks in registry order
 */
async function resolveRailsChecks(
  root: string,
  config: JsonObject
): Promise<readonly StandardsCheckSpec[]> {
  if (!mutationGateEnabled(config)) return RAILS_CHECKS;
  if ((await projectPathKind(root, "scripts/lisa-mutation.sh")) !== "file") {
    throw new Error(
      "Required Rails mutation command is missing: scripts/lisa-mutation.sh."
    );
  }
  return [
    ...RAILS_CHECKS,
    direct(
      "rails.mutation",
      "guardrail",
      1_800_000,
      "bash",
      "scripts/lisa-mutation.sh"
    ),
  ];
}

/**
 * Resolve the Phaser verification-coverage check.
 * @param root - Canonical project root
 * @returns The Phaser check
 */
async function resolvePhaserChecks(
  root: string
): Promise<readonly StandardsCheckSpec[]> {
  if (
    (await projectPathKind(root, "scripts/check-verification-coverage.mjs")) !==
    "file"
  ) {
    throw new Error(
      "Required verification-coverage command is missing: scripts/check-verification-coverage.mjs."
    );
  }
  return [
    Object.freeze({
      ...direct(
        "phaser.verification-coverage",
        "guardrail",
        180_000,
        "node",
        "scripts/check-verification-coverage.mjs"
      ),
      environment: Object.freeze({
        VERIFY_BASE_SHA: "HEAD^",
        VERIFY_HEAD_SHA: "HEAD",
      }),
    }),
  ];
}

/**
 * Resolve the threshold-ratchet check every stack shares.
 * @param root - Canonical project root
 * @returns The shared threshold check
 */
async function resolveSharedChecks(
  root: string
): Promise<readonly StandardsCheckSpec[]> {
  if (
    (await projectPathKind(root, "scripts/check-threshold-ratchet.mjs")) !==
    "file"
  ) {
    throw new Error(
      "Required threshold command is missing: scripts/check-threshold-ratchet.mjs."
    );
  }
  return [
    direct(
      "shared.threshold-ratchet",
      "threshold",
      180_000,
      "node",
      "scripts/check-threshold-ratchet.mjs",
      "--base",
      "HEAD^"
    ),
  ];
}

/**
 * Freeze the resolved checks and bind their registry and configuration digests.
 * @param checks - Private ordered check accumulator
 * @param config - Current bounded merged Lisa config
 * @returns Frozen current check plan
 */
function freezePlan(
  checks: readonly StandardsCheckSpec[],
  config: JsonObject
): StandardsCheckPlan {
  const frozen = Object.freeze(checks.map(check => Object.freeze(check)));
  return Object.freeze({
    checks: frozen,
    registryDigest: digest({ version: 1, checks: frozen }),
    configDigest: digestStandardsConfig(config),
  });
}

/**
 * Digest only configuration that changes standards applicability or policy.
 * @param config - Current merged Lisa config
 * @returns Canonical standards configuration digest
 */
function digestStandardsConfig(config: JsonObject): string {
  return digest({
    quality: config.quality ?? null,
    thresholdRatchet: config.thresholdRatchet ?? null,
  });
}

/**
 * Read a bounded package manifest and require its object shape.
 * @param projectRoot - Canonical project repository
 * @returns Parsed package manifest
 */
async function readPackageManifest(projectRoot: string): Promise<JsonObject> {
  const payload = await readProjectText(projectRoot, "package.json");
  if (payload === undefined) {
    throw new Error("Required package manifest is missing: package.json.");
  }
  const parsed = JSON.parse(payload) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error("package.json must contain a JSON object.");
  }
  return parsed;
}

/**
 * Resolve one managed package runner in stable precedence order.
 * @param projectRoot - Canonical project repository
 * @returns Package runner selected by lockfile
 */
async function resolvePackageManager(projectRoot: string): Promise<string> {
  const candidates = [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ] as const;
  for (const [lockfile, manager] of candidates) {
    if ((await projectPathKind(projectRoot, lockfile)) === "file")
      return manager;
  }
  return "npm";
}

/**
 * Read the shared mutation-gate switch without treating absence as enabled.
 * @param config - Current merged Lisa config
 * @returns Whether mutation proof is required
 */
function mutationGateEnabled(config: JsonObject): boolean {
  return (
    isJsonObject(config.quality) &&
    isJsonObject(config.quality.mutation) &&
    isJsonObject(config.quality.mutation.gate) &&
    config.quality.mutation.gate.enabled === true
  );
}

/**
 * Stable recursive JSON serialization for registry/config digests.
 * @param value - JSON-like value to digest
 * @returns Canonical SHA-256 digest
 */
function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

/**
 * Serialize JSON-like input with recursively sorted object keys.
 * @param value - JSON-like value to serialize
 * @returns Canonical JSON text
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
