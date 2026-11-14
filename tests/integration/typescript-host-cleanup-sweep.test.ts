/**
 * A TypeScript host built from this branch's templates runs its suite with the
 * start-of-run sweep and without the template-side scratch policing
 * (CodySwannGT/lisa#4603).
 *
 * The fixture host is assembled from what `lisa apply` gives a new TypeScript
 * project: the forced package scripts from `typescript/package-lisa`, the
 * copy-overwrite `vitest.config.ts`, and the create-only
 * `vitest.config.local.ts`. Its suite then runs for real through the built
 * `lisa-test-run` and Vitest, out of process, the way the host's own
 * `test:*:lisa` scripts start it.
 *
 * Scope: this proves the TEMPLATE layer, plus one check that the shared
 * Vitest preset itself resolves with no scratch setup file or global setup
 * now that CodySwannGT/lisa#4602 retired them. The templates add nothing on
 * top of it, and the host-owned local config contributes no setup file,
 * global setup or setup ordering at all.
 * @module tests/integration/typescript-host-cleanup-sweep
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../src/core/config.js";
import {
  accessMapSetupFiles,
  coverageGlobalSetup,
} from "../../src/configs/vitest/base.js";
import { getTypescriptVitestConfig } from "../../src/configs/vitest/typescript.js";
import { PackageLisaStrategy } from "../../src/strategies/package-lisa.js";
import { SWEPT_ENV } from "../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

// File-scoped budget (CodySwannGT/lisa#4582): every case here starts real
// host processes, measured at about 0.8 s per host run and 4 s for the five-run case on a quiet box (1 vitest process). Both
// the case budget and each child's bound scale with the measured slowdown, and
// a child base at half the case base keeps the child dying first, by name.
useIoLatencyBudget(120_000);

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const LISA_TEST_RUN = path.join(REPO_ROOT, "dist/cli/lisa-test-run.js");
const VITEST = path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs");
const SWEEP_LINE = /^🧹 swept \d+ stale temp dirs?, \d+ orphaned test process/u;
const HOUR_MS = 60 * 60 * 1000;
const LOCAL_TEMPLATE = path.join(
  REPO_ROOT,
  "typescript/create-only/vitest.config.local.ts"
);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/** A fixture host and its private temp directory. */
interface Host {
  readonly cwd: string;
  readonly tmp: string;
}

/**
 * Apply the shipped TypeScript package template to a host manifest.
 * @param cwd - Host directory
 * @returns The scripts the apply wrote
 */
async function applyPackageTemplate(
  cwd: string
): Promise<Record<string, string>> {
  const config: LisaConfig = {
    lisaDir: REPO_ROOT,
    destDir: cwd,
    dryRun: false,
    yesMode: true,
    validateOnly: false,
    skipGitCheck: false,
    harness: "claude",
  };
  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({ name: "host", version: "1.0.0", type: "module" })
  );
  await new PackageLisaStrategy().apply(
    path.join(REPO_ROOT, "typescript/package-lisa/package.lisa.json"),
    path.join(cwd, "package.lisa.json"),
    "package.lisa.json",
    { config, backupFile: async () => {}, promptOverwrite: async () => true }
  );
  return (
    JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;
}

/**
 * Lay out a TypeScript host's files from this branch's templates.
 * @returns The host
 */
function hostFiles(): Host {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-ts-sweep-"));
  const cwd = path.join(root, "host");
  const tmp = path.join(root, "tmp");
  roots.push(root);
  for (const dir of [
    path.join(cwd, "tests"),
    path.join(cwd, "node_modules", "@codyswann"),
    tmp,
  ])
    fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(cwd, "tsconfig.json"), "{}\n");
  fs.copyFileSync(
    path.join(REPO_ROOT, "typescript/copy-overwrite/vitest.config.ts"),
    path.join(cwd, "vitest.config.ts")
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, "typescript/create-only/vitest.config.local.ts"),
    path.join(cwd, "vitest.config.local.ts")
  );
  fs.writeFileSync(path.join(cwd, "vitest.thresholds.json"), "{}\n");
  fs.symlinkSync(REPO_ROOT, path.join(cwd, "node_modules/@codyswann/lisa"));
  fs.symlinkSync(
    path.join(REPO_ROOT, "node_modules/vitest"),
    path.join(cwd, "node_modules/vitest")
  );
  fs.writeFileSync(
    path.join(cwd, "tests/sample.test.ts"),
    'import { expect, it } from "vitest";\n\nit("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n'
  );
  return { cwd, tmp };
}

/**
 * Build a TypeScript host from this branch's templates.
 * @returns The host and the scripts its package template produced
 */
async function typescriptHost(): Promise<
  Host & { scripts: Record<string, string> }
> {
  const host = hostFiles();
  const scripts = await applyPackageTemplate(host.cwd);
  return { ...host, scripts };
}

/**
 * Run the host's suite the way its `test:lisa` script does.
 * @param host - Fixture host
 * @returns Exit status and the run's stdout lines
 */
function runSuite(host: Host) {
  // A fresh run, not a nested one: drop everything the enclosing Lisa and
  // Vitest run exported, including its sweep marker, so the host's
  // lisa-test-run sweeps as it does on a developer's machine.
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("LISA_") &&
        !key.startsWith("VITEST") &&
        key !== SWEPT_ENV
    )
  );
  env.TMPDIR = host.tmp;
  delete env.NODE_ENV;
  const child = boundedSpawnSync({
    label: "host lisa-test-run",
    command: process.execPath,
    args: [
      LISA_TEST_RUN,
      "--profile",
      "typescript",
      "--adapter",
      "vitest",
      "--",
      process.execPath,
      VITEST,
      "run",
    ],
    cwd: host.cwd,
    env,
    baseMs: 30_000,
  });
  // CI colours Vitest's summary; the assertions read the words, not the codes.
  const output = stripVTControlCharacters(`${child.stdout}${child.stderr}`);
  return { status: child.status, lines: output.split("\n"), output };
}

describe("a TypeScript host built from this branch's templates", () => {
  it("gets forced test scripts that register no scratch prefixes", async () => {
    const { scripts } = await typescriptHost();

    expect(
      Object.entries(scripts)
        .filter(([, value]) => value.includes("LISA_TEST_SCRATCH_PREFIXES"))
        .map(([key]) => key)
    ).toEqual([]);
    expect(scripts["test:lisa"]).toContain(
      "lisa-test-run --profile typescript --adapter vitest -- vitest run"
    );
  });

  it("seeds a local Vitest config that adds no setup file, global setup or ordering", async () => {
    const host = await typescriptHost();
    // The host's copy is byte-for-byte the shipped template, so the template is
    // imported by a literal specifier rather than through the host path.
    expect(
      fs.readFileSync(path.join(host.cwd, "vitest.config.local.ts"), "utf8")
    ).toBe(fs.readFileSync(LOCAL_TEMPLATE, "utf8"));
    const { default: local } =
      (await import("../../typescript/create-only/vitest.config.local.js")) as {
        default: { test?: Record<string, unknown> };
      };

    expect(local).toEqual({});
    expect(local.test?.["setupFiles"]).toBeUndefined();
    expect(local.test?.["globalSetup"]).toBeUndefined();
    expect(local.test?.["sequence"]).toBeUndefined();
  });

  it("resolves a shared TypeScript preset that adds no scratch setup file or global setup", () => {
    // The preset half of the scope note above (CodySwannGT/lisa#4602): with
    // scratchSetupFiles() and scratchGlobalSetup() retired to [], the only
    // global setup left is the coverage include guard.
    const test = getTypescriptVitestConfig().test;

    // The only setup file is the access-map recorder's (CodySwannGT/lisa#4611),
    // which CI turns on with LISA_ACCESS_MAP=1 and which is empty otherwise.
    expect(test?.setupFiles).toEqual([...accessMapSetupFiles()]);
    expect(test?.globalSetup).toEqual([...coverageGlobalSetup()]);
    expect(
      [test?.setupFiles, test?.globalSetup]
        .flat()
        .filter(entry => /scratch/u.test(String(entry)))
    ).toEqual([]);
  });

  it("runs its suite with one sweep line, and leaves no growing residue over five runs", async () => {
    const host = await typescriptHost();
    const counts: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const stale = path.join(host.tmp, `lisa-killed-run-${run}`);
      fs.mkdirSync(stale, { mode: 0o700 });
      const when = new Date(Date.now() - 48 * HOUR_MS);
      fs.utimesSync(stale, when, when);

      const outcome = runSuite(host);

      expect(outcome.status, outcome.output).toBe(0);
      expect(outcome.output).toMatch(/Tests\s+1 passed/u);
      expect(
        outcome.lines.filter(line => SWEEP_LINE.test(line.trim()))
      ).toHaveLength(1);
      counts.push(
        fs
          .readdirSync(host.tmp)
          .filter(name => name.startsWith("lisa-killed-run-")).length
      );
    }

    expect(counts[4]).toBeLessThanOrEqual(counts[0] ?? 0);
    expect(counts).toEqual([0, 0, 0, 0, 0]);
  });
});
