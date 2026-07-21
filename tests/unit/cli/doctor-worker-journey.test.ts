/**
 * Unit coverage for the shared worker-epoch journey runner (RRR-6, #1858).
 *
 * `checkWorkerEpoch` (#1742) and the readiness execution/proof dimension both
 * consume this one runner — there is no second harness (intake decision F5).
 * This suite pins the extracted resolver directly: it reads
 * `.lisa/worker-config.json`, matches the current-host entry, resolves recorded
 * qualification evidence and epoch drift, and surfaces the scaffolding-
 * subtraction candidate count — degrading (never throwing) on a missing or
 * unparseable record. `doctor-worker-epoch.test.ts` proves the same primitives
 * still render #1742's check byte-for-byte, unmodified.
 * @module tests/unit/cli/doctor-worker-journey
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkerJourneyEvidence } from "../../../src/cli/doctor-worker-journey.js";

const CODEX_HOST = "codex";
const CURRENT_MODEL = "gpt-5.2";
const CURRENT_VERSION = "26.8.0";

let tempDir: string | undefined;
let envRestores: Array<() => void> = [];

/**
 * Resolve a temporary directory for one runner test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-worker-journey-"));
  return tempDir;
}

afterEach(async () => {
  for (const restore of envRestores.toReversed()) {
    restore();
  }
  envRestores = [];
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

/**
 * Set one environment variable and restore it after the test.
 * @param name - Environment variable name
 * @param value - Environment variable value
 */
function setEnv(name: string, value: string): void {
  const previous = process["env"][name];
  process["env"][name] = value;
  envRestores.push(() => {
    if (previous === undefined) {
      delete process["env"][name];
    } else {
      process["env"][name] = previous;
    }
  });
}

/**
 * Point the runtime worker signature at the recorded Codex epoch.
 */
function setWorkerEnv(): void {
  setEnv("LISA_WORKER_HOST", CODEX_HOST);
  setEnv("LISA_WORKER_MODEL", CURRENT_MODEL);
  setEnv("LISA_WORKER_VERSION", CURRENT_VERSION);
}

/**
 * Seed a `.lisa/worker-config.json` record in a temporary Lisa project.
 * @param cwd - Temporary project root
 * @param record - Worker epoch record body
 */
async function seedWorkerRecord(
  cwd: string,
  record: Record<string, unknown>
): Promise<void> {
  await mkdir(path.join(cwd, ".lisa"), { recursive: true });
  await writeFile(
    path.join(cwd, ".lisa", "worker-config.json"),
    JSON.stringify(record)
  );
}

describe("resolveWorkerJourneyEvidence", () => {
  it("reports a missing record without throwing", async () => {
    const cwd = await getTempDir();

    const evidence = await resolveWorkerJourneyEvidence(cwd);

    expect(evidence.recordExists).toBe(false);
    expect(evidence.parseError).toBeNull();
    expect(evidence.matched).toBeUndefined();
    expect(evidence.evidence).toBeNull();
    expect(evidence.subtractionCount).toBe(0);
  });

  it("degrades to a parse error on an unparseable record", async () => {
    const cwd = await getTempDir();
    await mkdir(path.join(cwd, ".lisa"), { recursive: true });
    await writeFile(path.join(cwd, ".lisa", "worker-config.json"), "{not json");

    const evidence = await resolveWorkerJourneyEvidence(cwd);

    expect(evidence.recordExists).toBe(true);
    expect(evidence.parseError).not.toBeNull();
  });

  it("resolves evidence and no drift for the matched in-sync host", async () => {
    const cwd = await getTempDir();
    setWorkerEnv();
    await seedWorkerRecord(cwd, {
      agents: {
        codex: {
          host: CODEX_HOST,
          modelId: CURRENT_MODEL,
          version: CURRENT_VERSION,
          qualificationEvidence: "runs/current.md",
        },
      },
    });

    const evidence = await resolveWorkerJourneyEvidence(cwd);

    expect(evidence.evidence).toBe("runs/current.md");
    expect(evidence.drift).toEqual([]);
    expect(evidence.signature.host).toBe(CODEX_HOST);
  });

  it("computes drift and the subtraction count for an out-of-sync host", async () => {
    const cwd = await getTempDir();
    setWorkerEnv();
    await seedWorkerRecord(cwd, {
      agents: [
        {
          host: CODEX_HOST,
          model: "gpt-5.1",
          version: "26.7.0",
          qualificationEvidence: "runs/previous.md",
        },
      ],
    });
    await mkdir(path.join(cwd, "plugins", "src", "base", "rules"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "plugins", "src", "base", "rules", "worker.md"),
      "This rule is a Codex model workaround for a worker limitation.\n"
    );

    const evidence = await resolveWorkerJourneyEvidence(cwd);

    expect(evidence.drift.length).toBeGreaterThan(0);
    expect(evidence.subtractionCount).toBe(1);
  });
});
