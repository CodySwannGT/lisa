/**
 * Contract tests for the Android runner DISK PREFLIGHT on the Maestro native
 * e2e reusable workflow.
 *
 * The emulator creates its userdata partition at launch. On a runner that is
 * too full it does not fail loudly — the emulator process exits in ~0.2s with
 * `FATAL | Not enough space to create userdata partition.` and
 * `reactivecircus/android-emulator-runner` then polls a process that already
 * exited for its entire 600s boot timeout. The suite executes zero flows and
 * the run reads, ten minutes later, as a generic boot timeout. A verified
 * occurrence had 6925.66 MB available against 7372.80 MB required.
 *
 * Two properties are pinned here, and the second is why this file executes the
 * step's script rather than only reading it:
 *
 * 1. STRUCTURE — the preflight exists, runs IMMEDIATELY before the emulator
 *    action, and reclaims only an allowlist that excludes the workspace, the
 *    job's own artifacts, and the Android SDK directories the emulator needs
 *    (`platform-tools`, `emulator`, `cmdline-tools`, `system-images`).
 * 2. BEHAVIOUR — the capacity decision itself. A structural test can prove an
 *    `exit 1` is present; only running the script proves it fires below the
 *    floor, stays quiet above it, and that the failure text still carries the
 *    MEASURED free space alongside the floor. That message is the entire
 *    value of the change: without the numbers the operator is back to a
 *    generic red step.
 *
 * The behavioural harness sources the extracted script with `sudo` and `df`
 * defined as shell FUNCTIONS. Function definitions take precedence over PATH
 * lookup, so the reclaim loop can never reach a real `sudo rm -rf` on the
 * machine running the tests — a PATH shim would not be a strong enough
 * guarantee for a script whose body deletes system directories.
 * @module tests/integration/maestro-native-disk-preflight
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/**
 * The floor the workflow must enforce, in MiB. 8 GiB — hardcoded here rather
 * than read back out of the workflow, because a test that derives the expected
 * value from the file under test asserts nothing about the value.
 */
const EXPECTED_FLOOR_MB = "8192";

/**
 * Absolute interpreter path for the behavioural harness. Present on every
 * platform this suite runs on, and fixed so the harness cannot be resolved
 * out of a writable PATH entry.
 */
const BASH = "/bin/bash";

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

/** Outcome of one harness invocation of the preflight script. */
interface HarnessResult {
  status: number;
  output: string;
}

describe("maestro-native-e2e android disk preflight", () => {
  let androidSteps: WorkflowStep[];
  let preflightIndex: number;
  let emulatorIndex: number;
  let preflight: WorkflowStep | undefined;
  let workDir: string;

  beforeAll(async () => {
    const workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
    androidSteps = workflow.jobs.android?.steps ?? [];
    emulatorIndex = androidSteps.findIndex(step =>
      step.uses?.startsWith("reactivecircus/android-emulator-runner")
    );
    preflightIndex = androidSteps.findIndex(step =>
      /reclaim runner disk/i.test(step.name ?? "")
    );
    preflight = androidSteps[preflightIndex];

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-disk-preflight-"));
  });

  afterAll(async () => {
    if (workDir) {
      await fs.remove(workDir);
    }
  });

  /**
   * Executes the workflow step's own script under stubbed `df` and `sudo`.
   * @param beforeMb - Free MiB the stubbed `df` reports on its first call.
   * @param afterMb - Free MiB it reports on every later call.
   * @param diskSize - Value of `android_emulator_disk_size`; empty means the
   *   caller set nothing. Overrides the literal `${{ }}` text the step's `env`
   *   carries out of the YAML, which nothing expands outside a runner.
   * @returns The script's exit status and its combined output.
   */
  const runPreflight = async (
    beforeMb: number,
    afterMb: number,
    diskSize = ""
  ): Promise<HarnessResult> => {
    const caseDir = await fs.mkdtemp(path.join(workDir, "case-"));
    const bodyPath = path.join(caseDir, "preflight.sh");
    const harnessPath = path.join(caseDir, "harness.sh");
    const summaryPath = path.join(caseDir, "summary.md");
    const counterPath = path.join(caseDir, "df-calls");
    const fakeHome = path.join(caseDir, "home");

    await fs.ensureDir(fakeHome);
    await fs.writeFile(summaryPath, "");
    await fs.writeFile(bodyPath, preflight?.run ?? "");
    // `sudo` and `df` are FUNCTIONS, not PATH entries: a sourced script
    // resolves a function ahead of any executable, so the reclaim loop cannot
    // reach the real `sudo rm -rf` even if this machine has those paths.
    await fs.writeFile(
      harnessPath,
      [
        "#!/usr/bin/env bash",
        'sudo() { echo "[stub sudo] $*"; return 0; }',
        'rm() { echo "[stub rm] $*"; return 0; }',
        "df() {",
        '  calls=$(cat "$STUB_DF_COUNTER")',
        '  echo $(( calls + 1 )) > "$STUB_DF_COUNTER"',
        '  if [ "$calls" -eq 0 ]; then avail="$STUB_FREE_BEFORE_MB";',
        '  else avail="$STUB_FREE_AFTER_MB"; fi',
        "  printf 'Filesystem 1048576-blocks Used Available Capacity Mounted\\n'",
        "  printf '/dev/root 72000 60000 %s 84%% /\\n' \"$avail\"",
        "}",
        `. "${bodyPath}"`,
        "",
      ].join("\n")
    );
    await fs.writeFile(counterPath, "0\n");

    const env = {
      ...process.env,
      ...preflight?.env,
      HOME: fakeHome,
      GITHUB_STEP_SUMMARY: summaryPath,
      STUB_DF_COUNTER: counterPath,
      STUB_FREE_BEFORE_MB: String(beforeMb),
      STUB_FREE_AFTER_MB: String(afterMb),
      // AFTER the `preflight?.env` spread, deliberately. That spread carries
      // the step's env verbatim out of the YAML, so this key arrives as the
      // literal text `${{ inputs.android_emulator_disk_size }}` — Actions
      // expands it on a runner, nothing expands it here. Left as-is the script
      // would try to parse that string as a size and refuse, which is the
      // correct behaviour for a genuinely unreadable value and the wrong
      // behaviour for a test bench. Overriding it is what makes the default
      // case (`""`) mean "caller set nothing".
      ANDROID_EMULATOR_DISK_SIZE: diskSize,
    };

    try {
      // Absolute path, never a PATH lookup: the harness exists to bound what
      // this script can touch, so the interpreter running it must not itself
      // be resolvable from a writable directory.
      const stdout = boundedExecFileSync({
        label: "android disk preflight harness",
        command: BASH,
        args: [harnessPath],
        env,
      });
      return { status: 0, output: stdout };
    } catch (error) {
      const failure = error as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        status: failure.status ?? 1,
        output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      };
    }
  };

  it("finds both steps it is asserting about", () => {
    // Guard for every ordering assertion below: a renamed or deleted step
    // would otherwise make them vacuous rather than red.
    expect(emulatorIndex).toBeGreaterThanOrEqual(0);
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
  });

  it("runs the preflight IMMEDIATELY before the emulator action", () => {
    // Adjacency, not merely "somewhere earlier". Any step inserted between the
    // two could itself consume the headroom the preflight just measured, which
    // would make the measurement a claim about a moment that has passed.
    expect(preflightIndex).toBe(emulatorIndex - 1);
  });

  it("declares the 8 GiB floor as step configuration, not a buried literal", () => {
    expect(preflight?.env?.ANDROID_DISK_FLOOR_MB).toBe(EXPECTED_FLOOR_MB);
  });

  it("reclaims an allowlist that spares the emulator's own dependencies", () => {
    const script = preflight?.run ?? "";
    // Present: toolchains this job provably never invokes.
    for (const reclaimed of [
      "/usr/local/lib/android/sdk/ndk",
      "/usr/share/dotnet",
      "/usr/local/.ghcup",
      "/opt/ghc",
      "/usr/local/share/powershell",
      "/usr/share/swift",
      "/opt/hostedtoolcache/CodeQL",
    ]) {
      expect(script, `expected ${reclaimed} in the allowlist`).toContain(
        reclaimed
      );
    }
    // Absent: the SDK pieces the emulator boots with, and any sweep of the
    // workspace or the runner home. Deleting one of these would trade a
    // capacity failure for a harder-to-read setup failure.
    for (const preserved of [
      "/usr/local/lib/android/sdk/platform-tools",
      "/usr/local/lib/android/sdk/emulator",
      "/usr/local/lib/android/sdk/cmdline-tools",
      "/usr/local/lib/android/sdk/system-images",
      "$GITHUB_WORKSPACE",
    ]) {
      expect(
        script.includes(`rm -rf ${preserved}`) ||
          script.includes(`${preserved} \\`) ||
          script.includes(`${preserved};`),
        `${preserved} must never be reclaimed`
      ).toBe(false);
    }
  });

  it("logs free space before AND after cleanup when capacity is sufficient", async () => {
    const result = await runPreflight(9000, 20_000);
    expect(result.status).toBe(0);
    expect(result.output).toContain("before cleanup: 9000 MB");
    expect(result.output).toContain("after cleanup: 20000 MB");
  });

  it("lets the emulator action run once the floor is met after cleanup", async () => {
    // The shortfall case from the verified occurrence: 6925 MB before, which
    // is below the floor, brought above it by the reclaim. Exiting non-zero
    // here would turn a recoverable runner into a red suite.
    const result = await runPreflight(6925, 12_500);
    expect(result.status).toBe(0);
  });

  it("fails before the emulator action when cleanup cannot reach the floor", async () => {
    const result = await runPreflight(6925, 7100);
    expect(result.status).not.toBe(0);
  });

  it("names the MEASURED free space and the floor in the failure", async () => {
    // Without both numbers the operator is back to a generic red step and has
    // to reconstruct the shortfall from the raw log — which is exactly the
    // state this change exists to end.
    const result = await runPreflight(6925, 7100);
    expect(result.output).toContain("7100");
    expect(result.output).toContain(EXPECTED_FLOOR_MB);
    expect(result.output).toMatch(/userdata partition/i);
  });

  /**
   * The coupling between `android_emulator_disk_size` and this floor, which is
   * the whole reason the input could not ship on its own.
   *
   * A floor left at the 8192 literal turns that input into a way to re-create
   * the exact failure this preflight prevents: the caller asks for 12G, the
   * check compares free space against 8192 and PASSES, and the emulator then
   * cannot allocate 12G, dies in ~0.2s, and the run spends the whole boot
   * timeout polling a dead process. It lands in the one configuration where
   * the operator has explicitly said they need more space and is therefore
   * least likely to suspect capacity.
   *
   * Each case runs the shipped script; none of them reads the floor back out
   * of the file under test.
   */
  describe("the floor tracks the requested partition size", () => {
    it("keeps the 8 GiB floor when the caller sets no size", async () => {
      // 9000 MB free clears 8192 but would NOT clear a raised floor, so this
      // also proves the derivation stays out of the way when unused.
      const result = await runPreflight(9000, 9000);
      expect(result.status).toBe(0);
    });

    it("refuses a 12G partition on a runner that only clears the default floor", async () => {
      // 9000 MB free: enough for the default AVD, nowhere near 12G + headroom.
      // Before the derivation this passed and the emulator died at launch.
      const result = await runPreflight(9000, 9000, "12G");
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("13312");
    });

    it("allows a 12G partition on a runner that can hold it", async () => {
      const result = await runPreflight(9000, 20_000, "12G");
      expect(result.status).toBe(0);
    });

    it("explains that the requested size is what raised the floor", async () => {
      // Without this the operator sees a capacity failure naming a number they
      // never configured, on a runner that was fine yesterday.
      const result = await runPreflight(9000, 9000, "12G");
      expect(result.output).toMatch(/android_emulator_disk_size/);
      expect(result.output).toContain("12G");
    });

    it("never lets a SMALLER requested partition lower the floor", async () => {
      // A caller asking for 2G must not be able to talk this check into
      // passing on a runner still too full for the emulator's working set.
      const result = await runPreflight(6925, 7100, "2G");
      expect(result.status).not.toBe(0);
      expect(result.output).toContain(EXPECTED_FLOOR_MB);
    });

    it("accepts every size unit the action documents", async () => {
      // Bytes, K, M and G — the grammar `disk-size` declares. A unit this
      // could not read would silently fall back to the default floor, which is
      // the trap above wearing a different hat. All four spell 12 GiB, so all
      // four must land on the same derived floor; a unit converted wrongly
      // shows up here as a different number rather than as a pass.
      for (const size of ["12884901888", "12582912K", "12288M", "12G"]) {
        const result = await runPreflight(9000, 9000, size);
        expect(result.status, `expected ${size} to raise the floor`).not.toBe(
          0
        );
        expect(result.output).toContain("13312");
      }
    });

    it("refuses a size it cannot parse rather than ignoring it", async () => {
      // Ignoring an unreadable value would reinstate the default floor while
      // looking like the request had been honoured — a silent downgrade of the
      // exact check the caller was trying to strengthen.
      for (const bad of ["12GB", "abc", "-4G"]) {
        const result = await runPreflight(20_000, 20_000, bad);
        expect(result.status, `expected ${bad} to be refused`).not.toBe(0);
        expect(result.output).toMatch(/not a size|is not/i);
      }
    });
  });

  it("does not delete anything when the reclaim loop is stubbed away", async () => {
    // Proves the harness above is honest: every removal in the run went
    // through the stub, so the passing assertions were not bought by deleting
    // real directories on the machine running the tests.
    const result = await runPreflight(9000, 20_000);
    const removals = result.output
      .split("\n")
      .filter(line => line.includes("rm -rf"));
    for (const line of removals) {
      expect(line).toContain("[stub sudo]");
    }
  });
});
