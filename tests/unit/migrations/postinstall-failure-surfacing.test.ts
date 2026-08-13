/**
 * Behavioural regression tests for CodySwannGT/lisa#2467.
 *
 * The shipped postinstall bootstrap redirected the apply's stderr to
 * `/dev/null` and then `|| true`d the exit code, so a completely failed apply
 * was byte-for-byte indistinguishable from a successful one. geminisportsai
 * ran that way for months and received no template updates.
 *
 * These tests execute the real composed script under `sh` — the same way a
 * package manager runs it — instead of asserting on the string, because the
 * property that matters is observable behaviour: a failure must be visible and
 * must not break `npm install` / `bun install`.
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import {
  EnsureLisaPostinstallMigration,
  LISA_INVOCATION,
} from "../../../src/migrations/ensure-lisa-postinstall.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LISA_ENTRY_RELATIVE = "node_modules/@codyswann/lisa/dist/index.js";
const REAL_ERROR = "SyntaxError: does not provide an export named 'default'";
/** Stub entry point that fails the way a crashing apply does. */
const FAILING_ENTRY = "process.exit(1);";
/** Absolute interpreter path: never resolve the shell through PATH. */
const SHELL = "/bin/sh";
/** The pre-fix invocation that discarded both stderr and the exit code. */
const SWALLOWING_INVOCATION = `[ -n "$CI" ] || LISA_BOOTSTRAP=1 node ${LISA_ENTRY_RELATIVE} --yes --skip-git-check . 2>/dev/null || true`;

describe("postinstall bootstrap surfaces a failed apply", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(
      path.join(projectDir, path.dirname(LISA_ENTRY_RELATIVE))
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Install a stub Lisa entry point with the given behaviour.
   * @param body - Node source for the stub
   */
  async function writeLisaEntry(body: string): Promise<void> {
    await fs.writeFile(path.join(projectDir, LISA_ENTRY_RELATIVE), body);
  }

  /**
   * Run a postinstall script the way a package manager does.
   * @param script - The composed postinstall command
   * @param ci - Value for the CI env var, or undefined to unset it
   * @returns Captured status and streams
   */
  function runPostinstall(
    script: string,
    ci?: string
  ): {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
  } {
    const env = { ...process.env };
    if (ci === undefined) {
      delete env.CI;
    } else {
      env.CI = ci;
    }
    const result = spawnSync(SHELL, ["-c", script], {
      cwd: projectDir,
      encoding: "utf8",
      env,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  it("lets the real error reach stderr instead of /dev/null", async () => {
    await writeLisaEntry(
      `console.error(${JSON.stringify(REAL_ERROR)}); process.exit(1);`
    );

    expect(runPostinstall(LISA_INVOCATION).stderr).toContain(REAL_ERROR);
  });

  it("adds a warning naming the failure and how to reproduce it", async () => {
    await writeLisaEntry(FAILING_ENTRY);

    const { stderr } = runPostinstall(LISA_INVOCATION);

    // The operator sees only this line in a wall of install output: it must say
    // that templates are not being applied, and give the command to re-run.
    expect(stderr).toContain("lisa");
    expect(stderr.toUpperCase()).toContain("FAILED");
    expect(stderr).toContain(LISA_ENTRY_RELATIVE);
    expect(stderr).toContain("doctor");
  });

  it("stays non-fatal so a failed apply never breaks the install", async () => {
    await writeLisaEntry(FAILING_ENTRY);

    expect(runPostinstall(LISA_INVOCATION).status).toBe(0);
  });

  it("stays quiet when the apply succeeds", async () => {
    await writeLisaEntry("process.exit(0);");

    const { status, stderr } = runPostinstall(LISA_INVOCATION);

    expect(status).toBe(0);
    expect(stderr).toBe("");
  });

  it("still runs the host's own chained postinstall after a failed apply", async () => {
    await writeLisaEntry(FAILING_ENTRY);

    const { status, stdout } = runPostinstall(
      `${LISA_INVOCATION} && echo host-postinstall-ran`
    );

    expect(status).toBe(0);
    expect(stdout).toContain("host-postinstall-ran");
  });

  it("short-circuits entirely when CI is set", async () => {
    await writeLisaEntry("console.error('should not run'); process.exit(1);");

    const { status, stderr } = runPostinstall(LISA_INVOCATION, "true");

    expect(status).toBe(0);
    expect(stderr).toBe("");
  });

  it("proves the pre-fix shape was silent on the same failure", async () => {
    await writeLisaEntry(
      `console.error(${JSON.stringify(REAL_ERROR)}); process.exit(1);`
    );

    const { status, stdout, stderr } = runPostinstall(SWALLOWING_INVOCATION);

    // This is the bug, pinned: a total failure produced nothing at all.
    expect(status).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("upgrades an installed project off the swallowing shape", async () => {
    await fs.writeJson(path.join(projectDir, "package.json"), {
      scripts: { postinstall: SWALLOWING_INVOCATION },
    });
    const detectedTypes: readonly ProjectType[] = ["typescript"];

    await new EnsureLisaPostinstallMigration().apply({
      projectDir,
      lisaDir: tempDir,
      detectedTypes,
      dryRun: false,
      logger: new SilentLogger(),
    });

    const pkg = await fs.readJson(path.join(projectDir, "package.json"));
    expect(pkg.scripts.postinstall).toBe(LISA_INVOCATION);
    expect(pkg.scripts.postinstall).not.toContain("2>/dev/null");
  });
});
