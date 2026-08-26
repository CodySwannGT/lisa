/**
 * Behavioral contract for probing the guard an active nightly caller invokes.
 *
 * The target scripts are real child processes. That matters here: status,
 * signal, timeout, output overflow, permission mode, environment projection,
 * and shell avoidance are the security boundary, not incidental plumbing.
 * @module tests/unit/cli/doctor-nightly-e2e-guard.test
 */
/* eslint-disable max-lines -- real process failures, remediation variants, and eight ACs stay reviewable as one contract matrix */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NIGHTLY_GUARD_CHECK_NAME,
  checkNightlyE2eGuard,
  probeNightlyE2eGuardTarget,
} from "../../../src/cli/doctor-nightly-e2e-guard.js";

const CANONICAL_GUARD = "scripts/check-nightly-e2e-health.mjs";
const OFF_PATH_GUARD = "scripts/custom-nightly-gate.mjs";
const BROKEN_GUARD = "process.exitCode = 1;";
const ACTIVE_CALLER = "active.yml#gate";
const FULL_ACTIVE_CALLER = `.github/workflows/${ACTIVE_CALLER}`;
const WORKFLOWS_DIR = path.join(".github", "workflows");
const SECOND_WORKFLOW = "second.yml";

let projectRoot = "";
let lisaRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-nightly-guard-"));
  lisaRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-package-"));
  await mkdir(path.join(projectRoot, WORKFLOWS_DIR), {
    recursive: true,
  });
  await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
  await mkdir(path.join(lisaRoot, "typescript", "copy-overwrite", "scripts"), {
    recursive: true,
  });
  await writeFile(
    path.join(lisaRoot, "package.json"),
    JSON.stringify({ version: "4.17.16" })
  );
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
 * Write an active direct workflow for one or more targets.
 * @param targets - Literal scripts the bypass-bearing job invokes
 */
async function activeDirect(...targets: readonly string[]): Promise<void> {
  const steps = targets.map(target => `      - run: node ${target}`).join("\n");
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
${steps}
`
  );
}

/**
 * Write one target script beneath the project.
 * @param relative - Project-relative target path
 * @param source - JavaScript module body
 */
async function target(relative: string, source: string): Promise<void> {
  const absolute = path.join(projectRoot, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, source);
}

/**
 * Build a contract-only guard with no dependencies or ambient inputs.
 * @param version - Exact bytes the contract mode should print
 * @returns JavaScript module body
 */
const versionGuard = (version: string): string =>
  `if (process.argv.includes("--contract-version")) process.stdout.write(${JSON.stringify(version)});`;

/**
 * Install a package copy used to classify remediation.
 * @param source - JavaScript bytes attributed to the installed Lisa package
 */
async function shippedGuard(source: string): Promise<void> {
  await writeFile(
    path.join(
      lisaRoot,
      "typescript",
      "copy-overwrite",
      "scripts",
      "check-nightly-e2e-health.mjs"
    ),
    source
  );
}

describe("nightly guard probe: contract versions", () => {
  it.each(["1.0.0", "1.7.0", "1.999.42", "1.7.0\n"])(
    "accepts compatible ASCII semver %j",
    async version => {
      await target(CANONICAL_GUARD, versionGuard(version));
      await expect(
        probeNightlyE2eGuardTarget(projectRoot, CANONICAL_GUARD)
      ).resolves.toEqual({ state: "compatible", version: version.trimEnd() });
    }
  );

  it.each(["0.9.0", "2.0.0"])(
    "rejects incompatible major %s",
    async version => {
      await target(CANONICAL_GUARD, versionGuard(`${version}\n`));
      const result = await probeNightlyE2eGuardTarget(
        projectRoot,
        CANONICAL_GUARD
      );
      expect(result).toMatchObject({ state: "failure", version });
      expect(result.state === "failure" ? result.reason : "").toMatch(
        /major 1/u
      );
    }
  );

  it.each([
    ["empty", ""],
    ["v-prefix", "v1.7.0\n"],
    ["prerelease", "1.7.0-beta.1\n"],
    ["extra text", "version=1.7.0\n"],
    ["multiple lines", "1.7.0\n1.7.0\n"],
    ["leading zero", "1.07.0\n"],
    ["carriage return", "1.7.0\r\n"],
  ])("rejects malformed %s output", async (_label, output) => {
    await target(CANONICAL_GUARD, versionGuard(output));
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /exact ASCII semantic version/u
    );
  });
});

describe("nightly guard probe: filesystem and process failures", () => {
  it("AC6 rejects a missing target", async () => {
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/missing/u);
  });

  it("rejects a symlinked target", async () => {
    await target("scripts/real.mjs", versionGuard("1.7.0\n"));
    await symlink("real.mjs", path.join(projectRoot, CANONICAL_GUARD));
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/symlink/u);
  });

  it("rejects a non-regular target", async () => {
    await mkdir(path.join(projectRoot, CANONICAL_GUARD), { recursive: true });
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /regular file/u
    );
  });

  it("rejects a target reached through a parent symlink outside the project root", async () => {
    const outside = await mkdtemp(
      path.join(os.tmpdir(), "lisa-outside-guard-")
    );
    await writeFile(
      path.join(outside, "check-nightly-e2e-health.mjs"),
      versionGuard("1.7.0\n")
    );
    await rm(path.join(projectRoot, "scripts"), { recursive: true });
    await symlink(outside, path.join(projectRoot, "scripts"));
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    await rm(outside, { force: true, recursive: true });
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /contained|outside/u
    );
  });

  it("rejects an unreadable target", async () => {
    await target(CANONICAL_GUARD, versionGuard("1.7.0\n"));
    await chmod(path.join(projectRoot, CANONICAL_GUARD), 0o000);
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    await chmod(path.join(projectRoot, CANONICAL_GUARD), 0o600);
    expect(result.state).toBe("failure");
  });

  it("rejects a nonzero exit", async () => {
    await target(CANONICAL_GUARD, "process.exitCode = 3;");
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(/exit 3/u);
  });

  it("rejects a child-process spawn failure", async () => {
    await target(CANONICAL_GUARD, versionGuard("1.7.0\n"));
    const spawnImpl: typeof spawn = (() => {
      throw new Error("generic spawn refusal");
    }) as typeof spawn;
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD,
      { spawnImpl }
    );
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /spawn.*generic spawn refusal/u
    );
  });

  it("rejects a signalled child", async () => {
    await target(CANONICAL_GUARD, 'process.kill(process.pid, "SIGKILL");');
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /SIGKILL|signal/u
    );
  });

  it("kills and rejects a target that exceeds two seconds", async () => {
    await target(CANONICAL_GUARD, "setInterval(() => {}, 1000);");
    const started = Date.now();
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /2 seconds|timeout/u
    );
  });

  it("kills and rejects combined output above 4 KiB", async () => {
    await target(
      CANONICAL_GUARD,
      'process.stdout.write("1".repeat(3000)); process.stderr.write("2".repeat(3000));'
    );
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    expect(result.state).toBe("failure");
    expect(result.state === "failure" ? result.reason : "").toMatch(
      /4 KiB|output/u
    );
  });
});

describe("nightly guard probe: process security", () => {
  it("runs with a minimal credential-free environment", async () => {
    process.env.LISA_TEST_TOKEN = "must-not-cross";
    process.env.LISA_TEST_CREDENTIAL = "must-not-cross";
    await target(
      CANONICAL_GUARD,
      `
const forbidden = Object.keys(process.env).filter(name => /TOKEN|SECRET|CREDENTIAL|PASSWORD|COOKIE|AUTH|KEY/.test(name));
if (forbidden.length > 0) { process.stderr.write(forbidden.join(",")); process.exitCode = 9; }
else process.stdout.write("1.7.0\\n");
`
    );
    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD
    );
    delete process.env.LISA_TEST_TOKEN;
    delete process.env.LISA_TEST_CREDENTIAL;
    expect(result).toEqual({ state: "compatible", version: "1.7.0" });
  });

  it("uses process.execPath, shell false, closed stdin, and piped output", async () => {
    await target(CANONICAL_GUARD, versionGuard("1.7.0\n"));
    const calls: unknown[][] = [];
    const spawnImpl: typeof spawn = ((...args: Parameters<typeof spawn>) => {
      calls.push(args);
      return spawn(...args);
    }) as typeof spawn;

    const result = await probeNightlyE2eGuardTarget(
      projectRoot,
      CANONICAL_GUARD,
      { spawnImpl }
    );
    expect(result.state).toBe("compatible");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(process.execPath);
    expect(calls[0]?.[2]).toMatchObject({
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("proves the current permission flags against Lisa's shipped 1.7.0 guard", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    const shipped =
      "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";
    await expect(
      probeNightlyE2eGuardTarget(repositoryRoot, shipped)
    ).resolves.toEqual({ state: "compatible", version: "1.7.0" });
  });
});

describe("nightly guard doctor check: acceptance and remediation", () => {
  it("AC1 passes a bounded active caller and names caller, path, and version", async () => {
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, versionGuard("1.7.0\n"));
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result).toEqual({
      name: NIGHTLY_GUARD_CHECK_NAME,
      status: "ok",
      detail: expect.stringContaining(FULL_ACTIVE_CALLER),
    });
    expect(result.detail).toContain(CANONICAL_GUARD);
    expect(result.detail).toContain("1.7.0");
    expect(result.detail).not.toMatch(/remediation|reaper/u);
  });

  it("AC2 fails the active off-path fork even beside an unused good canonical copy", async () => {
    await activeDirect(OFF_PATH_GUARD);
    await target(OFF_PATH_GUARD, BROKEN_GUARD);
    await target(CANONICAL_GUARD, versionGuard("1.7.0\n"));
    await shippedGuard(versionGuard("1.7.0\n"));
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain(FULL_ACTIVE_CALLER);
    expect(result.detail).toContain(OFF_PATH_GUARD);
    expect(result.detail).toContain("install");
    expect(result.detail).toContain("repoint");
    expect(result.detail).toContain("retire");
    expect(result.detail).toContain(
      "preserve the workflow/job names and required-check context"
    );
  });

  it("AC3 tells an install that does not ship the guard to upgrade first", async () => {
    await activeDirect(CANONICAL_GUARD);
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("upgrade first");
    expect(result.detail).toContain("2.353.0+");
    expect(result.detail).toContain("2.x");
    expect(result.detail).toContain("current");
  });

  it("tells a current install with a missing canonical target to apply it", async () => {
    await activeDirect(CANONICAL_GUARD);
    await shippedGuard(versionGuard("1.7.0\n"));
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain(`install ${CANONICAL_GUARD}`);
    expect(result.detail).toContain("lisa apply .");
    expect(result.detail).not.toContain("upgrade first");
  });

  it("AC3 gives the exact refresh command for a preserved modified canonical copy", async () => {
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, BROKEN_GUARD);
    await shippedGuard(versionGuard("1.7.0\n"));
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("review");
    expect(result.detail).toContain(
      "lisa apply . --refresh-templates=scripts/check-nightly-e2e-health.mjs"
    );
    expect(result.detail).toContain(
      "node scripts/check-nightly-e2e-health.mjs --contract-version"
    );
  });

  it("distinguishes a provably stale canonical copy", async () => {
    await activeDirect(CANONICAL_GUARD);
    const old = Buffer.from(BROKEN_GUARD);
    await target(CANONICAL_GUARD, old.toString());
    await shippedGuard(versionGuard("1.7.0\n"));
    const digest = createHash("sha256").update(old).digest("hex");
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      ledger: { [CANONICAL_GUARD]: [digest] },
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("provably stale");
    expect(result.detail).toContain("lisa apply .");
  });

  it("distinguishes a byte-identical packaged copy whose probe fails", async () => {
    await activeDirect(CANONICAL_GUARD);
    const broken = BROKEN_GUARD;
    await target(CANONICAL_GUARD, broken);
    await shippedGuard(broken);
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("byte-identical packaged copy");
    expect(result.detail).toMatch(/reinstall|upgrade/u);
  });

  it("AC4 passes a direct compatible guard without reusable or context migration advice", async () => {
    await activeDirect(OFF_PATH_GUARD);
    await target(OFF_PATH_GUARD, versionGuard("1.9.0\n"));
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("ok");
    expect(result.detail).not.toMatch(/reusable|rename|ruleset|context/u);
  });

  it("AC5 returns a determinate zero when no active bypass caller exists", async () => {
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result).toEqual({
      name: NIGHTLY_GUARD_CHECK_NAME,
      status: "ok",
      detail: expect.stringMatching(/determinate zero|0 bypass-bearing/u),
    });
    expect(result.detail).not.toMatch(/reaper|required/u);
  });

  it("reports malformed workflow discovery as unavailable rather than zero", async () => {
    await writeFile(
      path.join(projectRoot, WORKFLOWS_DIR, "broken.yml"),
      "'on': [pull_request\n"
    );
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Guard discovery unavailable");
    expect(result.detail).toContain(".github/workflows/broken.yml");
    expect(result.detail).toContain("--contract-version");
    expect(result.detail).not.toContain("determinate zero");
  });

  it("AC7 passes a bounded active guard without a reaper", async () => {
    await activeDirect(CANONICAL_GUARD);
    await target(CANONICAL_GUARD, versionGuard("1.7.0\n"));
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("ok");
    expect(result.detail).not.toContain("reaper");
  });

  it("probes a shared target once and attributes it to every caller", async () => {
    await activeDirect(CANONICAL_GUARD);
    await writeFile(
      path.join(projectRoot, WORKFLOWS_DIR, SECOND_WORKFLOW),
      (
        await readFile(
          path.join(projectRoot, WORKFLOWS_DIR, "active.yml"),
          "utf8"
        )
      ).replace("gate:", "other_gate:")
    );
    await target(CANONICAL_GUARD, versionGuard("1.7.0\n"));
    let count = 0;
    const spawnImpl: typeof spawn = ((...args: Parameters<typeof spawn>) => {
      count += 1;
      return spawn(...args);
    }) as typeof spawn;
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      spawnImpl,
    });
    expect(result.status).toBe("ok");
    expect(count).toBe(1);
    expect(result.detail).toContain(ACTIVE_CALLER);
    expect(result.detail).toContain("second.yml#other_gate");
  });

  it("attributes multiple target failures deterministically", async () => {
    await activeDirect(CANONICAL_GUARD);
    await writeFile(
      path.join(projectRoot, WORKFLOWS_DIR, SECOND_WORKFLOW),
      `
'on': [pull_request]
jobs:
  other:
    runs-on: ubuntu-latest
    env:
      GATE_BYPASS: true
    steps:
      - run: node ${OFF_PATH_GUARD}
`
    );
    await target(CANONICAL_GUARD, versionGuard("2.0.0\n"));
    await target(OFF_PATH_GUARD, "process.exitCode = 4;");
    const result = await checkNightlyE2eGuard(projectRoot, { lisaRoot });
    expect(result.status).toBe("fail");
    expect(result.detail.indexOf(ACTIVE_CALLER)).toBeLessThan(
      result.detail.indexOf("second.yml#other")
    );
    expect(result.detail).toContain(CANONICAL_GUARD);
    expect(result.detail).toContain(OFF_PATH_GUARD);
  });

  it("fails remaining targets explicitly when the 15-second aggregate limit is exhausted", async () => {
    await activeDirect(CANONICAL_GUARD);
    await writeFile(
      path.join(projectRoot, WORKFLOWS_DIR, SECOND_WORKFLOW),
      `
'on': [pull_request]
jobs:
  other:
    runs-on: ubuntu-latest
    env:
      GATE_BYPASS: true
    steps:
      - run: node ${OFF_PATH_GUARD}
`
    );
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(16_000);
    const probeImpl = vi.fn(async () => ({
      state: "compatible" as const,
      version: "1.7.0",
    }));
    const result = await checkNightlyE2eGuard(projectRoot, {
      lisaRoot,
      now,
      probeImpl,
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain(
      "15 seconds aggregate probe limit exhausted"
    );
    expect(probeImpl).toHaveBeenCalledTimes(1);
  });
});
/* eslint-enable max-lines -- restore repository default */
