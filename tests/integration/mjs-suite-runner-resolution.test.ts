/**
 * Tests the fallback branch of the `.mjs` suites job.
 *
 * The job has three outcomes, not two, and the third is the one that shipped
 * broken. A runner that collects zero suites fails (the runner counts its own
 * collection). A runner that collects suites runs them. A runner that is
 * ABSENT is neither: the gate cannot run at all, and until this test existed
 * that branch printed a `::warning::` and fell off the end of the script, so
 * the step exited 0.
 *
 * That is `declared-but-uncallable` aimed squarely at the job whose entire
 * purpose is to stop a suite from passing without running. Measured on this
 * repository before the fix: `scripts/lisa-test-node.mjs` absent, context
 * `🔍 Quality Checks / 🧪 Run .mjs Suites` = success, zero suites collected.
 *
 * The assertions that carry weight are the ones at the bottom, which execute
 * the step's own shell body under bash rather than reading it. A string match
 * on `exit 1` proves the characters are present; only running the body proves
 * the status reaches the runner.
 * @module tests/integration/mjs-suite-runner-resolution
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { env } from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { workflow } from "./quality-gate-facade-fixture.js";

/** The job id under test. */
const JOB = "test_node_suites";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/** The fallback step, which runs when the project declares no gate task. */
const STEP = "🧪 Run .mjs suites (lisa-test-node)";
const CONFIGURED_STEP = "🧪 Run the mjs-suites gate";

/** The runner's path inside the installed package. */
const PACKAGE_COPY =
  "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-test-node.mjs";

/** The runner's path after `lisa apply` has copied it in. */
const REPO_COPY = "scripts/lisa-test-node.mjs";

/** The installed direct supervisor required before either runner may execute. */
const WRAPPER = "node_modules/@codyswann/lisa/dist/cli/lisa-test-run.js";

const body =
  (workflow.jobs[JOB].steps ?? []).find(step => step.name === STEP)?.run ?? "";

/**
 * The shell the step body is executed under, by absolute path.
 *
 * `bash`, not `sh`, because that is what GitHub Actions runs a `run:` block
 * under. The distinction is load-bearing rather than cosmetic: `set -o
 * pipefail` is a bash builtin that dash rejects outright, and `/bin/sh` is
 * dash on the Ubuntu runners while on macOS it is bash in POSIX mode, which
 * accepts it. Running this under `/bin/sh` therefore passed on a developer
 * laptop and failed in CI with `Illegal option -o pipefail` — a test asserting
 * the behaviour of a shell the workflow never uses.
 */
const SHELL = "/bin/bash";

/** The step body's filename inside a throwaway project. */
const SCRIPT = "step.sh";
const SCRATCH_NAMESPACE = "lisa-scratch";
const workflowDirectories: string[] = [];

afterEach(() => {
  for (const directory of workflowDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Allocate one workflow fixture inside this supervised suite.
 * @returns Throwaway project root
 */
function workflowFixture(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-workflow-"));
  workflowDirectories.push(directory);
  return directory;
}

/**
 * Read one exact executable test-node step.
 * @param name - Shipped workflow step name
 * @returns Shell body
 */
function testNodeStep(name: string): string {
  const step = (workflow.jobs[JOB].steps ?? []).find(
    candidate => candidate.name === name
  );
  if (step?.run === undefined) throw new Error(`Missing workflow step ${name}`);
  return step.run;
}

/**
 * Resolve the pre-supervision temp root for a nested workflow fixture.
 * @returns Canonical temp base used before Lisa materializes a run root
 */
function workflowPlatformTemp(): string {
  const currentTemp = tmpdir();
  const suiteRoot = path.dirname(currentTemp);
  const namespace = path.dirname(suiteRoot);
  return path.basename(currentTemp).startsWith("worker-") &&
    path.basename(suiteRoot).startsWith("run-") &&
    path.basename(namespace) === SCRATCH_NAMESPACE
    ? path.dirname(namespace)
    : currentTemp;
}

/**
 * Execute an extracted workflow shell block exactly once.
 * @param script - Exact workflow step body
 * @param cwd - Throwaway consumer root
 * @param environment - Step-specific environment
 * @returns Bounded child result
 */
function runWorkflowStep(
  script: string,
  cwd: string,
  environment: NodeJS.ProcessEnv = {}
): ReturnType<typeof boundedSpawnSync> {
  const inherited = Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("LISA_TEST_"))
  );
  const platformTemp = workflowPlatformTemp();
  return boundedSpawnSync({
    label: "the test-node workflow step",
    command: SHELL,
    args: ["-c", script],
    cwd,
    env: {
      ...inherited,
      TEMP: platformTemp,
      TMP: platformTemp,
      TMPDIR: platformTemp,
      ...environment,
    },
  });
}

/**
 * Install a source-backed stand-in at the packed wrapper path.
 * @param directory - Throwaway consumer root
 * @param countFile - Wrapper invocation counter
 */
function installSourceWrapper(directory: string, countFile: string): void {
  const wrapper = path.join(directory, WRAPPER);
  mkdirSync(path.dirname(wrapper), { recursive: true });
  writeFileSync(
    wrapper,
    [
      'const fs=require("node:fs"),cp=require("node:child_process");',
      `const countFile=${JSON.stringify(countFile)};`,
      'const count=fs.existsSync(countFile)?Number(fs.readFileSync(countFile,"utf8")):0;',
      "fs.writeFileSync(countFile,String(count+1));",
      `const result=cp.spawnSync(process.execPath,["--import",${JSON.stringify(path.join(REPO_ROOT, "node_modules/tsx/dist/loader.mjs"))},${JSON.stringify(path.join(REPO_ROOT, "src/cli/lisa-test-run.ts"))},...process.argv.slice(2)],{cwd:process.cwd(),env:process.env,stdio:"inherit"});`,
      "if(result.signal)process.kill(process.pid,result.signal);",
      "process.exit(result.status??1);",
    ].join("\n")
  );
}

/**
 * Install one raw runner that records invocation and temp authority.
 * @param directory - Throwaway consumer root
 * @param marker - Runner observation file
 */
function installRawNodeRunner(directory: string, marker: string): void {
  const runner = path.join(directory, REPO_COPY);
  mkdirSync(path.dirname(runner), { recursive: true });
  writeFileSync(
    runner,
    `import fs from "node:fs";import os from "node:os";const marker=${JSON.stringify(marker)};const before=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,"utf8")):undefined;fs.writeFileSync(marker,JSON.stringify({count:(before?.count??0)+1,root:os.tmpdir()}));`
  );
}

/**
 * Build a throwaway project holding the step body and the requested runners.
 * @param runners Runner paths to create, mapped to the exit status each returns.
 * @returns The project root.
 */
const seed = (runners: Readonly<Record<string, number>>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-mjs-step-"));
  const entries = Object.entries(runners);

  writeFileSync(path.join(dir, SCRIPT), body, "utf8");
  for (const [relative, status] of entries) {
    const full = path.join(dir, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, `process.exit(${status});\n`, "utf8");
  }
  if (entries.length > 0) {
    const wrapper = path.join(dir, WRAPPER);
    mkdirSync(path.dirname(wrapper), { recursive: true });
    writeFileSync(
      wrapper,
      [
        'const {spawnSync}=require("node:child_process");',
        'const separator=process.argv.indexOf("--");',
        "if(separator<0)process.exit(64);",
        'const result=spawnSync(process.argv[separator+1],process.argv.slice(separator+2),{cwd:process.cwd(),env:process.env,stdio:"inherit"});',
        "if(result.signal)process.kill(process.pid,result.signal);",
        "process.exit(result.status??1);",
      ].join("\n"),
      "utf8"
    );
  }
  return dir;
};

/**
 * Run the step's own shell body in a throwaway project.
 * @param runners Runner paths to create, mapped to the exit status each returns.
 * @returns Exit status and merged output.
 */
const runStep = (
  runners: Readonly<Record<string, number>> = {}
): { status: number | null; out: string } => {
  const dir = seed(runners);
  const result = boundedSpawnSync({
    label: "the mjs suite runner fallback step",
    command: SHELL,
    args: [path.join(dir, SCRIPT)],
    cwd: dir,
  });
  const out = `${result.stdout}${result.stderr}`;

  rmSync(dir, { force: true, recursive: true });
  return { out, status: result.status };
};

describe("the fallback resolves the runner the way the gate resolver does", () => {
  it("is the step that runs when the project declared no task", () => {
    expect(body).not.toBe("");
    expect(
      (workflow.jobs[JOB].steps ?? []).find(step => step.name === STEP)?.if
    ).toBe("steps.gate.outputs.configured == 'false'");
  });

  it("prefers the packaged copy over the copied one", () => {
    // A project that installed @codyswann/lisa but has not run `lisa apply`
    // has a working runner. Checking only `scripts/` told it it had none.
    const packaged = body.indexOf(PACKAGE_COPY);
    const copied = body.indexOf(`"${REPO_COPY}"`);
    expect(packaged).toBeGreaterThan(-1);
    expect(copied).toBeGreaterThan(-1);
    expect(packaged).toBeLessThan(copied);
  });

  it("names both remedies, because one of them is not `lisa apply`", () => {
    // A project with genuinely no .mjs suites cannot fix this by installing
    // the runner — the runner would then fail on the empty collection. Its
    // remedy is declaring the gate off, and an error that omits it sends the
    // reader in a circle.
    expect(body).toContain("lisa apply");
    expect(body).toContain("test-node-suites");
    expect(body).toContain("off");
  });

  it("does not discard the runner's stderr", () => {
    expect(body).not.toContain("2>/dev/null");
    expect(body).toContain("set -euo pipefail");
  });

  it("declares no shell, so it runs under the Actions default of bash", () => {
    // This is what licenses running the body under bash below, rather than
    // assuming it. `set -o pipefail` above is a bash builtin that dash
    // rejects; if someone pins `shell: sh` here, the step breaks in CI and
    // this assertion is what says so.
    const step = (workflow.jobs[JOB].steps ?? []).find(
      entry => entry.name === STEP
    );

    expect(
      (step as Record<string, unknown> | undefined)?.shell
    ).toBeUndefined();
  });
});

describe("the fallback bites — the behaviour the job depends on", () => {
  it("FAILS when no runner exists on any path", () => {
    // The regression under test. This returned 0 before the fix.
    const { out, status } = runStep();

    expect(status).not.toBe(0);
    expect(out).toContain("::error");
    expect(out).toContain("NO .mjs suite may run raw");
  });

  it("runs the copied runner and passes on its success", () => {
    const { out, status } = runStep({ [REPO_COPY]: 0 });

    expect(status).toBe(0);
    expect(out).toContain(REPO_COPY);
  });

  it("runs the packaged runner when the copy is absent", () => {
    const { out, status } = runStep({ [PACKAGE_COPY]: 0 });

    expect(status).toBe(0);
    expect(out).toContain(PACKAGE_COPY);
  });

  it("propagates a failing runner rather than swallowing it", () => {
    // An empty collection exits 1 from inside the runner. `set -e` plus the
    // trailing `node "$RUNNER"` is what carries that out of the step.
    const { status } = runStep({ [REPO_COPY]: 1 });

    expect(status).not.toBe(0);
  });
});

describe("the workflow composes configured and fallback routes exactly once", () => {
  it("runs the configured command once without a second wrapper", () => {
    const directory = workflowFixture();
    const marker = path.join(directory, "configured-count");
    const runner = path.join(directory, "configured-runner.cjs");
    writeFileSync(
      runner,
      `const fs=require("node:fs");const p=${JSON.stringify(marker)};const n=fs.existsSync(p)?Number(fs.readFileSync(p,"utf8")):0;fs.writeFileSync(p,String(n+1));`
    );

    const result = runWorkflowStep(testNodeStep(CONFIGURED_STEP), directory, {
      GATE_RUNNER: "node",
      GATE_TASK: runner,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("1");
    expect(result.stdout).not.toContain("lisa-test-run");
  });

  it("runs the raw fallback once through one direct wrapper and cleans its lease", () => {
    const directory = workflowFixture();
    const wrapperCount = path.join(directory, "wrapper-count");
    const marker = path.join(directory, "runner-marker.json");
    installSourceWrapper(directory, wrapperCount);
    installRawNodeRunner(directory, marker);
    const namespace = path.join(workflowPlatformTemp(), SCRATCH_NAMESPACE);
    const before = existsSync(namespace)
      ? readdirSync(namespace)
          .filter(name => name.startsWith("run-"))
          .sort((left, right) => left.localeCompare(right))
      : [];

    const result = runWorkflowStep(testNodeStep(STEP), directory);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(wrapperCount, "utf8")).toBe("1");
    const observed = JSON.parse(readFileSync(marker, "utf8")) as {
      readonly count: number;
      readonly root: string;
    };
    expect(observed.count).toBe(1);
    expect(path.basename(path.dirname(observed.root))).toBe(SCRATCH_NAMESPACE);
    expect(path.basename(observed.root)).toMatch(/^run-/u);
    expect(existsSync(observed.root)).toBe(false);
    expect(
      existsSync(namespace)
        ? readdirSync(namespace)
            .filter(name => name.startsWith("run-"))
            .sort((left, right) => left.localeCompare(right))
        : []
    ).toEqual(before);
  });

  it("fails before the raw runner when the packaged wrapper is missing", () => {
    const directory = workflowFixture();
    const marker = path.join(directory, "runner-marker.json");
    installRawNodeRunner(directory, marker);

    const result = runWorkflowStep(testNodeStep(STEP), directory);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      ".mjs suite supervision missing"
    );
    expect(existsSync(marker)).toBe(false);
  });

  it("fails before the wrapper when every raw runner path is missing", () => {
    const directory = workflowFixture();
    const wrapperCount = path.join(directory, "wrapper-count");
    installSourceWrapper(directory, wrapperCount);

    const result = runWorkflowStep(testNodeStep(STEP), directory);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      ".mjs suite supervision missing"
    );
    expect(existsSync(wrapperCount)).toBe(false);
  });
});
