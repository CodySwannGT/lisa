/**
 * @file doctor-nightly-e2e-guard-cli-helper.ts
 * @description Isolated host fixture for exercising the built doctor CLI
 * @module tests/integration/doctor-nightly-e2e-guard-cli-helper
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
export const TARGET = "scripts/check-nightly-e2e-health.mjs";

/**
 * Run built doctor against one active workflow and return its nightly row.
 * @param workflow - Complete active workflow source
 * @param additionalFiles - Hostile project files that doctor must never execute
 * @returns The bounded nightly guard check from JSON output
 */
export async function doctorNightlyGuard(
  workflow: string,
  additionalFiles: Readonly<Record<string, string>> = {}
): Promise<{
  readonly status: string;
  readonly detail: string;
}> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-guard-cli-"));
  try {
    await mkdir(path.join(projectRoot, ".github", "workflows"), {
      recursive: true,
    });
    await mkdir(path.join(projectRoot, "scripts"));
    await writeFile(
      path.join(projectRoot, ".github", "workflows", "active.yml"),
      workflow
    );
    await writeFile(
      path.join(projectRoot, TARGET),
      await readFile(
        path.join(
          REPOSITORY_ROOT,
          "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs"
        )
      )
    );
    await Promise.all(
      Object.entries(additionalFiles).map(async ([file, source]) => {
        await writeFile(path.join(projectRoot, file), source);
      })
    );
    const stdout = await execute(
      process.execPath,
      ["dist/index.js", "doctor", projectRoot, "--offline", "--json"],
      { cwd: REPOSITORY_ROOT, timeout: 20_000 }
    ).then(
      result => result.stdout,
      error => (error as { readonly stdout?: string }).stdout ?? ""
    );
    const payload = JSON.parse(stdout) as {
      readonly checks: readonly {
        readonly name: string;
        readonly status: string;
        readonly detail: string;
      }[];
    };
    const finding = payload.checks.find(
      check => check.name === "Nightly E2E bypass guard bounded?"
    );
    if (!finding) throw new Error("built doctor omitted the nightly guard row");
    return finding;
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}
