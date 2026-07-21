/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns, functional/immutable-data, code-organization/enforce-statement-order, max-lines, max-lines-per-function, sonarjs/cognitive-complexity -- one closed ordered multi-stack registry is easier to audit as a whole */
/** Closed standards-check registry shared by every supported harness. */
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { ProjectType } from "../core/config.js";
import { projectPathKind, readProjectText } from "../health/read-only-fs.js";
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import type { StandardsCheckCategory } from "./contract.js";
import {
  inferTestEvidenceFormat,
  type TestEvidenceFormat,
} from "./test-evidence.js";

/** One fixed, no-shell command in the current standards registry. */
export interface StandardsCheckSpec {
  readonly id: string;
  readonly category: StandardsCheckCategory;
  readonly argv: readonly [string, ...string[]];
  readonly timeoutMs: number;
  readonly testEvidence?: TestEvidenceFormat;
  readonly environment?: Readonly<Record<string, string>>;
}

/** Fully resolved current check plan and its tamper-evident registry digest. */
export interface StandardsCheckPlan {
  readonly checks: readonly StandardsCheckSpec[];
  readonly registryDigest: string;
  readonly configDigest: string;
}

type ScriptCheck = Readonly<{
  id: string;
  script: string;
  category: StandardsCheckCategory;
  timeoutMs: number;
  requiresTestEvidence?: boolean;
  optional?: boolean;
  mutation?: boolean;
}>;

const STATIC_ANALYSIS = "static-analysis";

const TYPESCRIPT_SCRIPT_CHECKS: readonly ScriptCheck[] = [
  {
    id: "typescript.lint",
    script: "lint",
    category: "lint",
    timeoutMs: 180_000,
  },
  {
    id: "typescript.lint-slow",
    script: "lint:slow",
    category: "lint",
    timeoutMs: 180_000,
  },
  {
    id: "typescript.typecheck",
    script: "typecheck",
    category: STATIC_ANALYSIS,
    timeoutMs: 180_000,
  },
  {
    id: "typescript.build",
    script: "build",
    category: "guardrail",
    timeoutMs: 600_000,
  },
  {
    id: "typescript.test",
    script: "test",
    category: "test",
    timeoutMs: 600_000,
    requiresTestEvidence: true,
  },
  {
    id: "typescript.test-unit",
    script: "test:unit",
    category: "test",
    timeoutMs: 600_000,
    requiresTestEvidence: true,
  },
  {
    id: "typescript.test-coverage",
    script: "test:cov",
    category: "threshold",
    timeoutMs: 900_000,
    requiresTestEvidence: true,
  },
  {
    id: "typescript.test-integration",
    script: "test:integration",
    category: "test",
    timeoutMs: 600_000,
    requiresTestEvidence: true,
  },
  {
    id: "typescript.test-e2e",
    script: "test:e2e",
    category: "test",
    timeoutMs: 900_000,
    requiresTestEvidence: true,
    optional: true,
  },
  {
    id: "typescript.test-contract",
    script: "test:contract",
    category: "test",
    timeoutMs: 600_000,
    requiresTestEvidence: true,
    optional: true,
  },
  {
    id: "typescript.format",
    script: "format:check",
    category: "guardrail",
    timeoutMs: 180_000,
  },
  {
    id: "typescript.dead-code",
    script: "knip:check",
    category: STATIC_ANALYSIS,
    timeoutMs: 300_000,
  },
  {
    id: "typescript.ast-grep",
    script: "sg:scan",
    category: "guardrail",
    timeoutMs: 180_000,
  },
  {
    id: "typescript.mutation",
    script: "test:mutation",
    category: "guardrail",
    timeoutMs: 1_800_000,
    mutation: true,
  },
] as const;

const RAILS_CHECKS: readonly StandardsCheckSpec[] = [
  direct("rails.rubocop", "lint", 300_000, "bundle", "exec", "rubocop"),
  directTest("rails.rspec", 900_000, "rspec", "bundle", "exec", "rspec"),
  direct(
    "rails.reek",
    STATIC_ANALYSIS,
    300_000,
    "bundle",
    "exec",
    "reek",
    "app/",
    "lib/"
  ),
  direct(
    "rails.flog",
    STATIC_ANALYSIS,
    300_000,
    "bundle",
    "exec",
    "flog",
    "--all",
    "--group",
    "app/",
    "lib/"
  ),
  direct(
    "rails.flay",
    STATIC_ANALYSIS,
    300_000,
    "bundle",
    "exec",
    "flay",
    "app/",
    "lib/"
  ),
  direct(
    "rails.brakeman",
    "guardrail",
    300_000,
    "bundle",
    "exec",
    "brakeman",
    "--no-pager",
    "--quiet"
  ),
  direct(
    "rails.bundler-audit",
    "guardrail",
    300_000,
    "bundle",
    "exec",
    "bundler-audit",
    "check",
    "--update"
  ),
  direct("rails.ast-grep", "guardrail", 180_000, "sg", "scan"),
] as const;

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
  const checks: StandardsCheckSpec[] = [];
  if (projectTypes.includes("typescript")) {
    const manifest = await readPackageManifest(root);
    const scripts = isJsonObject(manifest.scripts) ? manifest.scripts : {};
    const packageManager = await resolvePackageManager(root);
    for (const check of TYPESCRIPT_SCRIPT_CHECKS) {
      if (check.mutation === true && !mutationGateEnabled(config)) continue;
      const script = scripts[check.script];
      if (typeof script !== "string" || script.trim().length === 0) {
        if (check.optional === true) continue;
        throw new Error(`Required package script is missing: ${check.script}.`);
      }
      checks.push(
        Object.freeze({
          id: check.id,
          category: check.category,
          argv: Object.freeze([
            packageManager,
            "run",
            check.script,
          ]) as readonly [string, ...string[]],
          timeoutMs: check.timeoutMs,
          ...(check.requiresTestEvidence === true
            ? { testEvidence: inferTestEvidenceFormat(script) }
            : {}),
        })
      );
    }
  }
  if (projectTypes.includes("rails")) {
    checks.push(...RAILS_CHECKS);
    if (mutationGateEnabled(config)) {
      if (
        (await projectPathKind(root, "scripts/lisa-mutation.sh")) !== "file"
      ) {
        throw new Error(
          "Required Rails mutation command is missing: scripts/lisa-mutation.sh."
        );
      }
      checks.push(
        direct(
          "rails.mutation",
          "guardrail",
          1_800_000,
          "bash",
          "scripts/lisa-mutation.sh"
        )
      );
    }
  }
  if (projectTypes.includes("phaser")) {
    if (
      (await projectPathKind(
        root,
        "scripts/check-verification-coverage.mjs"
      )) !== "file"
    ) {
      throw new Error(
        "Required verification-coverage command is missing: scripts/check-verification-coverage.mjs."
      );
    }
    checks.push(
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
      })
    );
  }
  if (
    (await projectPathKind(root, "scripts/check-threshold-ratchet.mjs")) !==
    "file"
  ) {
    throw new Error(
      "Required threshold command is missing: scripts/check-threshold-ratchet.mjs."
    );
  }
  checks.push(
    direct(
      "shared.threshold-ratchet",
      "threshold",
      180_000,
      "node",
      "scripts/check-threshold-ratchet.mjs",
      "--base",
      "HEAD^"
    )
  );
  const ids = checks.map(check => check.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Standards registry produced duplicate check identifiers.");
  }
  const frozen = Object.freeze(checks.map(check => Object.freeze(check)));
  return Object.freeze({
    checks: frozen,
    registryDigest: digest({ version: 1, checks: frozen }),
    configDigest: digestStandardsConfig(config),
  });
}

/** Digest only configuration that changes standards applicability or policy. */
export function digestStandardsConfig(config: JsonObject): string {
  return digest({
    quality: config.quality ?? null,
    thresholdRatchet: config.thresholdRatchet ?? null,
  });
}

/** Return a canonical SHA-256 digest without retaining config values. */
export function digestStandardsValue(value: unknown): string {
  return digest(value);
}

/** Construct one fixed direct-command check. */
function direct(
  id: string,
  category: StandardsCheckCategory,
  timeoutMs: number,
  ...command: readonly string[]
): StandardsCheckSpec {
  return Object.freeze({
    id,
    category,
    argv: Object.freeze(command) as readonly [string, ...string[]],
    timeoutMs,
  });
}

/** Construct one direct test check with positive runner-evidence semantics. */
function directTest(
  id: string,
  timeoutMs: number,
  testEvidence: TestEvidenceFormat,
  ...command: readonly string[]
): StandardsCheckSpec {
  return Object.freeze({
    ...direct(id, "test", timeoutMs, ...command),
    testEvidence,
  });
}

/** Read a bounded package manifest and require its object shape. */
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

/** Resolve one managed package runner in stable precedence order. */
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

/** Read the shared mutation-gate switch without treating absence as enabled. */
function mutationGateEnabled(config: JsonObject): boolean {
  return (
    isJsonObject(config.quality) &&
    isJsonObject(config.quality.mutation) &&
    isJsonObject(config.quality.mutation.gate) &&
    config.quality.mutation.gate.enabled === true
  );
}

/** Stable recursive JSON serialization for registry/config digests. */
function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

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
/* eslint-enable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns, functional/immutable-data, code-organization/enforce-statement-order, max-lines, max-lines-per-function, sonarjs/cognitive-complexity -- restore repository defaults */
