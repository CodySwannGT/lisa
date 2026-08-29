/** Black-box proof that one suite fails on its own unregistered temp leak. */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import {
  SCRATCH_NAMESPACE,
  temporaryTestRunDirectory,
} from "../../helpers/lisa-test-run-process.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_RUNNER = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");
const TEST_RUNNER_ARGS = [
  "--import",
  "tsx",
  TEST_RUNNER,
  "--profile",
  "lisa",
  "--adapter",
  "vitest",
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
const registerTestRunDirectory = (directory: string): void => {
  temporaryDirectories.push(directory);
};

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

describe("direct lisa-test-run leak attribution", () => {
  it("requires one explicit adapter before creating scratch authority", () => {
    const base = temporaryTestRunDirectory(
      "lisa-test-run-adapter-",
      registerTestRunDirectory
    );
    const result = boundedSpawnSync({
      label: "lisa-test-run missing adapter",
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        TEST_RUNNER,
        "--profile",
        "lisa",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ],
      baseMs: 2_000,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_SCRATCH_SUITE: undefined,
        LISA_TEST_SCRATCH_PREFIXES: undefined,
        LISA_TEST_SCRATCH_LEASE: undefined,
      },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--adapter (?:vitest|direct)/u);
    expect(existsSync(path.join(base, SCRATCH_NAMESPACE))).toBe(false);
    expect(existsSync(path.join(base, SCRATCH_NAMESPACE))).toBe(false);
  });

  it("directly supervises arbitrary Node scratch beneath the owned suite root", () => {
    const base = temporaryTestRunDirectory(
      "lisa-test-run-direct-",
      registerTestRunDirectory
    );
    const marker = path.join(base, "direct-root.txt");
    const result = boundedSpawnSync({
      label: "lisa-test-run direct adapter",
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        TEST_RUNNER,
        "--profile",
        "node",
        "--adapter",
        "direct",
        "--",
        process.execPath,
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, require("node:os").tmpdir())`,
      ],
      baseMs: 5_000,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_SCRATCH_SUITE: undefined,
        LISA_TEST_SCRATCH_PREFIXES: undefined,
        LISA_TEST_SCRATCH_LEASE: undefined,
      },
    });
    const owned = readFileSync(marker, "utf8");

    expect(result.status).toBe(0);
    expect(path.dirname(owned)).toBe(path.join(base, SCRATCH_NAMESPACE));
    expect(existsSync(owned)).toBe(false);
  });

  it("cleans registered direct children and fails the creating invocation on unregistered children", () => {
    const base = temporaryTestRunDirectory(
      "lisa-test-run-direct-leak-",
      registerTestRunDirectory
    );
    const runDirect = (prefix: string, exitCode = 0) =>
      boundedSpawnSync({
        label: `lisa-test-run direct ${prefix}`,
        command: process.execPath,
        args: [
          "--import",
          "tsx",
          TEST_RUNNER,
          "--profile",
          "node",
          "--adapter",
          "direct",
          "--",
          process.execPath,
          "-e",
          `const fs=require("node:fs"),os=require("node:os"),path=require("node:path");for(let i=0;i<3;i+=1)fs.mkdtempSync(path.join(os.tmpdir(),${JSON.stringify(prefix)}));process.exit(${String(exitCode)})`,
        ],
        baseMs: 5_000,
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TMPDIR: base,
          TMP: base,
          TEMP: base,
          LISA_TEST_SCRATCH_SUITE: undefined,
          LISA_TEST_SCRATCH_PREFIXES: undefined,
          LISA_TEST_SCRATCH_LEASE: undefined,
        },
      });

    const registered = runDirect("node-");
    const unregistered = runDirect("rogue-");
    const childFailure = runDirect("rogue-fail-", 23);

    expect(registered.status).toBe(0);
    expect(unregistered.status).toBe(1);
    expect(unregistered.stderr).toMatch(
      /Suite node leaked 3 unregistered direct scratch fixture/u
    );
    expect(unregistered.stderr).toMatch(/rogue-/u);
    expect(childFailure.status).toBe(23);
    expect(childFailure.stderr).toMatch(/direct scratch audit also failed/u);
    expect(readdirSync(path.join(base, SCRATCH_NAMESPACE))).toEqual([]);
  });
});
