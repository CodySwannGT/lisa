/** Black-box proof that one suite fails on its own unregistered temp leak. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_RUNNER = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");
const TEST_RUNNER_ARGS = [
  "--import",
  "tsx",
  TEST_RUNNER,
  "--profile",
  "lisa",
] as const;
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/scratch-leak-case.ts"
);
const SETUP = path.join(REPO_ROOT, "src/configs/vitest/scratch-setup.ts");
const LEAK_SETUP = path.join(
  REPO_ROOT,
  "src/configs/vitest/scratch-leak-setup.ts"
);
const GLOBAL_SETUP = path.join(
  REPO_ROOT,
  "src/configs/vitest/scratch-global-setup.ts"
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (existsSync(directory)) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

/**
 * Execute one isolated leak-guard control.
 * @param prefix - Prefix the fixture leaks
 * @param registered - Prefixes declared before collection
 * @param count - Number of direct fixture directories to leak
 * @returns Bounded child outcome
 */
function runLeakFixture(
  prefix: string,
  registered: readonly string[],
  count = 1
) {
  const base = mkdtempSync(path.join(tmpdir(), "leak-guard-"));
  const config = path.join(base, "vitest.config.ts");
  temporaryDirectories.push(base);
  writeFileSync(
    config,
    `export default { test: { include: [${JSON.stringify(FIXTURE)}], ` +
      `setupFiles: [${JSON.stringify(SETUP)}, ${JSON.stringify(LEAK_SETUP)}], ` +
      `globalSetup: [${JSON.stringify(GLOBAL_SETUP)}], ` +
      `sequence: { setupFiles: "list", hooks: "stack" } } };\n`,
    "utf8"
  );
  return boundedSpawnSync({
    label: `scratch leak fixture ${prefix}`,
    command: process.execPath,
    args: [
      ...TEST_RUNNER_ARGS,
      "--",
      process.execPath,
      path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      "--root",
      REPO_ROOT,
      "--config",
      config,
    ],
    baseMs: 30_000,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      TMPDIR: base,
      TMP: base,
      TEMP: base,
      LISA_TEST_SCRATCH_PREFIXES: JSON.stringify(registered),
      LISA_TEST_SCRATCH_SUITE: "lisa",
      LISA_SCRATCH_LEAK_PREFIX: prefix,
      LISA_SCRATCH_LEAK_COUNT: String(count),
    },
  });
}

describe("same-suite scratch leak guard", () => {
  it("has a positive red control: an unregistered leak fails and names it", () => {
    const run = runLeakFixture("unregistered-fixture-", []);

    expect(run.status).not.toBe(0);
    expect(`${run.stdout}\n${run.stderr}`).toContain("unregistered-fixture-");
  });

  it("reports the numeric count for multiple leaks through the built CLI", () => {
    const run = runLeakFixture("multi-leak-fixture-", [], 3);
    const output = `${run.stdout}\n${run.stderr}`;

    expect(run.status).not.toBe(0);
    expect(output).toContain("3 unregistered scratch fixture(s)");
    expect(output).toContain("multi-leak-fixture-");
  });

  it("keeps unknown Linux-shaped tmp roots outside the owned registry", () => {
    const run = runLeakFixture("tmp.", [], 2);
    const output = `${run.stdout}\n${run.stderr}`;

    expect(run.status).not.toBe(0);
    expect(output).toContain("2 unregistered scratch fixture(s)");
    expect(output).toContain("tmp.*");
  });

  it("batch-cleans 64 registered fixtures without failing the suite", () => {
    const run = runLeakFixture(
      "registered-fixture-",
      ["registered-fixture-"],
      64
    );

    expect(run.status).toBe(0);
  });
});
