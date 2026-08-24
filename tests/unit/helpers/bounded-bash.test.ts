/**
 * Tests for the bounded, process-group-scoped bash runner.
 *
 * The load-bearing case is `reaps a grandchild that outlives bash`. It pins the
 * measured difference that motivated this helper: `execFile`'s timeout signals
 * only the direct child, so a fixture's `jq` / `node` / `git` grandchildren
 * survive it reparented to PID 1 — which is how 142 and later 227 stale trees
 * accumulated. A process-group kill reaches them; a direct-child kill does not.
 *
 * @module tests/unit/helpers/bounded-bash
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  liveGroupCount,
  reapLiveGroups,
  runBoundedBash,
} from "../../helpers/bounded-bash.js";

const roots: string[] = [];

/**
 * Create a temp fixture root tracked for cleanup.
 * @returns Absolute path to the fixture root.
 */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-test-bounded-bash-"));
  roots.push(root);
  return root;
}

/**
 * Write a script into a fixture root.
 * @param root - Fixture root.
 * @param body - Script body.
 * @returns Absolute path to the script.
 */
async function writeScript(root: string, body: string): Promise<string> {
  const scriptPath = path.join(root, "script.sh");
  await writeFile(scriptPath, body, "utf8");
  return scriptPath;
}

/**
 * Whether a pid is currently alive.
 * @param pid - Process id to probe.
 * @returns True when the process exists.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  reapLiveGroups();
  await Promise.all(
    roots.splice(0).map(r => rm(r, { force: true, recursive: true }))
  );
});

describe("runBoundedBash", () => {
  it("resolves with stdout and stderr on success", async () => {
    const root = await makeRoot();
    const script = await writeScript(
      root,
      "#!/usr/bin/env bash\necho out\necho err >&2\n"
    );
    const result = await runBoundedBash(script);
    expect(result.stdout).toContain("out");
    expect(result.stderr).toContain("err");
  });

  it("rejects on a non-zero exit and surfaces stderr", async () => {
    const root = await makeRoot();
    const script = await writeScript(
      root,
      "#!/usr/bin/env bash\necho boom >&2\nexit 3\n"
    );
    await expect(runBoundedBash(script)).rejects.toThrow("exited with code 3");
  });

  it("rejects when the script exceeds its wall-clock bound", async () => {
    const root = await makeRoot();
    const script = await writeScript(root, "#!/usr/bin/env bash\nsleep 60\n");
    await expect(runBoundedBash(script, { timeoutMs: 500 })).rejects.toThrow(
      "process group was killed"
    );
  });

  it("leaves no outstanding process group after a completed run", async () => {
    const root = await makeRoot();
    const script = await writeScript(root, "#!/usr/bin/env bash\necho done\n");
    await runBoundedBash(script);
    expect(liveGroupCount()).toBe(0);
  });

  it("reaps a grandchild that outlives bash, which execFile's timeout does not", async () => {
    const root = await makeRoot();
    /**
     * bash backgrounds a long-lived grandchild, records its pid to a file, and
     * waits. The pid goes to a file rather than stdout so it is readable even
     * though the timed-out call rejects.
     * @param pidFile - Where the script records the grandchild pid.
     * @returns The script body.
     */
    const body = (pidFile: string): string =>
      `#!/usr/bin/env bash\nsleep 120 &\necho $! > ${pidFile}\nwait\n`;

    /**
     * Read the grandchild pid the script recorded.
     * @param pidFile - Path the script wrote.
     * @returns The recorded pid.
     */
    const readPid = async (pidFile: string): Promise<number> =>
      Number((await readFile(pidFile, "utf8")).trim());

    // Control: the plain execFile path this helper replaces.
    const controlPidFile = path.join(root, "control.pid");
    const controlScript = await writeScript(root, body(controlPidFile));
    /* eslint-disable sonarjs/no-os-command-from-path -- fixed executable, fixture-owned argv */
    execFile(
      "bash",
      [controlScript],
      { killSignal: "SIGKILL", timeout: 800 },
      () => {}
    );
    /* eslint-enable sonarjs/no-os-command-from-path -- end control spawn scope */

    // Subject: the bounded runner, same script, same bound.
    const subjectRoot = await makeRoot();
    const subjectPidFile = path.join(subjectRoot, "subject.pid");
    const subjectScript = await writeScript(subjectRoot, body(subjectPidFile));
    await expect(
      runBoundedBash(subjectScript, { timeoutMs: 800 })
    ).rejects.toThrow("process group was killed");

    // Let both kill paths finish, including the group SIGKILL escalation.
    await new Promise(resolve => setTimeout(resolve, 3500));

    const controlGrandchild = await readPid(controlPidFile);
    const subjectGrandchild = await readPid(subjectPidFile);
    const controlSurvived = isAlive(controlGrandchild);
    const subjectSurvived = isAlive(subjectGrandchild);
    if (controlSurvived) process.kill(controlGrandchild, "SIGKILL");
    if (subjectSurvived) process.kill(subjectGrandchild, "SIGKILL");

    // The measured difference that motivated this helper: execFile's timeout
    // kills bash and orphans its grandchild; a process-group kill reaps it.
    expect(controlSurvived).toBe(true);
    expect(subjectSurvived).toBe(false);
    expect(liveGroupCount()).toBe(0);
  });
});
