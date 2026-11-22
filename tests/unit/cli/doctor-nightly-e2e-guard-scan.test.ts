/**
 * Scanner contract for the nightly-e2e guard doctor check: active targets and local reachability.
 *
 * Shared fixtures and the rationale for their generic workflow names live in
 * `doctor-nightly-e2e-guard-scan-fixtures.ts`.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-scan.test
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanNightlyE2eGuardCallers } from "../../../src/cli/doctor-nightly-e2e-guard-scan.js";
import {
  ACTIVE_NAME,
  ACTIVE_WORKFLOW,
  CANONICAL_GUARD,
  OFF_PATH_GUARD,
  PULL_REQUEST_TRIGGER,
  SHARED_NAME,
  SHARED_REFERENCE,
  SHARED_WORKFLOW,
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

describe("nightly guard scanner: actual active target", () => {
  it("AC1 resolves the official reusable endpoint's canonical default", async () => {
    await workflow(
      ACTIVE_NAME,
      `
name: Active reusable gate
'on': [pull_request]
jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@v4
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [
        {
          workflow: ACTIVE_WORKFLOW,
          job: "gate",
          callPath: `${ACTIVE_WORKFLOW}#gate`,
          kind: "official-reusable",
          target: CANONICAL_GUARD,
        },
      ],
    });
  });

  it("resolves a literal official guard_script override", async () => {
    await workflow(
      ACTIVE_NAME,
      `
'on': [pull_request]
jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main
    with:
      guard_script: ${OFF_PATH_GUARD}
`
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ target: OFF_PATH_GUARD }],
    });
  });

  it("AC2 follows the active renamed target instead of a dead canonical copy", async () => {
    await workflow(ACTIVE_NAME, directCaller(OFF_PATH_GUARD));
    await writeFile(path.join(projectRoot, CANONICAL_GUARD), "unused", {
      flag: "a",
    }).catch(async () => {
      await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
      await writeFile(path.join(projectRoot, CANONICAL_GUARD), "unused");
    });

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ workflow: ACTIVE_WORKFLOW, target: OFF_PATH_GUARD }],
    });
  });

  it("AC4 supports a one-level literal environment path without changing the caller shape", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller(CANONICAL_GUARD, 'node "$GUARD"').replace(
        "    steps:",
        `      GUARD: ${CANONICAL_GUARD}\n    steps:`
      )
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ kind: "direct", target: CANONICAL_GUARD }],
    });
  });

  it("recognizes a literal direct guard from the bypass-label executable field", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        "GATE_BYPASS: ${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}",
        "NIGHTLY_BYPASS_LABEL: ${{ inputs.bypass_label }}"
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ kind: "direct", target: CANONICAL_GUARD }],
    });
  });

  it("normalizes a conventional leading-dot relative target", async () => {
    await workflow(ACTIVE_NAME, directCaller(`./${CANONICAL_GUARD}`));

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ kind: "direct", target: CANONICAL_GUARD }],
    });
  });

  it.each([
    ['node "scripts/check-nightly-e2e-health.mjs"', "double quoted"],
    ["node 'scripts/check-nightly-e2e-health.mjs'", "single quoted"],
  ])("accepts a safely %s literal direct target", async (run, _label) => {
    await workflow(ACTIVE_NAME, directCaller(CANONICAL_GUARD, run));

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ kind: "direct", target: CANONICAL_GUARD }],
    });
  });
});
describe("nightly guard scanner: reachability and negatives", () => {
  it("follows reachable local reusable workflows", async () => {
    await workflow(
      "root.yml",
      `
'on': [pull_request]
jobs:
  call:
    uses: ${SHARED_REFERENCE}
`
    );
    await workflow(
      SHARED_NAME,
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [{ workflow: SHARED_WORKFLOW, target: CANONICAL_GUARD }],
    });
  });

  it("traverses a local reusable whose filename matches the official endpoint", async () => {
    await workflow(
      "root.yml",
      `
'on': [pull_request]
jobs:
  call:
    uses: ./.github/workflows/nightly-e2e-health.yml
`
    );
    await workflow(
      "nightly-e2e-health.yml",
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [
        {
          workflow: ".github/workflows/nightly-e2e-health.yml",
          target: CANONICAL_GUARD,
        },
      ],
    });
  });

  it("preserves both root-to-job paths when two active roots share one reusable", async () => {
    for (const root of ["root-a.yml", "root-b.yml"] as const) {
      await workflow(
        root,
        `
'on': [pull_request]
jobs:
  call:
    uses: ${SHARED_REFERENCE}
`
      );
    }
    await workflow(
      SHARED_NAME,
      directCaller().replace(PULL_REQUEST_TRIGGER, WORKFLOW_CALL_TRIGGER)
    );

    const result = await scanNightlyE2eGuardCallers(projectRoot);
    expect(result).toMatchObject({
      state: "ok",
      callers: [
        {
          callPath: `.github/workflows/root-a.yml#call -> ${SHARED_WORKFLOW}#gate`,
          target: CANONICAL_GUARD,
        },
        {
          callPath: `.github/workflows/root-b.yml#call -> ${SHARED_WORKFLOW}#gate`,
          target: CANONICAL_GUARD,
        },
      ],
    });
  });

  it("ignores an unrelated remote action with a similar nightly name", async () => {
    await workflow(
      ACTIVE_NAME,
      `
'on': [pull_request]
jobs:
  unrelated:
    uses: example/tools/.github/workflows/nightly-e2e-health.yml@v1
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it.each([
    [
      "if condition",
      "    if: ${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}\n",
    ],
    [
      "environment mapping",
      "    env:\n      GATE_BYPASS: ${{ inputs.allow_gate }}\n",
    ],
    ["with mapping", "    with:\n      bypass_label: nightly-e2e-bypass\n"],
    [
      "comment-stripped run command",
      "    steps:\n      - run: echo nightly-e2e-bypass\n",
    ],
  ])(
    "refuses an unsupported remote reusable carrying executable bypass evidence in its %s",
    async (_label, evidence) => {
      await workflow(
        ACTIVE_NAME,
        `
'on': [pull_request]
jobs:
  gate:
${evidence}    uses: example/tools/.github/workflows/gate.yml@v1
`
      );

      const result = await scanNightlyE2eGuardCallers(projectRoot);
      expect(result).toMatchObject({
        state: "unavailable",
        failures: [
          {
            reason: expect.stringMatching(
              /remote reusable|bypass|unsupported/u
            ),
          },
        ],
      });
    }
  );
});
