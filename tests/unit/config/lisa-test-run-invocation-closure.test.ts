/** Loader-service recognition and foreign-process refusal in gated closures. */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  esbuildServiceCommandFrom,
  requireExactInvocationClosure,
  type ProcessSnapshotRow,
} from "../../helpers/lisa-test-run-invocation-closure.js";
import {
  isProcessAlive,
  REPO_ROOT,
  waitForTestRun,
} from "../../helpers/lisa-test-run-process.js";

/** One birth stamp shared by every synthetic row; births are asserted apart. */
const SYNTHETIC_LSTART = "Mon Sep  8 16:00:00 2026";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Build one synthetic process-table row.
 * @param pid - Process identifier
 * @param ppid - Parent process identifier
 * @param pgid - Process group identifier
 * @param command - Complete command string as `ps` renders it
 * @returns Structurally complete snapshot row
 */
function syntheticRow(
  pid: number,
  ppid: number,
  pgid: number,
  command: string
): ProcessSnapshotRow {
  return { pid, ppid, pgid, sid: 0, lstart: SYNTHETIC_LSTART, command };
}

/** One complete invocation and the four loader services it owns. */
interface SyntheticInvocation {
  readonly rows: readonly ProcessSnapshotRow[];
  readonly wrapper: ProcessSnapshotRow;
  readonly reaper: ProcessSnapshotRow;
  readonly bootstrap: ProcessSnapshotRow;
  readonly payload: ProcessSnapshotRow;
}

/**
 * Assemble the exact process closure one supervised invocation produces.
 * @param service - Service command the loader executes in this checkout
 * @returns Named roles plus their loader services
 */
function syntheticInvocation(service: string): SyntheticInvocation {
  const wrapper = syntheticRow(
    100,
    50,
    50,
    "node --import tsx lisa-test-run.ts"
  );
  const reaper = syntheticRow(110, 100, 110, "node --import tsx reaper.ts");
  const bootstrap = syntheticRow(
    120,
    100,
    120,
    "node --import tsx bootstrap.ts"
  );
  const payload = syntheticRow(130, 120, 120, "node --import tsx payload.ts");
  return {
    rows: [
      wrapper,
      syntheticRow(101, 100, 50, service),
      reaper,
      syntheticRow(111, 110, 110, service),
      bootstrap,
      syntheticRow(121, 120, 120, service),
      payload,
      syntheticRow(131, 130, 120, service),
    ],
    wrapper,
    reaper,
    bootstrap,
    payload,
  };
}

/**
 * Require the exact closure of one synthetic invocation plus extra rows.
 * @param service - Service command the loader executes in this checkout
 * @param extra - Rows the assertion must not silently absorb
 * @returns Recognized loader-service rows
 */
function closureOf(
  service: string,
  extra: readonly ProcessSnapshotRow[] = []
): readonly ProcessSnapshotRow[] {
  const invocation = syntheticInvocation(service);
  return requireExactInvocationClosure(
    [...invocation.rows, ...extra],
    invocation.wrapper,
    invocation.reaper,
    invocation.bootstrap,
    invocation.payload
  );
}

/**
 * Create a second checkout whose `node_modules` is a symlink, as worktrees are.
 * @returns Linked checkout root holding a transformable probe module
 */
function linkedCheckout(): string {
  const base = fs.mkdtempSync(path.join(tmpdir(), "lisa-closure-checkout-"));
  temporaryDirectories.push(base);
  fs.symlinkSync(
    path.join(REPO_ROOT, "node_modules"),
    path.join(base, "node_modules")
  );
  fs.writeFileSync(
    path.join(base, "package.json"),
    JSON.stringify({ name: "closure-probe", private: true, type: "module" }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(base, "probe.ts"),
    "const hold: number = 1;\nsetInterval(() => hold, 1_000);\nexport {};\n",
    "utf8"
  );
  return base;
}

/**
 * Find the loader service one live process owns, without inferring its path.
 * @param parentPid - Loader process expected to own the service
 * @returns Service row as `ps` renders it, or undefined before it exists
 */
function liveServiceRow(
  parentPid: number
): { readonly pid: number; readonly command: string } | undefined {
  const inventory = boundedSpawnSync({
    label: "loader service inventory",
    command: "/bin/ps",
    args: ["-axo", "pid=,ppid=,command="],
    baseMs: 2_000,
  });
  return inventory.stdout
    .split("\n")
    .map(line => line.trim().split(/\s+/u))
    .filter(
      fields =>
        Number(fields[1]) === parentPid &&
        fields.slice(2).join(" ").includes("--service=")
    )
    .map(fields => ({
      pid: Number(fields[0]),
      command: fields.slice(2).join(" "),
    }))[0];
}

/**
 * Observe the service command a tsx loader in one checkout really executes.
 * @param checkout - Checkout whose module graph spawns the loader service
 * @returns Complete service command string taken from the process table
 */
async function observedServiceCommand(checkout: string): Promise<string> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.join(checkout, "probe.ts")],
    {
      cwd: checkout,
      // The loader caches transforms under the platform temp root. Point that
      // at the checkout the case already owns, so the cache is cleaned with it
      // rather than landing in the suite scratch root as an unregistered leak.
      env: {
        ...process.env,
        TEMP: checkout,
        TMP: checkout,
        TMPDIR: checkout,
      },
      stdio: "ignore",
    }
  );
  let service: { readonly pid: number; readonly command: string } | undefined;
  try {
    await waitForTestRun(() => {
      service = liveServiceRow(child.pid ?? -1);
      return service !== undefined;
    }, "tsx loader esbuild service");
  } finally {
    child.kill("SIGKILL");
  }
  const observed = service as {
    readonly pid: number;
    readonly command: string;
  };
  await waitForTestRun(
    () => !isProcessAlive(observed.pid),
    "tsx loader esbuild service exit"
  );
  return observed.command;
}

describe("gated invocation closure", () => {
  it("expects the service command a linked checkout really executes", async () => {
    const checkout = linkedCheckout();
    expect(esbuildServiceCommandFrom(checkout)).toBe(
      await observedServiceCommand(checkout)
    );
  });

  it("recognizes every loader service the invocation owns", () => {
    const service = esbuildServiceCommandFrom(REPO_ROOT);
    expect(closureOf(service).map(row => row.pid)).toEqual([
      101, 111, 121, 131,
    ]);
  });

  it("refuses a service binary the checkout does not resolve", () => {
    const service = esbuildServiceCommandFrom(REPO_ROOT);
    const forged = service.slice(service.indexOf(" --service="));
    expect(() =>
      closureOf(service, [
        syntheticRow(140, 130, 120, `/usr/local/bin/esbuild${forged}`),
      ])
    ).toThrow(/unexpected invocation-owned members: 140:130:120/u);
  });

  it("refuses a foreign process adopted into a detached group", () => {
    const service = esbuildServiceCommandFrom(REPO_ROOT);
    expect(() =>
      closureOf(service, [syntheticRow(150, 1, 120, "/bin/sleep 100")])
    ).toThrow(/unexpected invocation-owned members: 150:1:120/u);
  });
});
