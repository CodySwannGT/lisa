/**
 * Behavioral test for the iOS driver-startup retry, executed rather than
 * asserted: it runs the workflow's own "Run Maestro flows on simulator" shell,
 * pulled verbatim out of the YAML, with the suite stubbed through the
 * workflow's own `flow_runner` seam.
 *
 * The bite control is the pair of outcomes. The retry must re-run the suite
 * after a driver-startup timeout AND refuse to re-run it after an ordinary
 * flow failure — delete the signature check in the workflow and the negative
 * case starts failing with `attempts === 2`, which is the only thing that
 * proves the guard is load-bearing rather than decorative.
 *
 * Sibling of maestro-native-zero-flow.test.ts; both exist because
 * AcmeOrgD/frontend run 31584986248 lost all 83 iOS flows to a driver that
 * never bound its port and reported it as an ordinary red.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  name?: string;
  run?: string;
  env?: Record<string, unknown>;
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

describe("maestro-native-e2e iOS driver-startup retry (executed)", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  /**
   * Runs the real "Run Maestro flows on simulator" step with the suite itself
   * stubbed through the workflow's own `flow_runner` seam, so the retry policy
   * is exercised without a simulator.
   * @param mode - How the stubbed suite behaves on each attempt
   * @returns The step's exit status, how many attempts it made, and its output
   */
  const runSuiteStep = async (
    mode: "driver-then-ok" | "driver-then-driver" | "flow-failure"
  ): Promise<{ status: number; attempts: number; output: string }> => {
    const step = (workflow.jobs.ios.steps ?? []).find(candidate =>
      candidate.name?.includes("Run Maestro flows on simulator")
    );
    if (!step?.run) throw new Error("iOS run step not found");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-retry-"));
    try {
      const bin = path.join(dir, "bin");
      await fs.ensureDir(bin);
      // The retry path recycles the simulator; stub the whole tool.
      await fs.writeFile(
        path.join(bin, "xcrun"),
        "#!/usr/bin/env bash\nexit 0\n",
        { mode: 0o755 }
      );
      const attempts = path.join(dir, "attempts");
      await fs.writeFile(attempts, "0");
      const stub = path.join(dir, "flow-runner.sh");
      await fs.writeFile(
        stub,
        [
          "#!/usr/bin/env bash",
          'n=$(( $(cat "$STUB_ATTEMPTS") + 1 ))',
          'echo "$n" > "$STUB_ATTEMPTS"',
          'if [ "$STUB_MODE" = "flow-failure" ]; then',
          '  echo "[FAILED] some-flow.yaml: Assertion is false: id: home-header"',
          "  exit 1",
          "fi",
          'if [ "$STUB_MODE" = "driver-then-ok" ] && [ "$n" -ge 2 ]; then',
          '  echo "all flows passed"',
          "  exit 0",
          "fi",
          'echo "xcuitest.installer.LocalXCTestInstaller\\$IOSDriverTimeoutException: iOS driver not ready in time, consider increasing timeout by configuring MAESTRO_DRIVER_STARTUP_TIMEOUT env variable"',
          "exit 1",
        ].join("\n"),
        { mode: 0o755 }
      );

      // The script is executed VERBATIM — no substitution. The flows dir now
      // arrives as an env var rather than a `${{ }}` expansion baked into the
      // script text, which is what closes the shell-injection seam on this
      // reusable input. Asserting the script needs no rewriting to run is the
      // proof that no expansion is left in it.
      expect(step.run).not.toContain("${{");
      const script = step.run;
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FLOW_RUNNER: stub,
        FLOWS_DIR: dir,
        MAESTRO_E2E_ARGS: "",
        MAESTRO_DRIVER_STARTUP_TIMEOUT: "240000",
        IOS_SIM_UDID: "STUB-UDID",
        IOS_APP_PATH: dir,
        STUB_ATTEMPTS: attempts,
        STUB_MODE: mode,
      };
      let status = 0;
      let output = "";
      try {
        output = execFileSync(BASH, ["-eo", "pipefail", "-c", script], {
          cwd: dir,
          env,
          encoding: "utf-8",
        });
      } catch (error) {
        const failure = error as { status?: number; stdout?: string };
        status = failure.status ?? -1;
        output = failure.stdout ?? "";
      }
      return {
        status,
        attempts: Number((await fs.readFile(attempts, "utf-8")).trim()),
        output,
      };
    } finally {
      await fs.remove(dir);
    }
  };

  it("retries once and recovers when the driver never binds its port", async () => {
    const result = await runSuiteStep("driver-then-ok");
    expect(result.attempts).toBe(2);
    expect(result.status).toBe(0);
    expect(result.output).toContain("iOS driver failed to start");
    expect(result.output).toContain("iOS driver recovered on retry");
  });

  it("gives up after exactly one retry when the driver never comes back", async () => {
    const result = await runSuiteStep("driver-then-driver");
    expect(result.attempts).toBe(2);
    expect(result.status).toBe(1);
  });

  it("does NOT retry an ordinary flow failure", async () => {
    // The negative half of the bite control. A blanket retry would double a
    // four-hour suite every time one assertion reds — delete the signature
    // check in the workflow and this test starts failing with attempts === 2.
    const result = await runSuiteStep("flow-failure");
    expect(result.attempts).toBe(1);
    expect(result.status).toBe(1);
    expect(result.output).toContain("not retrying");
  });
});
