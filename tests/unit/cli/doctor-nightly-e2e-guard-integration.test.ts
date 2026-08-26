/**
 * Doctor-surface integration for nightly guard contract findings.
 *
 * The same `DoctorCheck` must drive human text, JSON, and exit status. This
 * suite also hashes the fixture inputs around the full doctor run: detection is
 * advisory and must never repair a workflow, rename a context, or touch a guard.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-integration.test
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "../../../src/cli/doctor.js";
import { NIGHTLY_GUARD_CHECK_NAME } from "../../../src/cli/doctor-nightly-e2e-guard.js";

const CANONICAL_GUARD = "scripts/check-nightly-e2e-health.mjs";
const OFF_PATH_GUARD = "scripts/custom-nightly-gate.mjs";
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../..");

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-doctor-nightly-"));
  await mkdir(path.join(projectRoot, ".github", "workflows"), {
    recursive: true,
  });
  await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectRoot, { force: true, recursive: true });
});

/**
 * Write the active direct caller and its target.
 * @param targetPath - Literal project-relative target
 * @param source - Target module source
 */
async function fixture(targetPath: string, source: string): Promise<void> {
  await writeFile(
    path.join(projectRoot, ".github", "workflows", "active.yml"),
    `
'on': [pull_request]
jobs:
  gate:
    name: Existing required context
    runs-on: ubuntu-latest
    env:
      GATE_BYPASS: \${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    steps:
      - run: node ${targetPath}
`
  );
  await writeFile(path.join(projectRoot, targetPath), source);
}

/**
 * Hash the two caller-owned inputs this doctor arm may only read.
 * @param targetPath - Literal target paired with the active fixture workflow
 * @returns Stable digest of workflow and target bytes
 */
async function fixtureHash(targetPath: string): Promise<string> {
  const hash = createHash("sha256");
  for (const relative of [
    ".github/workflows/active.yml",
    targetPath,
  ] as const) {
    hash.update(await readFile(path.join(projectRoot, relative)));
  }
  return hash.digest("hex");
}

describe("runDoctor nightly guard integration", () => {
  it("wires the check immediately after two-channel drift", async () => {
    const result = await runDoctor(
      projectRoot,
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        setExitCode: vi.fn(),
        write: vi.fn(),
      }
    );
    const drift = result.checks.findIndex(
      check => check.name === "Two-channel delivery drift"
    );
    const guard = result.checks.findIndex(
      check => check.name === NIGHTLY_GUARD_CHECK_NAME
    );
    expect(drift).toBeGreaterThanOrEqual(0);
    expect(guard).toBe(drift + 1);
  });

  it("AC1 leaves exit green for a compatible active caller", async () => {
    await fixture(
      CANONICAL_GUARD,
      await readFile(
        path.join(
          REPOSITORY_ROOT,
          "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs"
        ),
        "utf8"
      )
    );
    const setExitCode = vi.fn();
    const result = await runDoctor(
      projectRoot,
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        setExitCode,
        write: vi.fn(),
      }
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: NIGHTLY_GUARD_CHECK_NAME,
        status: "ok",
        detail: expect.stringContaining("1.7.0"),
      })
    );
    expect(setExitCode).not.toHaveBeenCalledWith(1);
  });

  it("AC5 keeps no-bypass determinate-zero independent from another doctor failure", async () => {
    await writeFile(path.join(projectRoot, ".lisa.config.json"), "{");
    const setExitCode = vi.fn();
    const result = await runDoctor(
      projectRoot,
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        setExitCode,
        write: vi.fn(),
      }
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: NIGHTLY_GUARD_CHECK_NAME,
        status: "ok",
        detail: expect.stringMatching(/determinate zero|0 bypass-bearing/u),
      })
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: "Project Lisa config present?",
        status: "fail",
      })
    );
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("AC6 makes an unavailable guard proof fail doctor exit status", async () => {
    await fixture(OFF_PATH_GUARD, "process.exitCode = 4;");
    const setExitCode = vi.fn();
    const result = await runDoctor(
      projectRoot,
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        setExitCode,
        write: vi.fn(),
      }
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        name: NIGHTLY_GUARD_CHECK_NAME,
        status: "fail",
        detail: expect.stringContaining(OFF_PATH_GUARD),
      })
    );
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("AC8 emits identical facts in human and JSON modes and changes no caller bytes", async () => {
    await fixture(OFF_PATH_GUARD, "process.exitCode = 4;");
    const before = await fixtureHash(OFF_PATH_GUARD);
    const humanWrite = vi.fn();
    const humanExit = vi.fn();
    const human = await runDoctor(
      projectRoot,
      { offline: true },
      {
        runUpdateCheck: vi.fn(),
        setExitCode: humanExit,
        write: humanWrite,
      }
    );
    const humanFinding = human.checks.find(
      check => check.name === NIGHTLY_GUARD_CHECK_NAME
    );

    const jsonWrite = vi.fn();
    const jsonExit = vi.fn();
    const json = await runDoctor(
      projectRoot,
      { json: true, offline: true },
      {
        runUpdateCheck: vi.fn(),
        setExitCode: jsonExit,
        write: jsonWrite,
      }
    );
    const jsonFinding = json.checks.find(
      check => check.name === NIGHTLY_GUARD_CHECK_NAME
    );

    expect(jsonFinding).toEqual(humanFinding);
    expect(
      JSON.parse(jsonWrite.mock.calls[0]?.[0] as string).checks
    ).toContainEqual(humanFinding);
    expect(humanWrite.mock.calls[0]?.[0]).toContain(humanFinding?.detail);
    expect(humanFinding?.detail).toContain(".github/workflows/active.yml#gate");
    expect(humanFinding?.detail).toContain(OFF_PATH_GUARD);
    expect(humanFinding?.detail).toMatch(/provenance|untrusted/u);
    expect(humanFinding?.detail).toMatch(/Remediation:/u);
    expect(humanExit).toHaveBeenCalledWith(1);
    expect(jsonExit).toHaveBeenCalledWith(1);
    expect(await fixtureHash(OFF_PATH_GUARD)).toBe(before);
  });

  it("bounds the same huge caller-attribution refusal in human and JSON output", async () => {
    for (let index = 0; index < 64; index += 1) {
      const suffix = String(index).padStart(2, "0");
      await writeFile(
        path.join(
          projectRoot,
          ".github",
          "workflows",
          `root-${suffix}-${"w".repeat(48)}.yml`
        ),
        `'on': [pull_request]\njobs:\n  gate_${suffix}_${"j".repeat(48)}:\n    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main\n`
      );
    }

    const humanWrite = vi.fn();
    const human = await runDoctor(
      projectRoot,
      { offline: true },
      { runUpdateCheck: vi.fn(), write: humanWrite }
    );
    const jsonWrite = vi.fn();
    const json = await runDoctor(
      projectRoot,
      { json: true, offline: true },
      { runUpdateCheck: vi.fn(), write: jsonWrite }
    );
    const humanFinding = human.checks.find(
      check => check.name === NIGHTLY_GUARD_CHECK_NAME
    );
    const jsonFinding = json.checks.find(
      check => check.name === NIGHTLY_GUARD_CHECK_NAME
    );

    expect(jsonFinding).toEqual(humanFinding);
    expect(humanFinding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/caller attribution.*byte limit/u),
    });
    expect(Buffer.byteLength(humanFinding?.detail ?? "")).toBeLessThanOrEqual(
      4 * 1024
    );
    expect(humanWrite.mock.calls[0]?.[0]).toContain(humanFinding?.detail);
    expect(
      JSON.parse(jsonWrite.mock.calls[0]?.[0] as string).checks
    ).toContainEqual(humanFinding);
  });
});
