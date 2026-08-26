/** End-to-end proof for the real AWS CDK default cloud assembly lifecycle. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  SCRATCH_NAMESPACE,
  SCRATCH_ROOT_ENV,
} from "../../../src/configs/vitest/scratch.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/cdk-synth-case.ts"
);
const KILLED_PROCESS_FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/cdk-synth-process.ts"
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** Result of one isolated CDK Vitest arm. */
interface CdkRunResult {
  readonly run: ReturnType<typeof boundedSpawnSync>;
  readonly assembly: string | undefined;
  readonly scratchBase: string;
}

/**
 * Combine the child result with the assembly path it recorded.
 * @param marker - Parent-owned path marker
 * @param scratchBase - Isolated temp base
 * @param run - Bounded child result
 * @returns Observable lifecycle result
 */
function readCdkRunResult(
  marker: string,
  scratchBase: string,
  run: ReturnType<typeof boundedSpawnSync>
): CdkRunResult {
  const assembly = existsSync(marker)
    ? readFileSync(marker, "utf8")
    : undefined;
  return { run, assembly, scratchBase };
}

/**
 * Run one real CDK synth arm through the public stack configuration.
 * @param arm - Fixture lifecycle arm
 * @param base - Optional shared scratch base for successor proof
 * @returns Child outcome and observed assembly path
 */
function runCdk(arm: string, base?: string): CdkRunResult {
  const scratchBase = base ?? mkdtempSync(path.join(tmpdir(), "cdk-life-"));
  const marker = path.join(scratchBase, `marker-${arm}`);
  const config = path.join(scratchBase, `vitest-${arm}.config.ts`);
  if (base === undefined) temporaryDirectories.push(scratchBase);
  writeFileSync(
    config,
    `import { getCdkVitestConfig } from ${JSON.stringify(path.join(REPO_ROOT, "src/configs/vitest/cdk.ts"))};\n` +
      `const config = getCdkVitestConfig();\n` +
      `export default { ...config, test: { ...config.test, include: [${JSON.stringify(FIXTURE)}] } };\n`,
    "utf8"
  );
  return readCdkRunResult(
    marker,
    scratchBase,
    boundedSpawnSync({
      label: `real CDK synth ${arm}`,
      command: process.execPath,
      args: [
        path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        "--root",
        REPO_ROOT,
        "--config",
        config,
      ],
      baseMs: 30_000,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        [SCRATCH_ROOT_ENV]: scratchBase,
        LISA_CDK_SYNTH_ARM: arm,
        LISA_CDK_SYNTH_MARKER: marker,
      },
    })
  );
}

describe("AWS CDK default synth scratch lifecycle", () => {
  it.each(["pass", "fail", "timeout", "sigterm"])(
    "owns and removes cdk.out after %s",
    arm => {
      const result = runCdk(arm);
      expect(result.assembly).toBeDefined();
      expect(path.basename(result.assembly as string)).toMatch(/^cdk\.out/u);
      expect(result.assembly).toContain(`${SCRATCH_NAMESPACE}${path.sep}run-`);
      expect(existsSync(result.assembly as string)).toBe(false);
    }
  );

  it("lets a successor reclaim SIGKILL residue without deleting a live sibling", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "cdk-kill-"));
    temporaryDirectories.push(base);
    const marker = path.join(base, "killed-marker");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", KILLED_PROCESS_FIXTURE],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          [SCRATCH_ROOT_ENV]: base,
          TMPDIR: base,
          TMP: base,
          TEMP: base,
          LISA_TEST_SCRATCH_PREFIXES: JSON.stringify(["cdk.out"]),
          LISA_TEST_SCRATCH_SUITE: "cdk",
          LISA_CDK_SYNTH_MARKER: marker,
        },
        stdio: "ignore",
      }
    );
    const deadline = Date.now() + 20_000;
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(existsSync(marker)).toBe(true);
    const killedAssembly = readFileSync(marker, "utf8");
    expect(existsSync(killedAssembly)).toBe(true);
    const exited = new Promise<void>(resolve => {
      child.once("exit", () => resolve());
    });
    child.kill("SIGKILL");
    await exited;
    expect(existsSync(killedAssembly)).toBe(true);

    const namespace = path.join(base, SCRATCH_NAMESPACE);
    const liveSibling = path.join(
      namespace,
      `run-${String(process.pid)}-${String(Date.now())}-livesib`
    );
    mkdirSync(liveSibling);

    const successor = runCdk("pass", base);
    expect(successor.run.status).toBe(0);
    expect(existsSync(killedAssembly)).toBe(false);
    expect(existsSync(liveSibling)).toBe(true);
  });
});
