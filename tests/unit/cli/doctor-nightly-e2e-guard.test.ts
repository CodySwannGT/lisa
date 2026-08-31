/**
 * @file doctor-nightly-e2e-guard.test.ts
 * @description Acceptance and provenance-aware remediation contract
 * @module tests/unit/cli/doctor-nightly-e2e-guard.test
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NIGHTLY_GUARD_CHECK_NAME,
  checkNightlyE2eGuard,
} from "../../../src/cli/doctor-nightly-e2e-guard.js";

const CANONICAL_GUARD = "scripts/check-nightly-e2e-health.mjs";
const OFF_PATH_GUARD = "scripts/custom-nightly-gate.mjs";
const WORKFLOWS_DIR = path.join(".github", "workflows");
const SHIPPED_GUARD = path.join(
  "typescript",
  "copy-overwrite",
  "scripts",
  "check-nightly-e2e-health.mjs"
);
const ACTIVE_CALLER = ".github/workflows/active.yml#gate";
const UPGRADE_FIRST = "upgrade first";
const GOOD_GUARD = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs"
  ),
  "utf8"
);

let projectRoot = "";
let lisaRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-nightly-guard-"));
  lisaRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-package-"));
  await mkdir(path.join(projectRoot, WORKFLOWS_DIR), { recursive: true });
  await mkdir(path.join(projectRoot, "scripts"));
  await mkdir(path.join(lisaRoot, path.dirname(SHIPPED_GUARD)), {
    recursive: true,
  });
  await writeFile(path.join(lisaRoot, SHIPPED_GUARD), GOOD_GUARD);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [projectRoot, lisaRoot].map(directory =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

/**
 * Write an active direct workflow for one target.
 * @param target - Literal guard target used by the job
 */
async function activeDirect(target: string): Promise<void> {
  await writeFile(
    path.join(projectRoot, WORKFLOWS_DIR, "active.yml"),
    `
'on': [pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    env:
      GATE_BYPASS: \${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    steps:
      - run: node ${target}
`
  );
}

/**
 * Write one project target, creating its parent.
 * @param relative - Project-relative destination
 * @param source - Complete target source
 */
async function target(relative: string, source: string): Promise<void> {
  const absolute = path.join(projectRoot, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, source);
}

/**
 * Build injected canonical provenance for exact fixture bytes.
 * @param sources - Exact target revisions to attest
 * @returns Canonical destination hash ledger
 */
const ledger = (...sources: readonly string[]) => ({
  [CANONICAL_GUARD]: sources.map(source =>
    createHash("sha256").update(source).digest("hex")
  ),
});

describe("nightly guard doctor acceptance", () => {
  it("AC1 passes a trusted active caller and names caller, path, and version", async () => {
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, GOOD_GUARD);
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD),
    });
    expect(result.status).toBe("ok");
    expect(result.detail).toContain(ACTIVE_CALLER);
    expect(result.detail).toContain(CANONICAL_GUARD);
    expect(result.detail).toContain("1.9.0");
    expect(result.detail).not.toMatch(/remediation|reaper/u);
  });

  it("AC2 fails an active off-path fork beside an unused trusted canonical copy", async () => {
    const fork = "process.exitCode = 0;";
    await activeDirect(OFF_PATH_GUARD);
    await target(OFF_PATH_GUARD, fork);
    await target(CANONICAL_GUARD, GOOD_GUARD);
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD),
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain(ACTIVE_CALLER);
    expect(result.detail).toContain(OFF_PATH_GUARD);
    expect(result.detail).toMatch(/provenance|trusted/u);
    expect(result.detail).toContain("repoint");
    expect(result.detail).toContain("retire");
    expect(result.detail).toContain(
      "preserve the workflow/job names and required-check context"
    );
  });

  it("AC4 passes a trusted direct off-path caller without context migration advice", async () => {
    await activeDirect(OFF_PATH_GUARD);
    await target(OFF_PATH_GUARD, GOOD_GUARD);
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD),
    });
    expect(result.status).toBe("ok");
    expect(result.detail).not.toMatch(/reusable|rename|ruleset|context/u);
  });

  it("AC5 returns determinate zero without install or reaper advice", async () => {
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result).toEqual({
      name: NIGHTLY_GUARD_CHECK_NAME,
      status: "ok",
      detail: expect.stringMatching(/determinate zero|0 bypass-bearing/u),
    });
    expect(result.detail).not.toMatch(/install|reaper|required/u);
  });

  it("AC6 reports malformed discovery as unavailable rather than zero", async () => {
    await writeFile(
      path.join(projectRoot, WORKFLOWS_DIR, "broken.yml"),
      "'on': [pull_request\n"
    );
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Guard discovery unavailable");
    expect(result.detail).toContain(".github/workflows/broken.yml");
    expect(result.detail).not.toContain("determinate zero");
  });

  it("AC7 passes a bounded active guard without requiring a reaper", async () => {
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, GOOD_GUARD);
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD),
    });
    expect(result.status).toBe("ok");
    expect(result.detail).not.toContain("reaper");
  });

  it("caps a successful caller-attribution detail at 4 KiB", async () => {
    const callers = Array.from({ length: 64 }, (_, index) => ({
      workflow: `.github/workflows/${"root".repeat(30)}-${index}.yml`,
      job: `gate_${"x".repeat(80)}_${index}`,
      callPath: `.github/workflows/${"root".repeat(30)}-${index}.yml#gate_${"x".repeat(80)}_${index}`,
      kind: "direct" as const,
      target: CANONICAL_GUARD,
    }));
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      scanImpl: async () => ({ state: "ok", callers }),
      probeImpl: async () => ({ state: "compatible", version: "1.7.0" }),
    });
    expect(Buffer.byteLength(result.detail)).toBeLessThanOrEqual(4 * 1024);
  });

  it("caps an unavailable discovery reason and emits one bounded refusal", async () => {
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      scanImpl: async () => ({
        state: "unavailable",
        failures: [
          {
            workflow: `.github/workflows/${"w".repeat(10_000)}.yml`,
            reason: `invalid caller ${"x".repeat(10_000)}`,
          },
        ],
      }),
    });
    expect(result.status).toBe("fail");
    expect(Buffer.byteLength(result.detail)).toBeLessThanOrEqual(4 * 1024);
    expect(result.detail.match(/Guard discovery unavailable/gu)).toHaveLength(
      1
    );
  });
});

describe("nightly guard remediation classification", () => {
  it(`tells an install with no packaged guard to ${UPGRADE_FIRST}`, async () => {
    await activeDirect(CANONICAL_GUARD);
    await rm(path.join(lisaRoot, SHIPPED_GUARD));
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain(UPGRADE_FIRST);
    expect(result.detail).toContain("2.353.0+");
  });

  it("does not misreport an unreadable packaged guard as an old package", async () => {
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, "untrusted");
    await rm(path.join(lisaRoot, SHIPPED_GUARD));
    await mkdir(path.join(lisaRoot, SHIPPED_GUARD));
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/packaged.*(?:unreadable|regular|corrupt)/u);
    expect(result.detail).not.toContain(UPGRADE_FIRST);
  });

  it("does not prescribe an install from a readable but untrusted package copy", async () => {
    await activeDirect(CANONICAL_GUARD);
    await writeFile(
      path.join(lisaRoot, SHIPPED_GUARD),
      `${GOOD_GUARD}// locally altered package bytes\n`
    );
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD),
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/packaged.*not behavior-certified/u);
    expect(result.detail).toMatch(/generic ownership hash.*insufficient/u);
    expect(result.detail).toMatch(/upgrade|reinstall/u);
    expect(result.detail).not.toContain(UPGRADE_FIRST);
  });

  it("installs a missing canonical host file from a readable package", async () => {
    await activeDirect(CANONICAL_GUARD);
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD),
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain(`install ${CANONICAL_GUARD}`);
    expect(result.detail).toContain("lisa apply .");
    expect(result.detail).not.toContain(UPGRADE_FIRST);
  });

  it("does not prescribe install when the canonical host path is not a file", async () => {
    await activeDirect(CANONICAL_GUARD);
    await mkdir(path.join(projectRoot, CANONICAL_GUARD));
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD),
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/not a regular file|unreadable/u);
    expect(result.detail).not.toMatch(/apply.*install/u);
  });

  it("gives the exact refresh command for a preserved modified canonical copy", async () => {
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, "untrusted host edit");
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD),
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("review");
    expect(result.detail).toContain(
      "lisa apply . --refresh-templates=scripts/check-nightly-e2e-health.mjs"
    );
  });

  it("distinguishes a provably stale canonical copy", async () => {
    const old = 'export const NIGHTLY_E2E_CONTRACT_VERSION = "0.9.0";\n';
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, old);
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(GOOD_GUARD, old),
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("provably stale");
  });

  it("fails an unknown packaged compatible declaration closed with upgrade/apply guidance", async () => {
    const incompatible =
      'export const NIGHTLY_E2E_CONTRACT_VERSION = "1.6.0";\n';
    await writeFile(path.join(lisaRoot, SHIPPED_GUARD), incompatible);
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, incompatible);
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: ledger(incompatible),
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/behavior certificate|behavior-certified/u);
    expect(result.detail).toMatch(/upgrade|reinstall/u);
    expect(result.detail).toContain("lisa apply .");
  });
});
