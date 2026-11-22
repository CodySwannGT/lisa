/**
 * Scanner contract for the nightly-e2e guard doctor check: fail-closed syntax: runners, shells, quoting and comments.
 *
 * Shared fixtures and the rationale for their generic workflow names live in
 * `doctor-nightly-e2e-guard-scan-fixtures.ts`.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-scan-syntax-shells.test
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanNightlyE2eGuardCallers } from "../../../src/cli/doctor-nightly-e2e-guard-scan.js";
import {
  ACTIVE_NAME,
  CANONICAL_GUARD,
  OFF_PATH_GUARD,
  RUNS_ON_LINE,
  WORKFLOW_DIRECTORY_PREFIX,
  directCaller,
  expectUnavailable,
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

describe("nightly guard scanner: fail-closed syntax", () => {
  /**
   * Assert the active workflow fails closed with a matching reason.
   * @param source - Complete YAML document for the active workflow
   * @param reason - Pattern the joined failure reasons must match
   * @returns Resolves once the assertions have run
   */
  const unavailable = (source: string, reason: RegExp): Promise<void> =>
    expectUnavailable(projectRoot, source, reason);

  it.each([
    [
      "Windows runner",
      directCaller().replace(RUNS_ON_LINE, "    runs-on: windows-latest"),
    ],
    [
      "dynamic runner",
      directCaller().replace(RUNS_ON_LINE, "    runs-on: ${{ matrix.os }}"),
    ],
    [
      "self-hosted runner array",
      directCaller().replace(RUNS_ON_LINE, "    runs-on: [self-hosted, linux]"),
    ],
    [
      "custom runner label",
      directCaller().replace(RUNS_ON_LINE, "    runs-on: ubuntu-custom"),
    ],
    [
      "workflow default shell",
      `defaults:\n  run:\n    shell: pwsh\n${directCaller()}`,
    ],
    [
      "job default shell",
      directCaller().replace(
        RUNS_ON_LINE,
        `${RUNS_ON_LINE}\n    defaults:\n      run:\n        shell: cmd`
      ),
    ],
    [
      "step shell",
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - shell: python\n        run: node ${CANONICAL_GUARD}`
      ),
    ],
  ])("refuses an unknown or non-POSIX %s context", async (_label, source) => {
    await unavailable(source, /POSIX|shell|runner/u);
  });

  it.each(["bash -n {0}", "bash -c {0}", "sh -n {0}"])(
    "refuses execution-skipping or controlling shell template %s",
    async shell => {
      await unavailable(
        directCaller().replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - shell: ${shell}\n        run: node ${CANONICAL_GUARD}`
        ),
        /POSIX|shell|template|execution/u
      );
    }
  );

  it.each(["bash --noprofile --norc -eo pipefail {0}", "sh -e {0}"])(
    "accepts an understood execution-preserving shell template %s",
    async shell => {
      await workflow(
        ACTIVE_NAME,
        directCaller().replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - shell: ${shell}\n        run: node ${CANONICAL_GUARD}`
        )
      );

      await expect(
        scanNightlyE2eGuardCallers(projectRoot)
      ).resolves.toMatchObject({
        state: "ok",
        callers: [{ target: CANONICAL_GUARD }],
      });
    }
  );

  it("requires an explicit supported shell on self-hosted runners", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller()
        .replace(RUNS_ON_LINE, "    runs-on: self-hosted")
        .replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - shell: bash\n        run: node ${CANONICAL_GUARD}`
        )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
  });

  it("lets an explicit POSIX step shell override a non-POSIX default", async () => {
    await workflow(
      ACTIVE_NAME,
      `defaults:\n  run:\n    shell: pwsh\n${directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - shell: bash\n        run: node ${CANONICAL_GUARD}`
      )}`
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
  });

  it("keeps a non-special backslash inside POSIX double quotes", async () => {
    await unavailable(
      directCaller(
        CANONICAL_GUARD,
        'node "scripts/check\\-nightly-e2e-health.mjs"'
      ),
      /literal|relative|unsupported/u
    );
  });

  it("removes a POSIX double-quoted backslash-newline continuation", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: |\n          node "scripts/check-nightly-e2e-\\\n          health.mjs"`
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
  });

  it("removes a POSIX unquoted backslash-newline continuation", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: |\n          node scripts/check-nightly-\\\n          e2e-health.mjs`
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ kind: "direct", target: CANONICAL_GUARD }],
    });
  });

  it.each([
    "NODE_OPTIONS=--require=./evil.cjs",
    "PATH=/tmp",
    "CACHE_MODE=warm",
  ])("rejects unsafe pre-node assignment %s", async assignment => {
    await unavailable(
      directCaller(CANONICAL_GUARD, `${assignment} node ${CANONICAL_GUARD}`),
      /assignment|NODE_OPTIONS|PATH|unsupported/u
    );
  });

  it.each([
    ["workflow", "NODE_OPTIONS", "--import=./zero-exit.mjs"],
    ["job", "PATH", "./fake-bin"],
    ["step", "BASH_ENV", "./zero-exit.sh"],
    ["workflow", "ENV", "./zero-exit.sh"],
    ["job", "NODE_PATH", "./replacement-modules"],
    ["step", "LD_PRELOAD", "./zero-exit.so"],
    ["job", "DYLD_INSERT_LIBRARIES", "./zero-exit.dylib"],
  ])("refuses execution-changing %s env %s", async (level, name, value) => {
    const base = directCaller();
    const source =
      level === "workflow"
        ? `env:\n  ${name}: ${value}\n${base}`
        : level === "job"
          ? base.replace(
              "      GATE_BYPASS:",
              `      ${name}: ${value}\n      GATE_BYPASS:`
            )
          : base.replace(
              `      - run: node ${CANONICAL_GUARD}`,
              `      - env:\n          ${name}: ${value}\n        run: node ${CANONICAL_GUARD}`
            );
    await unavailable(
      source,
      new RegExp(`${name}|environment|execution|unsafe`, "u")
    );
  });

  it.each([
    "BASH_ENV=./zero-exit.sh",
    "ENV=./zero-exit.sh",
    "NODE_PATH=./replacement-modules",
    "LD_PRELOAD=./zero-exit.so",
  ])("rejects execution-changing inline assignment %s", async assignment => {
    await unavailable(
      directCaller(CANONICAL_GUARD, `${assignment} node ${CANONICAL_GUARD}`),
      /assignment|environment|execution|unsafe/u
    );
  });

  it("strips shell comments before looking for bypass wiring", async () => {
    await workflow(
      ACTIVE_NAME,
      `
'on': [pull_request]
jobs:
  ordinary:
    runs-on: ubuntu-latest
    steps:
      - run: |
          node scripts/ordinary.mjs # GATE_BYPASS=not-executable
`
    );

    await expect(scanNightlyE2eGuardCallers(projectRoot)).resolves.toEqual({
      state: "ok",
      callers: [],
    });
  });

  it("accepts a supported guard command with a trailing shell comment", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: |\n          node ${CANONICAL_GUARD} # audit note`
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
  });

  it("fails closed when a bypass-bearing job has no supported Node target", async () => {
    await unavailable(
      directCaller().replace(`node ${CANONICAL_GUARD}`, "bash scripts/gate.sh"),
      /Node guard target|unsupported/u
    );
  });

  it("rejects ambiguous direct targets", async () => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: node ${CANONICAL_GUARD}\n      - run: node ${OFF_PATH_GUARD}`
      ),
      /ambiguous|multiple/u
    );
  });

  it("uses explicit ASCII path predicates", async () => {
    await unavailable(directCaller("scripts/guéard.mjs"), /ASCII|unsupported/u);
  });
});
