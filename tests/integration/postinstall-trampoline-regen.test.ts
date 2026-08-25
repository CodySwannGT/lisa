/**
 * Regression test for CodySwannGT/lisa#2750 — the bug itself, not its reporting.
 *
 * The trampoline's lockfile regen was gated on the CHILD's own re-apply changing
 * package.json. On the path that matters — a plain `bun install`, where the
 * first apply (inside postinstall) already rewrote package.json and the re-apply
 * is therefore idempotent — that comparison is always equal, so the regen never
 * ran and the lockfile stayed exactly as stale as the install left it. Measured
 * on a real bun consumer: `bun.lock`'s mtime never moved across 120 s, while the
 * regen plan run by hand fixed the drift in under two seconds.
 *
 * These tests execute the REAL inlined trampoline source under `node -e`, with a
 * stub package manager on PATH and a stub Lisa entrypoint that changes nothing —
 * exactly the idempotent re-apply the old gate mistook for "no drift". The first
 * test fails against the pre-fix trampoline (no regen is ever invoked); the
 * others pin that the fix did not simply make the regen unconditional, and that
 * a regen which cannot run is recorded rather than swallowed.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleReconciliationChild } from "../../src/utils/postinstall-trampoline.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";

/** Owner-only rwx for the stub package manager: no group or other bits. */
const OWNER_ONLY_EXECUTABLE = 0o700;

/** A pid the trampoline's own liveness probe always reports as dead. */
const ALREADY_EXITED_PARENT_PID = 1;
const REGEN_MARKER = "regen-ran.txt";
const REPORT_RELATIVE_PATH = path.join(".lisa", "reconciliation-report.json");
const POST_APPLY_MANIFEST =
  '{"name":"host","overrides":{"esbuild":">=0.28.1"}}\n';
const PRE_APPLY_MANIFEST = '{"name":"host"}\n';

/** Shape of the report the trampoline writes, as these tests read it. */
interface ReportShape {
  readonly outcome: string;
  readonly package_managers?: readonly string[];
  readonly detail?: string;
}

/**
 * Build the real trampoline source by calling the production scheduler with a
 * spawn spy, then handing back the `node -e` payload it would have run.
 * @param projectDir - Project the trampoline targets
 * @param lisaEntry - Stub Lisa entrypoint the child re-invokes
 * @param baselinePackageJsonHash - Pre-apply package.json hash the child compares against
 * @returns The inline JS source the detached child would execute
 */
async function captureTrampolineSource(
  projectDir: string,
  lisaEntry: string,
  baselinePackageJsonHash: string | null
): Promise<string> {
  const spawnSpy = vi.fn().mockReturnValue({ on: vi.fn(), unref: vi.fn() });
  await scheduleReconciliationChild(
    projectDir,
    path.dirname(lisaEntry),
    ALREADY_EXITED_PARENT_PID,
    {
      reportPath: path.join(projectDir, REPORT_RELATIVE_PATH),
      reportSchemaVersion: 1,
      lisaVersion: "0.0.0-test",
      baselinePackageJsonHash,
    },
    spawnSpy as unknown as typeof spawn
  );
  const args = spawnSpy.mock.calls[0]?.[1] as readonly string[];
  return args[1] as string;
}

/**
 * Run the captured trampoline source to completion.
 * @param source - Inline JS the child executes
 * @param projectDir - cwd for the child
 * @param stubBinDir - Directory holding the stub package manager, prepended to PATH
 * @returns Promise resolving when the child exits
 */
function runTrampoline(
  source: string,
  projectDir: string,
  stubBinDir: string
): Promise<void> {
  const inheritedPath = process.env.PATH ?? "";
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["-e", source], {
      cwd: projectDir,
      stdio: "ignore",
      env: { ...process.env, PATH: `${stubBinDir}:${inheritedPath}` },
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

/**
 * Read the report the trampoline child wrote.
 * @param projectDir - Project the trampoline targeted
 * @returns The parsed report
 */
function readReport(projectDir: string): ReportShape {
  return JSON.parse(
    fs.readFileSync(path.join(projectDir, REPORT_RELATIVE_PATH), "utf8")
  ) as ReportShape;
}

/**
 * sha256 of a manifest string, matching the trampoline's own hashing.
 * @param contents - File contents
 * @returns Hex digest
 */
function hashOf(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

describe("postinstall trampoline lockfile regen (#2750)", () => {
  let tempDir: string;
  let projectDir: string;
  let stubBinDir: string;
  let lisaEntry: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    stubBinDir = path.join(tempDir, "bin");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(stubBinDir, { recursive: true });

    // The project as the FIRST apply left it: package.json already rewritten,
    // bun.lock still describing the pre-apply manifest.
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      POST_APPLY_MANIFEST
    );
    fs.writeFileSync(path.join(projectDir, "bun.lock"), "{}\n");

    // A stub `bun` that records having been asked to regenerate. Its invocation
    // is the assertion: the pre-fix trampoline never reaches it at all.
    const stubBun = path.join(stubBinDir, "bun");
    fs.writeFileSync(
      stubBun,
      `#!/bin/sh\necho "$@" >> "${path.join(projectDir, REGEN_MARKER)}"\n`
    );
    fs.chmodSync(stubBun, OWNER_ONLY_EXECUTABLE);

    // A stub Lisa whose re-apply is idempotent — the real one is too, which is
    // precisely why the old gate never fired.
    lisaEntry = path.join(tempDir, "dist", "index.js");
    fs.mkdirSync(path.dirname(lisaEntry), { recursive: true });
    fs.writeFileSync(lisaEntry, "process.exit(0);\n");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("regenerates the lockfile when the FIRST apply changed package.json, even though the re-apply changes nothing", async () => {
    const source = await captureTrampolineSource(
      projectDir,
      lisaEntry,
      hashOf(PRE_APPLY_MANIFEST)
    );

    await runTrampoline(source, projectDir, stubBinDir);

    const markerPath = path.join(projectDir, REGEN_MARKER);
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(fs.readFileSync(markerPath, "utf8")).toContain("--ignore-scripts");

    const report = readReport(projectDir);
    expect(report.outcome).toBe("regenerated");
    expect(report.package_managers).toContain("bun");
  });

  it("does not regenerate when package.json still matches what the lockfile was built from", async () => {
    const source = await captureTrampolineSource(
      projectDir,
      lisaEntry,
      hashOf(POST_APPLY_MANIFEST)
    );

    await runTrampoline(source, projectDir, stubBinDir);

    expect(fs.existsSync(path.join(projectDir, REGEN_MARKER))).toBe(false);
    expect(readReport(projectDir).outcome).toBe("not-needed");
  });

  it("records a regen that failed instead of swallowing it", async () => {
    // The regen command runs and fails. The install must still not break — the
    // best-effort contract is unchanged — but the failure must stop being
    // invisible, which is the half of #2750 that keeps the next regression here
    // findable.
    fs.writeFileSync(path.join(stubBinDir, "bun"), "#!/bin/sh\nexit 1\n");
    fs.chmodSync(path.join(stubBinDir, "bun"), OWNER_ONLY_EXECUTABLE);
    const source = await captureTrampolineSource(
      projectDir,
      lisaEntry,
      hashOf(PRE_APPLY_MANIFEST)
    );

    await runTrampoline(source, projectDir, stubBinDir);

    const report = readReport(projectDir);
    expect(report.outcome).toBe("failed");
    expect(report.detail).toContain("bun");
    expect(report.detail).toContain("frozen-lockfile");
  });
});
