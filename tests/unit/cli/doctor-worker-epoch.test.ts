import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkWorkerEpoch } from "../../../src/cli/doctor-worker-epoch.js";

const LISA_CONFIG_FILE = ".lisa.config.json";
const WORKER_EPOCH_CHECK = "Worker epoch qualified?";
const CODEX_HOST = "codex";
const CURRENT_MODEL = "gpt-5.2";
const CURRENT_VERSION = "26.8.0";

let tempDir: string | undefined;
let envRestores: Array<() => void> = [];

/**
 * Resolve the temporary directory for one worker epoch test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-worker-epoch-"));
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

describe("checkWorkerEpoch", () => {
  it("warns when a Lisa project has no worker epoch record", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{}\n");

    await expect(checkWorkerEpoch(cwd)).resolves.toMatchObject({
      name: WORKER_EPOCH_CHECK,
      status: "warn",
      detail: expect.stringContaining(".lisa/worker-config.json"),
    });
  });

  it("warns on worker epoch drift and surfaces subtraction candidates", async () => {
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

    const check = await checkWorkerEpoch(cwd);

    expect(check.name).toBe(WORKER_EPOCH_CHECK);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("Worker epoch drift detected");
    expect(check.detail).toContain(
      "Scaffolding-subtraction candidates surfaced: 1"
    );
  });

  it("passes when the current worker epoch matches recorded evidence", async () => {
    const cwd = await getTempDir();
    setWorkerEnv();
    await seedWorkerRecord(cwd, {
      agents: {
        codex: {
          host: CODEX_HOST,
          modelId: CURRENT_MODEL,
          version: CURRENT_VERSION,
          evidence: "runs/current.md",
        },
      },
    });

    await expect(checkWorkerEpoch(cwd)).resolves.toMatchObject({
      name: WORKER_EPOCH_CHECK,
      status: "ok",
      detail: expect.stringContaining(
        "qualification evidence: runs/current.md"
      ),
    });
  });

  it("recognizes non-Codex/Claude hosts via LISA_REMOTE_AGENT", async () => {
    const cwd = await getTempDir();
    setEnv("LISA_REMOTE_AGENT", "cursor");
    setEnv("LISA_WORKER_MODEL", CURRENT_MODEL);
    setEnv("LISA_WORKER_VERSION", CURRENT_VERSION);
    await seedWorkerRecord(cwd, {
      agents: {
        cursor: {
          host: "cursor",
          modelId: CURRENT_MODEL,
          version: CURRENT_VERSION,
          evidence: "runs/cursor.md",
        },
      },
    });

    await expect(checkWorkerEpoch(cwd)).resolves.toMatchObject({
      name: WORKER_EPOCH_CHECK,
      status: "ok",
      detail: expect.stringContaining("qualification evidence: runs/cursor.md"),
    });
  });

  it("counts a rationale mentioning Antigravity (without the agy token) as a subtraction candidate", async () => {
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
      "Antigravity needs a scaffold to package skills for its runtime.\n"
    );

    const check = await checkWorkerEpoch(cwd);

    expect(check.detail).toContain(
      "Scaffolding-subtraction candidates surfaced: 1"
    );
  });
});

/**
 * Set the worker environment variables used by the doctor epoch check.
 */
function setWorkerEnv(): void {
  setEnv("LISA_WORKER_HOST", CODEX_HOST);
  setEnv("LISA_WORKER_MODEL", CURRENT_MODEL);
  setEnv("LISA_WORKER_VERSION", CURRENT_VERSION);
}

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
 * Seed a worker epoch record in a temporary Lisa project.
 * @param cwd - Temporary project root
 * @param record - Worker epoch record body
 */
async function seedWorkerRecord(
  cwd: string,
  record: Record<string, unknown>
): Promise<void> {
  await writeFile(path.join(cwd, LISA_CONFIG_FILE), "{}\n");
  await mkdir(path.join(cwd, ".lisa"), { recursive: true });
  await writeFile(
    path.join(cwd, ".lisa", "worker-config.json"),
    JSON.stringify(record)
  );
}
