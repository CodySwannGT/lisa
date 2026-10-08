/** Execute the unit workflow's timer, command status, and cleanup natively. */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { stepsIn } from "./quality-gate-facade-fixture.js";

// One proof waits for the actual 30-second production timer. Its quiet-box
// budget leaves the required 2x margin; other cases exit immediately.
useIoLatencyBudget(75_000);

const steps = stepsIn("test_unit");
const configured = steps.find(step => step.id === "gate_run");
const fallback = steps.find(step => step.id === "test_coverage");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Build an isolated executable command that reports its real argv and status.
 * @returns Fixture root containing the command and package-manager routes.
 */
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-unit-progress-"));
  roots.push(root);
  mkdirSync(path.join(root, "bin"));
  writeFileSync(
    path.join(root, "probe.cjs"),
    [
      'require("node:fs").writeFileSync("called.json", JSON.stringify(process.argv.slice(2)));',
      "setTimeout(() => process.exit(Number(process.env.PROBE_EXIT ?? 0)), Number(process.env.PROBE_DELAY ?? 0));",
    ].join("\n")
  );
  for (const manager of ["npm", "yarn", "bun"]) {
    writeFileSync(
      path.join(root, "bin", manager),
      '#!/bin/sh\nexec node probe.cjs "$@"\n',
      { mode: 0o755 }
    );
  }
  return root;
}

/**
 * Invoke the actual workflow body, adding only observation of its timer PID.
 * @param root - Isolated fixture directory.
 * @param body - Parsed workflow shell source.
 * @param env - Real command settings for this invocation.
 * @returns Native process outcome.
 */
function execute(root: string, body: string, env: Record<string, string>) {
  const observed = body.replace(
    "UNIT_PROGRESS_PID=$!",
    'UNIT_PROGRESS_PID=$!\nprintf "%s" "$UNIT_PROGRESS_PID" > progress.pid'
  );
  return boundedSpawnSync({
    command: "bash",
    args: ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", observed],
    cwd: root,
    baseMs: 37_500,
    label: "unit-test progress workflow",
    env: {
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`,
      BASH_ENV: "/dev/null",
      ENV: "/dev/null",
      ...env,
    },
  });
}

/**
 * Prove the actual timer process has been reaped after the workflow exits.
 * @param root - Fixture directory containing the observed PID.
 */
function expectTimerStopped(root: string): void {
  const pid = Number(readFileSync(path.join(root, "progress.pid"), "utf8"));
  expect(pid).toBeGreaterThan(1);
  expect(() => process.kill(pid, 0)).toThrow();
}

describe("unit-test workflow progress", () => {
  it.each(["node", "exec node"])(
    "preserves %s failures and reaps the timer",
    runner => {
      const root = fixture();
      const result = execute(root, configured?.run ?? "exit 99", {
        GATE_RUNNER: runner,
        GATE_TASK: "probe.cjs",
        PROBE_EXIT: "23",
      });

      expect(result.status, result.stderr).toBe(23);
      expect(readFileSync(path.join(root, "called.json"), "utf8")).toBe("[]");
      expect(result.stdout).toContain("::notice title=Unit-test progress::");
      expectTimerStopped(root);
    }
  );

  it.each(["npm", "yarn", "bun"])(
    "keeps %s fallback argv and exit status",
    manager => {
      const root = fixture();
      const result = execute(root, fallback?.run ?? "exit 99", {
        PACKAGE_MANAGER: manager,
        PROBE_EXIT: "17",
      });

      expect(result.status, result.stderr).toBe(17);
      expect(
        JSON.parse(readFileSync(path.join(root, "called.json"), "utf8"))
      ).toEqual(manager === "yarn" ? ["test:cov"] : ["run", "test:cov"]);
      expectTimerStopped(root);
    }
  );

  it("reports a real quiet command at 30 seconds, then reaps its timer", () => {
    const root = fixture();
    const result = execute(root, configured?.run ?? "exit 99", {
      GATE_RUNNER: "node",
      GATE_TASK: "probe.cjs",
      PROBE_DELAY: "31500",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Command is still running (");
    expect(result.stdout).toContain(
      "Quiet output can include coverage reporting."
    );
    expect(result.stdout).not.toMatch(/all tests finished|job is healthy/i);
    expectTimerStopped(root);
  });
});
