/** Associate installed task-based gates with the patch pairs shipped for them. */
import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROOF_DIRECTORY = ".lisa/controls/proofs";

/** Task inputs and failure text from the TypeScript template. */
const TYPESCRIPT_PROOFS = [
  {
    gate: "code-style",
    moment: "commit",
    task: "lint:staged",
    script: "lint-staged --config .lintstagedrc.json",
    inputs: ["src/lisa-proof-code-style.ts"],
    failure: "@typescript-eslint/no-explicit-any",
  },
  {
    gate: "type-correctness",
    moment: "push",
    task: "typecheck",
    script: "$npm_execpath run typecheck:lisa",
    inputs: ["src/cli.ts"],
    failure: "TS2344",
  },
  {
    gate: "test-correctness",
    moment: "push",
    task: "test:cov:unit",
    script: "$npm_execpath run test:cov:unit:lisa",
    inputs: ["tests/unit/lisa-proof-test-correctness.test.ts"],
    failure: "AssertionError: expected",
  },
  {
    gate: "dead-code",
    moment: "push",
    task: "knip:check",
    script: "$npm_execpath run knip:check:lisa",
    inputs: ["src/cli.ts", "src/lisa-proof-unused.ts"],
    failure: "Unused files",
  },
  {
    gate: "test-integration",
    moment: "push",
    task: "test:integration",
    script: "$npm_execpath run test:integration:lisa",
    inputs: ["tests/integration/lisa-proof.integration.test.ts"],
    failure: "AssertionError: expected",
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
  };
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
    TYPESCRIPT_PROOFS.map(
      async ({ gate, moment, task, script, inputs, failure }) => {
        if (
          scripts[task] !== script ||
          inputs.some(input => existsSync(path.join(projectDir, input)))
        ) {
          return undefined;
        }
        const base = `${PROOF_DIRECTORY}/lisa-typescript-${gate}`;
        const violation = `${base}.violation.patch`;
        const clean = `${base}.clean.patch`;
        try {
          for (const patch of [violation, clean]) {
            const template = await readFile(
              path.join(lisaDir, "typescript", "create-only", patch)
            );
            const installed = path.join(projectDir, patch);
            const info = await lstat(installed);
            if (!info.isFile() || info.size !== template.length)
              return undefined;
            if (!template.equals(await readFile(installed))) return undefined;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
          throw error;
        }
        return {
          gate,
          moment,
          task,
          proof: { violation, clean, failure_shape: [failure] },
        };
      }
    )
  );
  return proofs.filter(proof => proof !== undefined);
}
