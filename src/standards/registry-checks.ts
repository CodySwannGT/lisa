/** Fixed command data for the closed standards-check registry. */
import type { StandardsCheckCategory } from "./contract.js";
import type { TestEvidenceFormat } from "./test-evidence.js";

/** One fixed, no-shell command in the current standards registry. */
export interface StandardsCheckSpec {
  readonly id: string;
  readonly category: StandardsCheckCategory;
  readonly argv: readonly [string, ...string[]];
  readonly timeoutMs: number;
  readonly testEvidence?: TestEvidenceFormat;
  readonly environment?: Readonly<Record<string, string>>;
}

/** One package-script-backed standards check before runner resolution. */
export type ScriptCheck = Readonly<{
  id: string;
  script: string;
  category: StandardsCheckCategory;
  timeoutMs: number;
  requiresTestEvidence?: boolean;
  optional?: boolean;
  mutation?: boolean;
}>;

const STATIC_ANALYSIS = "static-analysis";

export const TYPESCRIPT_SCRIPT_CHECKS: readonly ScriptCheck[] = [
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

export const RAILS_CHECKS: readonly StandardsCheckSpec[] = [
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
 * Construct one fixed direct-command check.
 * @param id - Stable check identifier
 * @param category - Standards category
 * @param timeoutMs - Command deadline in milliseconds
 * @param command - Fixed no-shell argv
 * @returns Frozen standards check
 */
export function direct(
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

/**
 * Construct one direct test check with positive runner-evidence semantics.
 * @param id - Stable check identifier
 * @param timeoutMs - Command deadline in milliseconds
 * @param testEvidence - Positive test-evidence parser
 * @param command - Fixed no-shell argv
 * @returns Frozen standards test check
 */
export function directTest(
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
