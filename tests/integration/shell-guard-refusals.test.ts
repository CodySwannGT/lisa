/**
 * The shipped shell guards that nothing had ever driven onto a refusal path
 * (CodySwannGT/lisa#3190).
 *
 * WHAT THIS SUITE EXECUTES. The shipped scripts, unmodified, in a temporary
 * project, once onto the refusal path and once onto the allow path. Not greps:
 * `blocking-hook-exit.test.ts` asserts that certain hooks CONTAIN `exit 2`,
 * which is a fact about the text and survives the guard being rewired so the
 * line is unreachable. Only a run can answer whether it fires.
 *
 * EVERY REFUSAL CASE ASSERTS THE STATUS EXACTLY. `expect(status).not.toBe(0)`
 * would pass on a guard that crashed — which is the failure CodySwannGT/lisa#3188
 * was: a guard that, when it could not run, permitted everything. Exit 2 is the
 * tool-boundary deny contract and exit 1 is a crash, so a case that accepted
 * either could not tell a working guard from a broken one.
 *
 * THE ALLOW CONTROL BESIDE EACH ONE is not decoration. Without it a guard that
 * refuses EVERYTHING passes every refusal case, which is the same evidence gap
 * pointing the other way.
 * @module tests/integration/shell-guard-refusals
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  BASH,
  PERMITTED,
  REFUSED,
  REJECTED,
  REPO_ROOT,
  SYSTEM_PATH,
  trackedCopies,
  writeStub,
} from "./support/shell-guard-refusal-fixture.js";

/** `sh` by absolute path — the interpreter `lisa-clean-git-env.sh` declares. */
const SH = "/bin/sh";

/**
 * The driver that sources the edit-time façade and calls its runner.
 *
 * `lisa-edit-gate.sh` defines functions and does nothing else, so it is reached
 * by `source` from every on-edit hook and never appears as a child process.
 * That is exactly why it had no refusal case: it is invisible to a control that
 * watches what gets executed. Sourcing it from a one-line driver puts its own
 * refusal path — `$_lisa_command || exit 2` inside `lisa_edit_gate_run` — under
 * a status assertion, and puts the copy on the argv so the run is attributable.
 */
const EDIT_GATE_DRIVER = '. "$1"; lisa_edit_gate_run edited.ts "$2"';

const temporaryDirectories: string[] = [];

/**
 * Create and register a disposable directory.
 * @returns Absolute path to the directory.
 */
function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-guard-refusal-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("lisa-edit-gate.sh refuses a declared task that fails", () => {
  const copies = trackedCopies("lisa-edit-gate.sh");

  /**
   * Source one copy of the façade and run one command through it.
   * @param copy - Repository-relative path of the copy.
   * @param command - The declared task the façade should run.
   * @returns The completed spawn result.
   */
  const runGate = (
    copy: string,
    command: string
  ): ReturnType<typeof boundedSpawnSync> =>
    boundedSpawnSync({
      label: `${copy} via lisa_edit_gate_run`,
      command: BASH,
      args: ["-c", EDIT_GATE_DRIVER, BASH, path.join(REPO_ROOT, copy), command],
      cwd: REPO_ROOT,
    });

  it("has copies to assert about", () => {
    // Thirteen at the time of writing, which is nine more than
    // CodySwannGT/lisa#3190's "and its three byte-identical copies" — the
    // generated per-agent plugin copies were not counted. Asserted rather than
    // pinned to a number so a fourteenth joins the cases below on its own.
    expect(copies.length).toBeGreaterThan(3);
  });

  it.each(copies)("%s exits 2 when the declared task fails", copy => {
    const result = runGate(copy, "false");

    expect(result.status).toBe(REFUSED);
    // Proves the refusal came from the façade running the task, not from the
    // driver failing to source it — which would exit 127 and read as a refusal
    // to anything checking only for non-zero.
    expect(result.stdout).toContain("Running declared gate task: false");
  });

  it.each(copies)("%s exits 0 when the declared task passes", copy => {
    const result = runGate(copy, "true");

    expect(result.status).toBe(PERMITTED);
    expect(result.stdout).toContain("Running declared gate task: true");
  });
});

describe("lisa-clean-git-env.sh refuses when git cannot answer", () => {
  const copies = trackedCopies("lisa-clean-git-env.sh");

  it.each(copies)("%s exits 1 when git refuses to list its env vars", copy => {
    const root = workspace();
    const binDirectory = path.join(root, "bin");
    writeStub(binDirectory, "git", "exit 1\n");

    const result = boundedSpawnSync({
      label: `${copy} with a git that refuses`,
      command: SH,
      args: [path.join(REPO_ROOT, copy), "/bin/echo", "ran"],
      cwd: root,
      env: { PATH: binDirectory },
    });

    // The guard's own documented refusal — `git rev-parse … || exit 1`. It
    // never runs the command it was asked to wrap, which is the whole point:
    // an environment it could not clean must not be handed to a quality gate.
    expect(result.status).toBe(REJECTED);
    expect(result.stdout).not.toContain("ran");
  });

  it.each(copies)("%s exits 0 and execs its command once git answers", copy => {
    const result = boundedSpawnSync({
      label: `${copy} with a working git`,
      command: SH,
      args: [path.join(REPO_ROOT, copy), "/bin/echo", "ran"],
      cwd: REPO_ROOT,
      env: { ...process.env },
    });

    expect(result.status).toBe(PERMITTED);
    expect(result.stdout).toContain("ran");
  });
});

describe("lisa-github-repo-settings.sh refuses an argument it cannot honour", () => {
  const settings = path.join(REPO_ROOT, "scripts/lisa-github-repo-settings.sh");

  it("exits 1 on an unknown option instead of proceeding", () => {
    const result = boundedSpawnSync({
      label: "lisa-github-repo-settings.sh with an unknown option",
      command: BASH,
      args: [settings, "--not-a-real-flag"],
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: SYSTEM_PATH },
    });

    expect(result.status).toBe(REJECTED);
    expect(result.stderr).toContain("Unknown option: --not-a-real-flag");
  });

  it("exits 0 when asked for its help", () => {
    const result = boundedSpawnSync({
      label: "lisa-github-repo-settings.sh --help",
      command: BASH,
      args: [settings, "--help"],
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: SYSTEM_PATH },
    });

    expect(result.status).toBe(PERMITTED);
  });
});

describe("the remote-agent-aws-setup wrapper reports what it delegated to", () => {
  const wrapper = "all/create-only/scripts/remote-agent-aws-setup.sh";

  /**
   * Install a fake `@codyswann/lisa` whose setup script exits as told.
   * @param status - Exit status for the installed script.
   * @returns The PATH directory holding the `npm` stub.
   */
  const installDelegate = (status: number): string => {
    const root = workspace();
    const binDirectory = path.join(root, "bin");
    const packageRoot = path.join(root, "node_modules");
    const installed = path.join(
      packageRoot,
      "@codyswann/lisa/plugins/lisa/scripts/remote-agent-aws-setup.sh"
    );
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(installed, `#!/bin/bash\nexit ${status}\n`, { mode: 0o755 });
    writeStub(binDirectory, "npm", `printf '%s\\n' "${packageRoot}"\n`);
    return binDirectory;
  };

  it("exits 0 when the installed setup script succeeds", () => {
    // The allow control this wrapper never had. Its two existing cases both
    // assert a non-zero status, so a wrapper that refused unconditionally
    // passed both of them.
    const result = boundedSpawnSync({
      label: `${wrapper} delegating to a script that succeeds`,
      command: BASH,
      args: [wrapper],
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: installDelegate(0) },
    });

    expect(result.status).toBe(PERMITTED);
  });
});
