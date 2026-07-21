/**
 * Shared scratch-repository fixtures for the delivery/authority readiness suites
 * (PRD #1739, #1896).
 *
 * The B2/B3 producers read real `.github/workflows/*.yml` files, so their tests
 * write real workflow files into a temporary repository. Centralizing the writer
 * and the repeated YAML lines here keeps each suite focused on the behavior it
 * pins rather than on YAML plumbing, and keeps the fixtures identical across
 * suites so a difference in outcome is always a difference in the workflow under
 * test.
 * @module tests/helpers/readiness-workflow-fixtures
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/** The shape a persisted readiness finding is read back as in assertions. */
export type Finding = Record<string, unknown>;

/** Repeated YAML fixture lines, named once so the fixtures stay readable. */
export const JOBS = "jobs:";
export const ON = "on:";
export const ON_PUSH = "on: [push]";
export const PUSH = "  push:";
export const TAGS = "    tags: ['v*']";
export const RUNS_ON = "    runs-on: ubuntu-latest";
export const PERMISSIONS = "    permissions:";
export const CONTENTS_READ = "      contents: read";
export const STEPS = "    steps:";
export const PUBLISH_JOB = "  publish:";
export const SHIP_JOB = "  ship:";
export const TEST_JOB = "  test:";

/** Repeated step lines. */
export const RUN_TEST = "      - run: npm run test";
export const RUN_BUILD = "      - run: npm run build";
export const RUN_PACK = "      - run: npm pack";
export const RUN_PUBLISH = "      - run: npm publish --provenance";
export const USES_DOWNLOAD = "      - uses: actions/download-artifact@v4";

/** Statuses and workflow file names reused across the fixtures. */
export const PASS = "PASS";
export const FAIL = "FAIL";
export const WARN = "WARN";
export const SKIP = "SKIP";
export const CI_YML = "ci.yml";
export const DEPLOY_YML = "deploy.yml";
export const RELEASE_YML = "release.yml";
export const RELEASE_NAME = "name: Release";
export const DEPLOY_NAME = "name: Deploy";

/** A generic deploy command reused by the credential fixtures. */
export const RUN_DEPLOY = "      - run: deploy.sh";

/**
 * Create a scratch repository directory for one readiness test case.
 * @param label - Short suite label used in the directory name
 * @returns Temporary directory path
 */
export async function makeScratchRepo(label: string): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), `lisa-readiness-${label}-`));
}

/**
 * Write one workflow file into a scratch repository.
 * @param root - Repository root
 * @param fileName - Workflow file name, e.g. `release.yml`
 * @param lines - Raw YAML lines
 */
export async function writeWorkflow(
  root: string,
  fileName: string,
  lines: readonly string[]
): Promise<void> {
  const dir = path.join(root, ".github", "workflows");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), `${lines.join("\n")}\n`, "utf8");
}

/**
 * Write one arbitrary file into a scratch repository, creating parent
 * directories. The supply-chain and context-routing producers read ordinary
 * repository files (manifests, lockfiles, docs, hooks) rather than workflows, so
 * they need a writer that is not workflow-shaped.
 * @param root - Repository root
 * @param relativePath - Repo-relative path, e.g. `.husky/pre-commit`
 * @param content - Exact file contents
 */
export async function writeRepoFile(
  root: string,
  relativePath: string,
  content: string
): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

/**
 * Write a JSON file into a scratch repository.
 * @param root - Repository root
 * @param relativePath - Repo-relative path, e.g. `package.json`
 * @param value - Value to serialize
 */
export async function writeRepoJson(
  root: string,
  relativePath: string,
  value: unknown
): Promise<void> {
  await writeRepoFile(
    root,
    relativePath,
    `${JSON.stringify(value, null, 2)}\n`
  );
}

/**
 * Read a dimension record's findings as plain objects.
 * @param findings - The raw findings array
 * @returns The findings as records
 */
export function asFindings(findings: readonly unknown[]): readonly Finding[] {
  return findings.map(finding => finding as Finding);
}
