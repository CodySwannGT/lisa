/**
 * @file doctor-nightly-e2e-guard-deadline.test.ts
 * @description Target deduplication and single whole-operation deadline contract
 * @module tests/unit/cli/doctor-nightly-e2e-guard-deadline.test
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkNightlyE2eGuard } from "../../../src/cli/doctor-nightly-e2e-guard.js";

const CANONICAL_GUARD = "scripts/check-nightly-e2e-health.mjs";
const OFF_PATH_GUARD = "scripts/custom-nightly-gate.mjs";
const WORKFLOWS_DIR = path.join(".github", "workflows");
const ACTIVE_CALLER = ".github/workflows/active.yml#gate";
let projectRoot = "";
let lisaRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-guard-deadline-"));
  lisaRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-package-deadline-"));
  await mkdir(path.join(projectRoot, WORKFLOWS_DIR), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [projectRoot, lisaRoot].map(directory =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

/** Write one active direct guard caller. */
async function activeDirect(): Promise<void> {
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
      - run: node ${CANONICAL_GUARD}
`
  );
}

describe("nightly guard target dedupe and whole-operation deadline", () => {
  it("proves a shared target once and attributes it to every root caller", async () => {
    await activeDirect();
    const second = await readFile(
      path.join(projectRoot, WORKFLOWS_DIR, "active.yml"),
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, WORKFLOWS_DIR, "second.yml"),
      second.replace("gate:", "other_gate:")
    );
    const probeImpl = vi.fn(async () => ({
      state: "compatible" as const,
      version: "1.7.0",
    }));
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      probeImpl,
    });
    expect(result.status).toBe("ok");
    expect(probeImpl).toHaveBeenCalledTimes(1);
    expect(result.detail).toContain(ACTIVE_CALLER);
    expect(result.detail).toContain("second.yml#other_gate");
  });

  it("starts the single 15-second deadline before workflow discovery", async () => {
    let clock = 0;
    const scanImpl = vi.fn(async () => {
      clock = 15_001;
      return { state: "ok" as const, callers: [] };
    });
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      now: () => clock,
      scanImpl,
    });
    expect(scanImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("15 seconds");
    expect(result.detail).not.toContain("determinate zero");
  });

  it("does not start a fresh budget after the first target proof", async () => {
    await activeDirect();
    await writeFile(
      path.join(projectRoot, WORKFLOWS_DIR, "second.yml"),
      `
'on': [pull_request]
jobs:
  other:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main
    with:
      guard_script: ${OFF_PATH_GUARD}
`
    );
    let clock = 0;
    const probeImpl = vi.fn(async () => {
      clock = 15_001;
      return { state: "compatible" as const, version: "1.7.0" };
    });
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      now: () => clock,
      probeImpl,
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("15 seconds");
    expect(probeImpl).toHaveBeenCalledTimes(1);
  });
});
