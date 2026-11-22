/**
 * Shared fixtures for the nightly-e2e guard scanner contract tests.
 *
 * These fixtures deliberately keep workflow names generic. The production
 * scanner has to follow executable YAML and local-call reachability; filenames,
 * comments, dead reusable definitions, and a conveniently present canonical
 * script are not evidence about the guard an active caller actually runs.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-scan-fixtures
 */
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

import { expect } from "vitest";

import { scanNightlyE2eGuardCallers } from "../../../src/cli/doctor-nightly-e2e-guard-scan.js";

export const CANONICAL_GUARD = "scripts/check-nightly-e2e-health.mjs";
export const OFF_PATH_GUARD = "scripts/custom-nightly-gate.mjs";
export const ACTIVE_WORKFLOW = ".github/workflows/active.yml";
export const ACTIVE_NAME = "active.yml";
export const PULL_REQUEST_TRIGGER = "'on':\n  pull_request:";
export const WORKFLOW_CALL_TRIGGER = "'on':\n  workflow_call:";
export const SHARED_REFERENCE = "./.github/workflows/shared.yml";
export const SHARED_NAME = "shared.yml";
export const SHARED_WORKFLOW = `.github/workflows/${SHARED_NAME}`;
export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");
export const RUNS_ON_LINE = "    runs-on: ubuntu-latest";
export const BYPASS_ENV_MAPPING =
  "    env:\n      GATE_BYPASS: ${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}\n";
export const WORKFLOW_DIRECTORY_PREFIX = "lisa-nightly-scan-";

/**
 * Write one workflow fixture.
 * @param projectRoot - Temporary project root that owns `.github/workflows`
 * @param name - File name beneath `.github/workflows`
 * @param source - Complete YAML document
 */
export async function writeWorkflow(
  projectRoot: string,
  name: string,
  source: string
): Promise<void> {
  await writeFile(path.join(projectRoot, ".github", "workflows", name), source);
}

/**
 * Build an active direct caller whose bypass is an executable environment field.
 * @param target - Literal guard path used by the job
 * @param run - Complete run command when a hostile form is under test
 * @returns Complete workflow YAML
 */
export const directCaller = (
  target = CANONICAL_GUARD,
  run = `node ${target}`
): string => `
name: Active gate
'on':
  pull_request:
jobs:
  gate:
    runs-on: ubuntu-latest
    env:
      GATE_BYPASS: \${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    steps:
      - run: ${run}
`;

/**
 * Write `source` as the active workflow and assert the scan fails closed with
 * a failure reason matching `reason`.
 * @param projectRoot - Temporary project root that owns `.github/workflows`
 * @param source - Complete YAML document for the active workflow
 * @param reason - Pattern the joined failure reasons must match
 */
export async function expectUnavailable(
  projectRoot: string,
  source: string,
  reason: RegExp
): Promise<void> {
  await writeWorkflow(projectRoot, ACTIVE_NAME, source);
  const result = await scanNightlyE2eGuardCallers(projectRoot);
  expect(result.state).toBe("unavailable");
  expect(result).toMatchObject({ failures: expect.any(Array) });
  expect(
    result.state === "unavailable"
      ? result.failures.map(failure => failure.reason).join("\n")
      : ""
  ).toMatch(reason);
}
