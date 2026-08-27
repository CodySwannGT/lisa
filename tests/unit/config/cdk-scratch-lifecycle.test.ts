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

import { SCRATCH_NAMESPACE } from "../../../src/configs/vitest/scratch.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { createPackageLisaApplyHarness } from "../../helpers/package-lisa-apply-harness.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const TEST_RUNNER = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");
const TEST_RUNNER_ARGS = [
  "--import",
  "tsx",
  TEST_RUNNER,
  "--profile",
  "cdk",
  "--adapter",
  "vitest",
] as const;
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/cdk-synth-case.ts"
);
const temporaryDirectories: string[] = [];
const INTEGRATION = "test:integration";
const INTEGRATION_LISA = "test:integration:lisa";
const LITERAL_PATH_VALUE = "vitest run tests/integration";

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
        ...TEST_RUNNER_ARGS,
        "--",
        process.execPath,
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
        TMPDIR: scratchBase,
        TMP: scratchBase,
        TEMP: scratchBase,
        LISA_TEST_SCRATCH_PREFIXES: JSON.stringify(["cdk.out"]),
        LISA_TEST_SCRATCH_SUITE: "cdk",
        LISA_CDK_SYNTH_ARM: arm,
        LISA_CDK_SYNTH_MARKER: marker,
      },
    })
  );
}

describe("AWS CDK default synth scratch lifecycle", () => {
  it.each(["pass", "fail", "timeout", "sigterm", "sigkill"])(
    "owns and removes cdk.out after %s",
    arm => {
      const result = runCdk(arm);
      expect(result.assembly).toBeDefined();
      expect(path.basename(result.assembly as string)).toMatch(/^cdk\.out/u);
      expect(result.assembly).toContain(`${SCRATCH_NAMESPACE}${path.sep}run-`);
      expect(result.assembly).toContain(`${path.sep}worker-`);
      expect(existsSync(result.assembly as string)).toBe(false);
    }
  );

  it("cleans a whole-Vitest SIGKILL before the wrapper returns and preserves a live sibling", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "cdk-kill-"));
    temporaryDirectories.push(base);
    const marker = path.join(base, "killed-marker");
    const config = path.join(base, "vitest-whole-sigkill.config.ts");
    writeFileSync(
      config,
      `import { getCdkVitestConfig } from ${JSON.stringify(path.join(REPO_ROOT, "src/configs/vitest/cdk.ts"))};\n` +
        `const config = getCdkVitestConfig();\n` +
        `export default { ...config, test: { ...config.test, include: [${JSON.stringify(FIXTURE)}] } };\n`,
      "utf8"
    );
    const child = spawn(
      process.execPath,
      [
        ...TEST_RUNNER_ARGS,
        "--",
        process.execPath,
        path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
        "run",
        "--root",
        REPO_ROOT,
        "--config",
        config,
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TMPDIR: base,
          TMP: base,
          TEMP: base,
          LISA_TEST_SCRATCH_PREFIXES: JSON.stringify(["cdk.out"]),
          LISA_TEST_SCRATCH_SUITE: "cdk",
          LISA_CDK_SYNTH_ARM: "whole-sigkill",
          LISA_CDK_SYNTH_MARKER: marker,
        },
        stdio: "ignore",
      }
    );
    const deadline = Date.now() + ioLatencyBudgetMs(20_000);
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(existsSync(marker)).toBe(true);
    const killedAssembly = readFileSync(marker, "utf8");
    expect(existsSync(killedAssembly)).toBe(true);
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    const liveSibling = path.join(
      namespace,
      `run-${String(process.pid)}-${String(Date.now())}-livesib`
    );
    mkdirSync(liveSibling);

    const bootstrapDeadline = Date.now() + ioLatencyBudgetMs(20_000);
    let bootstrapPid: number | undefined;
    let vitestPid: number | undefined;
    while (vitestPid === undefined && Date.now() < bootstrapDeadline) {
      const rows = boundedSpawnSync({
        label: "CDK wrapper process inventory",
        command: "/bin/ps",
        args: ["-axo", "pid=,ppid=,command="],
        baseMs: 2_000,
      }).stdout.split("\n");
      const parsed = rows.map(row => row.trim().split(/\s+/u));
      bootstrapPid = parsed
        .filter(fields => Number(fields[1]) === child.pid)
        .find(fields =>
          fields.some(field => field.includes("lisa-test-run-bootstrap"))
        )
        ?.map(Number)[0];
      vitestPid = parsed
        .filter(fields => Number(fields[1]) === bootstrapPid)
        .find(fields => fields.some(field => field.includes("vitest")))
        ?.map(Number)[0];
      if (vitestPid === undefined) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    expect(vitestPid).toBeDefined();
    const exited = new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>(resolve => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    process.kill(vitestPid as number, "SIGKILL");
    const outcome = await exited;
    expect(
      outcome.signal === "SIGKILL" || outcome.code === 137,
      `expected SIGKILL semantics, received ${JSON.stringify(outcome)}`
    ).toBe(true);
    expect(existsSync(killedAssembly)).toBe(false);
    expect(existsSync(liveSibling)).toBe(true);
  });
});

describe("what a cdk apply leaves behind", () => {
  const host = createPackageLisaApplyHarness();

  /**
   * Stand up a cdk-stack host against the shipped templates.
   * @param scripts - Host scripts before apply
   */
  async function cdkHost(scripts: Record<string, string>): Promise<void> {
    await host.installShippedTemplates(["typescript", "cdk"]);
    await host.writeHostPackage(scripts);
    await host.writeHostMarker("cdk.json", {
      app: "node bin/infrastructure.js",
    });
  }

  it("keeps a host test:integration instead of replacing it", async () => {
    const hostValue = "vitest run '.integration.' --passWithNoTests";
    await cdkHost({ [INTEGRATION]: hostValue });
    await host.runApply();
    expect((await host.hostScripts())[INTEGRATION]).toBe(hostValue);
  });

  it("installs a usable test:integration when none exists", async () => {
    await cdkHost({ build: "tsc --noEmit" });
    await host.runApply();
    const scripts = await host.hostScripts();
    expect(scripts[INTEGRATION]).toContain(INTEGRATION_LISA);
    expect(scripts[INTEGRATION]).not.toBe(LITERAL_PATH_VALUE);
    expect(scripts[INTEGRATION_LISA]).toBeDefined();
  });

  it("reclaims a previously forced literal path", async () => {
    await cdkHost({ [INTEGRATION]: LITERAL_PATH_VALUE });
    await host.runApply();
    const scripts = await host.hostScripts();
    expect(scripts[INTEGRATION]).toContain(INTEGRATION_LISA);
    expect(scripts[INTEGRATION]).not.toBe(LITERAL_PATH_VALUE);
  });
});
