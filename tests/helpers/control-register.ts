/**
 * Gates declarations for the fixture repositories, and the published register
 * schema as something a suite can run (CodySwannGT/lisa#4983).
 *
 * The fixture repositories carry no `.lisa.config.json` of their own. The
 * declarations here are the ones a configure step would write for each: a
 * command per folder for the two repositories on no supported project type,
 * and the long-standing task-per-gate form for the one on the paved road.
 * @module tests/helpers/control-register
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  loadGatesModule,
  type GatesDeclaration,
  type GatesModule,
} from "../../src/controls/gates-declaration.js";
import { CONTROL_REGISTER_SCHEMA_PACKAGE_PATH } from "../../src/controls/register-types.js";
import {
  buildControlAuditFixture,
  type ControlAuditFixture,
  type ControlAuditFixtureName,
} from "./control-audit-fixtures.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The name every fixture declaration gives as the accountable party. */
export const OWNER = "Platform team";

/** A `gates` block as it is written in `.lisa.config.json`. */
export type GatesBlock = Readonly<Record<string, unknown>>;

/** What a part says supports it, as it is written in a `gates` block. */
export type PartEvidence = Readonly<Record<string, unknown>>;

/**
 * The evidence of a part the audit found in one place. Every part of a
 * declaration needs one before a register is generated from it.
 * @param file - The file the audit found the check in, from the repository root
 * @param line - The line in that file, counted from 1
 * @returns The part's `evidence`
 */
export function evidenceAt(file: string, line = 1): PartEvidence {
  return { locators: [{ path: file, line }] };
}

/** The audit question the F-none coverage floor rests on. */
export const COVERAGE_QUESTION = "SI2@.";

/** F-none: one Python package, so every part covers the whole repository. */
export const F_NONE_GATES: GatesBlock = {
  "code-style": {
    commit: "required",
    "pull-request": "required",
    criteria: ["SI7"],
    owner: OWNER,
    tier: "authoritative",
    parts: [
      {
        scope: ".",
        command: ["ruff", "check", "."],
        proof: {
          violation: ".lisa/controls/proofs/lint.violation.patch",
          clean: ".lisa/controls/proofs/lint.clean.patch",
          failure_shape: ["Found 1 error"],
          timeout_seconds: 120,
          external_effects: [],
        },
        evidence: evidenceAt("ruff.toml"),
      },
    ],
  },
  "coverage-adequacy": {
    "pull-request": "required",
    criteria: ["SI2"],
    owner: OWNER,
    parts: [
      {
        scope: ".",
        command: ["python", "-m", "pytest", "--cov"],
        parameters: { "minimum-coverage": { value: 80, direction: "floor" } },
        evidence: { questions: [COVERAGE_QUESTION] },
      },
    ],
  },
};

/** F-mixed: a Python part in `api` and a TypeScript part in `web`. */
export const F_MIXED_GATES: GatesBlock = {
  "code-style": {
    commit: "required",
    "pull-request": "required",
    criteria: ["SI7"],
    owner: OWNER,
    tier: "authoritative",
    parts: [
      {
        scope: "web",
        command: ["npm", "run", "lint"],
        evidence: evidenceAt("web/package.json"),
      },
      {
        scope: "api",
        command: ["ruff", "check", "."],
        evidence: evidenceAt("api/ruff.toml"),
      },
    ],
  },
  "type-correctness": {
    push: "required",
    owner: OWNER,
    parts: [
      {
        scope: "web",
        command: ["npx", "tsc", "--noEmit"],
        evidence: evidenceAt("web/tsconfig.json"),
      },
    ],
  },
};

/** F-paved: the task-per-gate form existing users already have. No parts. */
export const F_PAVED_GATES: GatesBlock = {
  runner: "npm run",
  "code-style": {
    commit: { level: "required", run: "lint:staged" },
    "pull-request": "required",
  },
  "code-review": {
    "pull-request": { level: "required", await: "Review Bot", posted_by: 4242 },
  },
  "dependency-vulnerability": {
    "pull-request": "required",
    "continuous:staging": "optional",
  },
  "destructive-safety": { "pre-tool": "required" },
  "test-correctness": { push: "optional", "pull-request": "required" },
  "test-node-suites": { push: "off" },
};

/** The declaration each fixture is given. */
export const FIXTURE_GATES = {
  "F-none": F_NONE_GATES,
  "F-mixed": F_MIXED_GATES,
  "F-paved": F_PAVED_GATES,
} as const satisfies Partial<Record<ControlAuditFixtureName, GatesBlock>>;

/** The fixtures that have a declaration. */
export type DeclaredFixtureName = keyof typeof FIXTURE_GATES;

/** The declared fixtures, in the order the requirements name them. */
export const DECLARED_FIXTURES: readonly DeclaredFixtureName[] = [
  "F-none",
  "F-mixed",
  "F-paved",
];

/**
 * Write a `.lisa.config.json` the way a formatter would leave it.
 * @param gates - The `gates` block
 * @returns The file content
 */
export function configFile(gates: GatesBlock): string {
  return `${JSON.stringify({ gates }, null, 2)}\n`;
}

/**
 * Build a fixture repository with a gates declaration committed in it.
 * @param name - Which fixture
 * @param gates - The declaration; the fixture's own by default
 * @returns The repository
 */
export function buildDeclaredFixture(
  name: DeclaredFixtureName,
  gates: GatesBlock = FIXTURE_GATES[name]
): ControlAuditFixture {
  return buildControlAuditFixture(name, {
    extraFiles: { ".lisa.config.json": configFile(gates) },
  });
}

/**
 * A declaration as the register builder takes it, without a repository.
 * @param block - The `gates` block, with or without a `runner`
 * @param scripts - The repository's package scripts, `null` for no manifest
 * @returns The declaration
 */
export function declarationOf(
  block: GatesBlock,
  scripts: Readonly<Record<string, string>> | null = null
): GatesDeclaration {
  const { runner = "npm run", ...gates } = block;
  return {
    gates: gates as GatesDeclaration["gates"],
    runner: String(runner),
    scripts,
  };
}

/**
 * The gate registry Lisa ships, loaded the way the commands load it.
 * @returns The registry
 */
export async function shippedGates(): Promise<GatesModule> {
  return loadGatesModule();
}

/**
 * The published register schema, read from disk on every call so an edit to
 * it cannot be masked by an earlier read.
 * @returns The parsed schema
 */
export function registerSchema(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, CONTROL_REGISTER_SCHEMA_PACKAGE_PATH),
      "utf8"
    )
  ) as Record<string, unknown>;
}

/**
 * Validate a document against the published register schema with a generic
 * JSON Schema validator. The schema file is the contract; this only runs it.
 * @param document - Candidate register
 * @returns One `<path>: <message>` line per finding; empty when it is valid
 */
export function registerSchemaErrors(document: unknown): string[] {
  const schema = registerSchema() as Parameters<typeof z.fromJSONSchema>[0];
  const result = z.fromJSONSchema(schema).safeParse(document);
  return result.success
    ? []
    : result.error.issues.map(
        issue => `${issue.path.map(String).join(".")}: ${issue.message}`
      );
}
