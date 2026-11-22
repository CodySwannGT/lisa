/** Associate installed task-based gates with the patch pairs shipped for them. */
import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canPlantBunAuditFixture } from "./proof-push-fixture.js";

const PROOF_DIRECTORY = ".lisa/controls/proofs";
const CLI_PROOF_INPUT = "src/cli.ts";
const STAGED_LINT_TASK = {
  moment: "commit",
  task: "lint:staged",
  script: "lint-staged --config .lintstagedrc.json",
} as const;
const UNIT_VITEST_TASK = {
  moment: "push",
  task: "test:cov:unit",
  script: "$npm_execpath run test:cov:unit:lisa",
  vitestScript: "test:cov:unit:lisa",
} as const;
const VITEST_RUN = /\s--adapter\s+vitest\s+--\s+vitest\s+run(?:\s|$)/u;

/** Task inputs and failure text from the TypeScript template. */
const TYPESCRIPT_PROOFS = [
  {
    gate: "code-style",
    ...STAGED_LINT_TASK,
    inputs: ["src/lisa-proof-code-style.ts"],
    failure: "@typescript-eslint/no-explicit-any",
  },
  {
    gate: "format-conformance",
    ...STAGED_LINT_TASK,
    inputs: ["tests/fixtures/lisa-proof-format.css"],
    failure: "CssSyntaxError: Unclosed block",
  },
  {
    gate: "structural-rules",
    ...STAGED_LINT_TASK,
    inputs: ["src/components/LisaProofView.tsx"],
    failure: "no-inline-component-in-view",
  },
  {
    gate: "code-style-slow",
    moment: "push",
    task: "lint:slow",
    script: "$npm_execpath run lint:slow:lisa",
    inputs: [
      "tests/helpers/lisa-proof-slow-a.ts",
      "tests/helpers/lisa-proof-slow-b.ts",
      "tests/unit/lisa-proof-slow.test.ts",
    ],
    failure: "import/no-cycle",
  },
  {
    gate: "coverage-adequacy",
    ...UNIT_VITEST_TASK,
    inputs: [CLI_PROOF_INPUT],
    failure: "does not meet global threshold",
  },
  {
    gate: "type-correctness",
    moment: "push",
    task: "typecheck",
    script: "$npm_execpath run typecheck:lisa",
    inputs: [CLI_PROOF_INPUT],
    failure: "TS2344",
  },
  {
    gate: "test-correctness",
    ...UNIT_VITEST_TASK,
    inputs: ["tests/unit/lisa-proof-test-correctness.test.ts"],
    failure: "AssertionError: expected",
  },
  {
    gate: "dead-code",
    moment: "push",
    task: "knip:check",
    script: "$npm_execpath run knip:check:lisa",
    inputs: [CLI_PROOF_INPUT, "src/lisa-proof-unused.ts"],
    failure: "Unused files",
  },
  {
    gate: "test-integration",
    moment: "push",
    task: "test:integration",
    script: "$npm_execpath run test:integration:lisa",
    vitestScript: "test:integration:lisa",
    inputs: ["tests/integration/lisa-proof.integration.test.ts"],
    failure: "AssertionError: expected",
  },
  {
    gate: "traceability",
    moment: "push",
    task: "check:work-item:push",
    script: "node scripts/lisa-work-item.mjs validate-push",
    inputs: ["docs/lisa-proof-traceability.md"],
    failure: "No Work-Item trailer anywhere in the commit",
    fixture: {
      violation_commit: "omit-work-item",
      external_effects: [
        "Reads the work item in the configured tracker for the clean push fixture.",
      ],
    },
  },
  {
    gate: "dependency-vulnerability",
    moment: "push",
    task: "security:audit",
    script: "$npm_execpath run security:audit:lisa",
    inputs: ["docs/lisa-proof-dependency-audit.md"],
    failure:
      "High or critical vulnerabilities found in production dependencies",
    applicable: canPlantBunAuditFixture,
    fixture: {
      dependency_fixture: "bun-production-advisory",
      external_effects: [
        "Reads npm registry package metadata and public advisories for the disposable dependency fixture.",
      ],
    },
  },
] as const;

/** A proof bound to the task that declares it. */
export interface ShippedTaskProof {
  readonly gate: string;
  readonly moment: string;
  readonly task: string;
  readonly proof: {
    readonly violation: string;
    readonly clean: string;
    readonly failure_shape: string[];
    readonly violation_commit?: "omit-work-item";
    readonly dependency_fixture?: "bun-production-advisory";
    readonly external_effects?: readonly string[];
  };
}

/** Check whether an installed patch is an unchanged copy of the template.
 * @param projectDir - The installed host.
 * @param lisaDir - The Lisa package root.
 * @param patch - The relative patch path.
 * @returns True when the patch is present, regular and byte-identical.
 */
async function matchesShippedPatch(
  projectDir: string,
  lisaDir: string,
  patch: string
): Promise<boolean> {
  try {
    const template = await readFile(
      path.join(lisaDir, "typescript", "create-only", patch)
    );
    const installed = path.join(projectDir, patch);
    const info = await lstat(installed);
    return (
      info.isFile() &&
      info.size === template.length &&
      template.equals(await readFile(installed))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Vitest fixture imports must reach the Vitest command behind the task alias.
 * @param definition - The shipped proof and its expected task.
 * @param scripts - The effective scripts on this installation.
 * @returns True when the task and any required test runner match.
 */
function matchesTask(
  definition: (typeof TYPESCRIPT_PROOFS)[number],
  scripts: Readonly<Record<string, string>>
): boolean {
  if (scripts[definition.task] !== definition.script) return false;
  return (
    !("vitestScript" in definition) ||
    VITEST_RUN.test(scripts[definition.vitestScript] ?? "")
  );
}

/**
 * Bind shipped proof bytes only to the task and templates they were written for.
 * @param projectDir - The installed host
 * @param projectTypes - The detected stack and any parent stacks
 * @param scripts - The host's package scripts after template application
 * @param lisaDir - Lisa's template source
 * @returns Proofs whose installed patch pair and task match the shipped inputs
 */
export async function installedShippedTaskProofs(
  projectDir: string,
  projectTypes: readonly string[],
  scripts: Readonly<Record<string, string>>,
  lisaDir = fileURLToPath(new URL("../../", import.meta.url))
): Promise<readonly ShippedTaskProof[]> {
  if (!projectTypes.includes("typescript")) return [];
  const proofs = await Promise.all(
    TYPESCRIPT_PROOFS.map(async definition => {
      const { gate, moment, task, inputs, failure } = definition;
      if (
        !matchesTask(definition, scripts) ||
        inputs.some(input => existsSync(path.join(projectDir, input))) ||
        ("applicable" in definition && !definition.applicable(projectDir))
      ) {
        return undefined;
      }
      const base = `${PROOF_DIRECTORY}/lisa-typescript-${gate}`;
      const violation = `${base}.violation.patch`;
      const clean = `${base}.clean.patch`;
      for (const patch of [violation, clean]) {
        if (!(await matchesShippedPatch(projectDir, lisaDir, patch)))
          return undefined;
      }
      return {
        gate,
        moment,
        task,
        proof: {
          violation,
          clean,
          failure_shape: [failure],
          ...("fixture" in definition ? definition.fixture : {}),
        },
      };
    })
  );
  return proofs.filter(proof => proof !== undefined);
}
