/**
 * Scanner contract for the nightly-e2e guard doctor check: evidence negatives (comments, reapers, environment-file text).
 *
 * Shared fixtures and the rationale for their generic workflow names live in
 * `doctor-nightly-e2e-guard-scan-fixtures.ts`.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-scan-negatives.test
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanNightlyE2eGuardCallers } from "../../../src/cli/doctor-nightly-e2e-guard-scan.js";
import {
  ACTIVE_NAME,
  OFF_PATH_GUARD,
  PULL_REQUEST_TRIGGER,
  REPOSITORY_ROOT,
  WORKFLOW_CALL_TRIGGER,
  WORKFLOW_DIRECTORY_PREFIX,
  directCaller,
  writeWorkflow,
} from "./doctor-nightly-e2e-guard-scan-fixtures.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(
    path.join(os.tmpdir(), WORKFLOW_DIRECTORY_PREFIX)
  );
  await mkdir(path.join(projectRoot, ".github", "workflows"), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(projectRoot, { force: true, recursive: true });
});

/**
 * Write one workflow fixture into the current temporary project.
 * @param name - File name beneath `.github/workflows`
 * @param source - Complete YAML document
 * @returns Resolves once the file is written
 */
const workflow = (name: string, source: string): Promise<void> =>
  writeWorkflow(projectRoot, name, source);

describe("nightly guard scanner: reachability and negatives", () => {
  it.each([
    [
      "an if condition",
      `
'on': [pull_request]
jobs:
  ordinary:
    if: \${{ !env.bypass_cache }}
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/ordinary.mjs
`,
    ],
    [
      "an env value",
      `
'on': [pull_request]
jobs:
  ordinary:
    runs-on: ubuntu-latest
    env:
      CACHE_MODE: bypass_cache
    steps:
      - run: node scripts/ordinary.mjs
`,
    ],
    [
      "a similarly named nightly cache variable",
      `
'on': [pull_request]
jobs:
  ordinary:
    runs-on: ubuntu-latest
    env:
      NIGHTLY_BYPASS_CACHE: warm
    steps:
      - run: node scripts/ordinary.mjs
`,
    ],
    [
      "a nightly E2E bypass cache condition",
      `
'on': [pull_request]
jobs:
  ordinary:
    if: \${{ !env.nightly_e2e_bypass_cache }}
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/ordinary.mjs
`,
    ],
    [
      "a remote with input",
      `
'on': [pull_request]
jobs:
  ordinary:
    uses: example/tools/.github/workflows/cache.yml@v1
    with:
      bypass_cache: true
`,
    ],
  ])(
    "does not treat bypass_cache in %s as nightly bypass evidence",
    async (_label, source) => {
      await workflow(ACTIVE_NAME, source);
      await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
        state: "ok",
        callers: [],
      });
    }
  );

  it("removes comment-only environment-file text before evidence classification", async () => {
    await workflow(
      ACTIVE_NAME,
      `
'on': [pull_request]
jobs:
  ordinary:
    runs-on: ubuntu-latest
    steps:
      - run: |
          # echo "GATE_BYPASS=true" > "$GITHUB_ENV"
          node scripts/ordinary.mjs
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("AC5 reports a determinate zero for ordinary workflows", async () => {
    await workflow(
      "ordinary.yml",
      `
'on': [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("ignores comments, reporting, reaper, and unused reusable definitions", async () => {
    await workflow(
      ACTIVE_NAME,
      `
# GATE_BYPASS: node scripts/comment-only.mjs
'on': [pull_request]
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - env:
          GATE_BYPASS: false
        run: node scripts/report.mjs --report-issues
  reaper:
    runs-on: ubuntu-latest
    steps:
      - run: gh pr edit --remove-label nightly-e2e-bypass
`
    );
    await workflow(
      "unused.yml",
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("AC7 never treats a reaper as guard proof", async () => {
    await workflow("gate.yml", directCaller(OFF_PATH_GUARD));
    await workflow(
      "reaper.yml",
      await readFile(
        path.join(
          REPOSITORY_ROOT,
          "expo/create-only/.github/workflows/nightly-e2e-bypass-reaper.yml"
        ),
        "utf8"
      )
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ target: OFF_PATH_GUARD }],
    });
    expect(result.state === "ok" && result.callers).toHaveLength(1);
  });

  it("still inspects bypass cleanup logic when another event makes it live before close", async () => {
    const reaper = await readFile(
      path.join(
        REPOSITORY_ROOT,
        "expo/create-only/.github/workflows/nightly-e2e-bypass-reaper.yml"
      ),
      "utf8"
    );
    await workflow(
      "reaper.yml",
      reaper.replace(
        "on:\n  pull_request_target:",
        "on:\n  workflow_dispatch:\n  pull_request_target:"
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "unavailable",
      failures: [
        {
          workflow: ".github/workflows/reaper.yml",
          reason: expect.stringMatching(/bypass-label logic/u),
        },
      ],
    });
  });
});
