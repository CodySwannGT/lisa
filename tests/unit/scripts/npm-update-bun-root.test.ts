/**
 * A host whose root uses only Bun (bun.lock, no package-lock.json) can run the
 * npm updater for a declared npm subdirectory (CodySwannGT/lisa#4862), while a
 * root-only npm host keeps exactly its historical inputs and commands.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { installInputs } from "../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs";
import { bunOnlyRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-bun.mjs";

const HEX = "a".repeat(64);
const BUN_LOCK = "bun.lock";
const MANIFEST = "package.json";
const NPM_LOCK = "package-lock.json";
const JOBS = ["prepare", "allocate", "gate", "publish"] as const;
const roots: string[] = [];

/**
 * A disposable host root holding the named files.
 * @param files - Root-relative files to create.
 * @returns The host root.
 */
function hostWith(files: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), "lisa-bun-root-"));
  roots.push(root);
  for (const file of files) writeFileSync(join(root, file), "{}\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * The workflow's controller install step for one job.
 * @param job - Workflow job name.
 * @returns The step's shell script.
 */
function controllerInstall(job: (typeof JOBS)[number]): string {
  const workflow = parse(
    readFileSync(".github/workflows/npm-updater.yml", "utf8")
  );
  const step = workflow.jobs[job].steps.find((candidate: { run?: string }) =>
    candidate.run?.includes("npm ci --ignore-scripts")
  );
  return step.run;
}

/**
 * Run a controller install script with recording npm and bun stubs.
 * @param script - Workflow step script.
 * @param files - Host root files.
 * @returns Recorded package-manager invocations, one per line.
 */
function recordInstall(script: string, files: readonly string[]) {
  const host = hostWith(files);
  const bin = join(host, ".stub-bin");
  const log = join(host, ".stub-log");
  mkdirSync(bin);
  for (const tool of ["npm", "bun"]) {
    writeFileSync(
      join(bin, tool),
      `#!/bin/sh\necho "${tool} $*" >> "${log}"\n`
    );
    chmodSync(join(bin, tool), 0o755);
  }
  writeFileSync(log, "");
  boundedExecFileSync({
    label: "workflow controller install",
    command: "/bin/bash",
    args: ["-eu", "-c", script],
    cwd: host,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      NPM_VERSION: "11.21.0",
    },
  });
  return readFileSync(log, "utf8");
}

describe("Bun-only root detection", () => {
  it("is Bun-only only with bun.lock and no package-lock.json", () => {
    expect(bunOnlyRoot(hostWith([BUN_LOCK, MANIFEST]))).toBe(true);
    expect(bunOnlyRoot(hostWith([BUN_LOCK, NPM_LOCK, MANIFEST]))).toBe(false);
    expect(bunOnlyRoot(hostWith([NPM_LOCK, MANIFEST]))).toBe(false);
    expect(bunOnlyRoot(hostWith([MANIFEST]))).toBe(false);
  });
});

describe("hosted gate install inputs", () => {
  it("keeps the historical root npm inputs byte for byte", () => {
    expect(installInputs({})).toEqual([NPM_LOCK, MANIFEST]);
    expect(installInputs({}, "npm")).toEqual([NPM_LOCK, MANIFEST]);
    expect(installInputs({ bunLockSha256: HEX })).toEqual([
      NPM_LOCK,
      MANIFEST,
      BUN_LOCK,
    ]);
    expect(installInputs({ directory: "externals" })).toEqual([
      NPM_LOCK,
      MANIFEST,
      "externals/package-lock.json",
      "externals/package.json",
    ]);
  });

  it("guards bun.lock instead of a root package-lock.json on a Bun-only root", () => {
    expect(installInputs({ directory: "externals" }, "bun")).toEqual([
      BUN_LOCK,
      MANIFEST,
      "externals/package-lock.json",
      "externals/package.json",
    ]);
  });

  it("refuses a root proposal on a Bun-only root", () => {
    for (const proposal of [{}, { directory: "." }])
      expect(() => installInputs(proposal, "bun")).toThrow(
        "a Bun-only root supports only a subdirectory npm proposal"
      );
    expect(() => installInputs({ directory: "externals" }, "pnpm")).toThrow(
      "a Bun-only root supports only a subdirectory npm proposal"
    );
  });
});

describe("workflow controller install", () => {
  it.each(JOBS)("%s runs the unchanged npm ci on a root npm host", job => {
    expect(recordInstall(controllerInstall(job), [NPM_LOCK, MANIFEST])).toBe(
      "npm install --global npm@11.21.0 --ignore-scripts --no-audit --no-fund\n" +
        "npm ci --ignore-scripts --no-audit --no-fund\n"
    );
  });

  it.each(JOBS)("%s keeps npm ci on a dual-lock root", job => {
    expect(
      recordInstall(controllerInstall(job), [BUN_LOCK, NPM_LOCK, MANIFEST])
    ).toContain("npm ci --ignore-scripts --no-audit --no-fund\n");
  });

  it.each(JOBS)("%s installs a Bun-only root with frozen Bun", job => {
    expect(recordInstall(controllerInstall(job), [BUN_LOCK, MANIFEST])).toBe(
      "npm install --global npm@11.21.0 --ignore-scripts --no-audit --no-fund\n" +
        "bun install --frozen-lockfile --ignore-scripts\n"
    );
  });

  it.each(JOBS)("%s sets up Bun before its controller install", job => {
    const workflow = parse(
      readFileSync(".github/workflows/npm-updater.yml", "utf8")
    );
    const steps: { uses?: string; if?: string; run?: string }[] =
      workflow.jobs[job].steps;
    const setup = steps.findIndex(step =>
      step.uses?.startsWith("oven-sh/setup-bun@")
    );
    const install = steps.findIndex(step =>
      step.run?.includes("npm ci --ignore-scripts")
    );
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(setup).toBeLessThan(install);
    // A root npm host never needs Bun outside the gate's own Bun coherence.
    if (job === "allocate" || job === "publish")
      expect(steps[setup]!.if).toBe(
        "hashFiles('package-lock.json') == '' && hashFiles('bun.lock') != ''"
      );
  });
});
