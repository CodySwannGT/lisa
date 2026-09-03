/**
 * Behavioural regression tests for CodySwannGT/lisa#2467 and #3466.
 *
 * The shipped postinstall bootstrap redirected the apply's stderr to
 * `/dev/null` and then `|| true`d the exit code, so a completely failed apply
 * was byte-for-byte indistinguishable from a successful one. A repo in the
 * portfolio ran that way for months and received no template updates (#2467).
 * The follow-up shape swapped `true` for `echo`, which recovered the reason but
 * not the fact — `echo` also exits 0, so postinstall still reported success on
 * a failed apply (#3466).
 *
 * These tests execute the real composed script under `sh` — the same way a
 * package manager runs it — instead of asserting on the string, because the
 * property that matters is observable behaviour: a failure must be visible in
 * the output AND in the exit status.
 */
import * as path from "node:path";
import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import {
  EnsureLisaPostinstallMigration,
  LISA_INVOCATION,
} from "../../../src/migrations/ensure-lisa-postinstall.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LISA_ENTRY_RELATIVE = "node_modules/@codyswann/lisa/dist/index.js";
const REAL_ERROR = "SyntaxError: does not provide an export named 'default'";
/** Stub entry point that fails the way a crashing apply does. */
const FAILING_ENTRY = "process.exit(1);";
/** Absolute interpreter path: never resolve the shell through PATH. */
const SHELL = "/bin/sh";
/** The pre-fix invocation that discarded both stderr and the exit code. */
const SWALLOWING_INVOCATION = `[ -n "$CI" ] || LISA_BOOTSTRAP=1 node ${LISA_ENTRY_RELATIVE} --yes --skip-git-check . 2>/dev/null || true`;
/**
 * The intermediate shape from CodySwannGT/lisa#2745: it prints the reason but
 * `echo` exits 0, so the failure is still reported as a successful install.
 */
const EXIT_ZERO_WARNING_INVOCATION = `[ -n "$CI" ] || LISA_BOOTSTRAP=1 LISA_POSTINSTALL=1 node ${LISA_ENTRY_RELATIVE} --yes --skip-git-check . || echo "lisa: TEMPLATE APPLY FAILED - see ${LISA_ENTRY_RELATIVE} doctor" >&2`;

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
    const result = boundedSpawnSync({
      label: "the postinstall script under sh",
      command: SHELL,
      args: ["-c", script],
      cwd: projectDir,
      env,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  /**
   * Run the migration over a project whose postinstall is already `existing`.
   * @param existing - The postinstall spelling the project currently ships
   * @returns The project's package.json after the migration
   */
  async function upgradePostinstall(
    existing: string
  ): Promise<{ readonly scripts: Record<string, string> }> {
    await fs.writeJson(path.join(projectDir, "package.json"), {
      scripts: { postinstall: existing },
    });
    const detectedTypes: readonly ProjectType[] = ["typescript"];

    await new EnsureLisaPostinstallMigration().apply({
      projectDir,
      lisaDir: tempDir,
      detectedTypes,
      dryRun: false,
      logger: new SilentLogger(),
    });

    return fs.readJson(path.join(projectDir, "package.json"));
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

  it("does not report success when the apply fails", async () => {
    await writeLisaEntry(FAILING_ENTRY);

    // The whole of CodySwannGT/lisa#3466: `|| echo` exits 0, so the package
    // manager saw a clean postinstall on a totally failed apply.
    expect(runPostinstall(LISA_INVOCATION).status).not.toBe(0);
  });

  it("stays quiet when the apply succeeds", async () => {
    await writeLisaEntry("process.exit(0);");

    const { status, stderr } = runPostinstall(LISA_INVOCATION);

    expect(status).toBe(0);
    expect(stderr).toBe("");
  });

  it("stops the chain instead of letting a later command mask the failure", async () => {
    await writeLisaEntry(FAILING_ENTRY);

    // composePostinstall builds `<lisa> && <the host's own postinstall>`. The
    // accepted cost of failing loudly: the host's chained script is skipped,
    // and — the point — its exit status cannot overwrite the failure.
    const { status, stdout } = runPostinstall(
      `${LISA_INVOCATION} && echo host-postinstall-ran`
    );

    expect(status).not.toBe(0);
    expect(stdout).not.toContain("host-postinstall-ran");
  });

  it("survives a `;`-composed chain that would otherwise discard the status", async () => {
    await writeLisaEntry(FAILING_ENTRY);

    // `exit 1` rather than a bare `false`: a consumer who hand-edits the
    // separator to `;` still gets a non-zero install.
    expect(
      runPostinstall(`${LISA_INVOCATION} ; echo host-postinstall-ran`).status
    ).not.toBe(0);
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

  it("proves the intermediate shape reported success on the same failure", async () => {
    await writeLisaEntry(
      `console.error(${JSON.stringify(REAL_ERROR)}); process.exit(1);`
    );

    const { status, stderr } = runPostinstall(EXIT_ZERO_WARNING_INVOCATION);

    // CodySwannGT/lisa#3466 pinned: the reason was visible, the failure was not.
    expect(stderr).toContain("TEMPLATE APPLY FAILED");
    expect(status).toBe(0);
  });

  it("upgrades an installed project off the swallowing shape", async () => {
    const pkg = await upgradePostinstall(SWALLOWING_INVOCATION);

    expect(pkg.scripts.postinstall).toBe(LISA_INVOCATION);
    expect(pkg.scripts.postinstall).not.toContain("2>/dev/null");
  });

  it("upgrades an installed project off the exit-0 warning shape in place", async () => {
    const pkg = await upgradePostinstall(EXIT_ZERO_WARNING_INVOCATION);

    // Replaced, not chained: a missed match would leave the project running two
    // applies per install (the CodySwannGT/lisa#3050 shape).
    expect(pkg.scripts.postinstall).toBe(LISA_INVOCATION);
  });

  it("leaves an already-upgraded project byte-identical", async () => {
    const pkg = await upgradePostinstall(`${LISA_INVOCATION} && patch-package`);

    expect(pkg.scripts.postinstall).toBe(`${LISA_INVOCATION} && patch-package`);
  });
});
