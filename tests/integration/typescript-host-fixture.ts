/**
 * A TypeScript host built from this branch's templates, for the smart push
 * gate suite (CodySwannGT/lisa#4611).
 *
 * The host gets what `lisa apply` gives a TypeScript project: the package
 * scripts from `typescript/package-lisa` (through the real strategy), every
 * shipped script under `scripts/`, the copy-overwrite `vitest.config.ts` and
 * the create-only `vitest.config.local.ts`. Its `node_modules` resolves
 * `@codyswann/lisa` to this checkout, so the built CLI, `lisa-test-run` and
 * the Vitest presets are this branch's. Its `.lisa.config.json` declares the
 * push gates the way `lisa apply` seeds them and, unless a case says
 * otherwise, nothing about `pushGate`.
 * @module tests/integration/typescript-host-fixture
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { LisaConfig } from "../../src/core/config.js";
import { PackageLisaStrategy } from "../../src/strategies/package-lisa.js";
import { sweepAlreadyRanEnv } from "../helpers/cleanup-sweep-skip.js";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";

/** This repository's root. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Where the recorder writes a unit map, relative to the host root. */
export const RECORDED_MAP = "tmp/test-access-map/unit.json";

const NODE_MODULES = "node_modules";
const SCOPE = "@codyswann";
// A host push or unit run measured at 0.9 to 2.9 s on a quiet box (1 vitest
// process); 6 s is the highest base the flat 120 s case budget admits.
const SPAWN_BASE_MS = 6_000;

/**
 * A source module its test covers fully.
 * @param name - Exported function name
 * @param value - What it returns
 * @returns Module source
 */
export function moduleSource(name: string, value: number): string {
  return `export function ${name}(): number {\n  return ${value};\n}\n`;
}

/**
 * The same module with a one-line edit that changes nothing it covers.
 * @param name - Exported function name
 * @param value - What it returns
 * @returns Module source
 */
export function edited(name: string, value: number): string {
  return `${moduleSource(name, value)}// edited\n`;
}

/**
 * The test for {@link moduleSource}.
 * @param name - Exported function name
 * @param value - What it returns
 * @returns Test source
 */
function testSource(name: string, value: number): string {
  const body = `it("${name}", () => {\n  expect(${name}()).toBe(${value});\n});\n`;
  return `import { expect, it } from "vitest";\n\nimport { ${name} } from "../src/${name}.js";\n\n${body}`;
}

/** The gates `lisa apply` seeds for a TypeScript host's push. */
const SEEDED_TASK = { level: "required", run: "test:cov:unit" };
const SEEDED_GATES = {
  runner: "bun run",
  "test-correctness": { push: SEEDED_TASK },
  "coverage-adequacy": { push: SEEDED_TASK },
};

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-ts-push-"));

/** Remove every host this file made. */
export function removeHosts(): void {
  fs.rmSync(parent, { recursive: true, force: true });
}

/**
 * Run git in a host.
 * @param cwd - Host root
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, ...args: string[]): string {
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""} (typescript host)`,
    command: GIT_BIN,
    args,
    cwd,
    env: cleanGitEnv(),
  }).trim();
}

/**
 * Write a file in a host, creating its folder.
 * @param cwd - Host root
 * @param file - Relative path
 * @param body - Content
 */
function write(cwd: string, file: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), body);
}

/**
 * This checkout's `node_modules`, except that `@codyswann/lisa` and the three
 * binaries the host calls are this branch's build.
 * @param cwd - Host root
 */
function linkModules(cwd: string): void {
  const source = path.join(REPO_ROOT, NODE_MODULES);
  const target = path.join(cwd, NODE_MODULES);
  const bins: Readonly<Record<string, string>> = {
    lisa: path.join(REPO_ROOT, "dist", "index.js"),
    "lisa-test-run": path.join(REPO_ROOT, "dist", "cli", "lisa-test-run.js"),
    vitest: path.join(source, "vitest", "vitest.mjs"),
  };
  fs.mkdirSync(path.join(target, ".bin"), { recursive: true });
  fs.mkdirSync(path.join(target, SCOPE), { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    if (entry === ".bin" || entry === SCOPE) continue;
    fs.symlinkSync(path.join(source, entry), path.join(target, entry));
  }
  fs.symlinkSync(REPO_ROOT, path.join(target, SCOPE, "lisa"));
  for (const [name, script] of Object.entries(bins)) {
    const launcher = `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`;
    fs.writeFileSync(path.join(target, ".bin", name), launcher, {
      mode: 0o755,
    });
  }
}

/**
 * Apply the shipped TypeScript package template to the host manifest.
 * @param cwd - Host root
 */
async function applyPackageTemplate(cwd: string): Promise<void> {
  const config: LisaConfig = {
    lisaDir: REPO_ROOT,
    destDir: cwd,
    dryRun: false,
    yesMode: true,
    validateOnly: false,
    skipGitCheck: false,
    harness: "claude",
  };
  const manifest = { name: "host", version: "1.0.0", type: "module" };
  write(cwd, "package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  await new PackageLisaStrategy().apply(
    path.join(REPO_ROOT, "typescript/package-lisa/package.lisa.json"),
    path.join(cwd, "package.lisa.json"),
    "package.lisa.json",
    { config, backupFile: async () => {}, promptOverwrite: async () => true }
  );
}

/**
 * The environment of a push on a developer machine: no CI, nothing the
 * enclosing Lisa or Vitest run exported, private cache and admission state.
 * @param cwd - Host root
 * @param extra - Additional variables
 * @returns Environment
 */
function pushEnv(
  cwd: string,
  extra: Record<string, string>
): NodeJS.ProcessEnv {
  const dropped = ["CI", "GITHUB_ACTIONS", "NODE_OPTIONS", "NODE_ENV"];
  const inherited = Object.fromEntries(
    Object.entries(cleanGitEnv()).filter(
      ([key]) => !/^(LISA_|VITEST|npm_)/u.test(key) && !dropped.includes(key)
    )
  );
  const state = `${cwd}-state`;
  return {
    ...inherited,
    ...sweepAlreadyRanEnv(),
    XDG_CACHE_HOME: path.join(state, "cache"),
    LISA_ADMISSION_STATE_DIR: path.join(state, "admission"),
    LISA_ADMISSION_POLL_MS: "100",
    ...extra,
  };
}

/** What one run printed and returned. */
export interface Run {
  readonly status: number | null;
  readonly output: string;
}

/**
 * Run a command in the host with a push's environment.
 * @param cwd - Host root
 * @param invocation - `node` or `bun` and its arguments
 * @param extra - Additional environment
 * @returns The run
 */
function inHost(
  cwd: string,
  invocation: readonly string[],
  extra: Record<string, string>
): Run {
  const [command, ...args] = invocation;
  const child = boundedSpawnSync({
    label: `typescript host: ${args.join(" ")}`,
    command: command === "node" ? process.execPath : (command ?? ""),
    args,
    cwd,
    env: pushEnv(cwd, extra),
    baseMs: SPAWN_BASE_MS,
  });
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
}

/**
 * Push: run the host's push gates as its pre-push hook does.
 * @param cwd - Host root
 * @param extra - Additional environment
 * @returns The run
 */
export function push(cwd: string, extra: Record<string, string> = {}): Run {
  const coverage = `--coverage=${cwd}-coverage.txt`;
  return inHost(
    cwd,
    ["node", "scripts/lisa-run-gates.mjs", "--moment=push", coverage],
    extra
  );
}

/**
 * Run the host's full unit suite as CI does, outside any push.
 * @param cwd - Host root
 * @param extra - Additional environment
 * @returns The run
 */
export function unitSuite(cwd: string, extra: Record<string, string>): Run {
  return inHost(cwd, ["bun", "run", "test:cov:unit"], extra);
}

/**
 * Record the host's access map as its CI would, for HEAD, and put it where
 * the push gate's download would.
 * @param cwd - Host root
 */
function recordMap(cwd: string): void {
  const base = git(cwd, "rev-parse", "HEAD");
  const run = unitSuite(cwd, {
    LISA_ACCESS_MAP: "1",
    LISA_ACCESS_MAP_BASE_SHA: base,
  });
  if (run.status !== 0) throw new Error(`map recording failed:\n${run.output}`);
  const recorded = JSON.parse(
    fs.readFileSync(path.join(cwd, RECORDED_MAP), "utf8")
  ) as {
    readonly meta: { readonly createdAt: string; readonly triggers: string[] };
    readonly map: Record<string, string[]>;
  };
  const { createdAt, triggers } = recorded.meta;
  const meta = { requestedBase: base, baseSha: base, createdAt, triggers };
  write(cwd, ".lisa/test-access-map/map.json", JSON.stringify(recorded.map));
  write(cwd, ".lisa/test-access-map/meta.json", JSON.stringify(meta));
}

/**
 * Commit changed files on the feature branch.
 * @param cwd - Host root
 * @param files - Files to write
 */
export function commit(
  cwd: string,
  files: Readonly<Record<string, string>>
): void {
  for (const [file, body] of Object.entries(files)) write(cwd, file, body);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "change");
}

/**
 * Lay out the host's files.
 * @param cwd - Host root
 * @param pushGate - A `pushGate` block, when the host writes one
 */
function layOut(cwd: string, pushGate?: Record<string, unknown>): void {
  const floor = { statements: 90, branches: 90, functions: 90, lines: 90 };
  const config = { gates: SEEDED_GATES, ...(pushGate ? { pushGate } : {}) };
  fs.cpSync(
    path.join(REPO_ROOT, "all/copy-overwrite/scripts"),
    path.join(cwd, "scripts"),
    { recursive: true }
  );
  for (const [from, to] of [
    ["typescript/copy-overwrite/vitest.config.ts", "vitest.config.ts"],
    ["typescript/create-only/vitest.config.local.ts", "vitest.config.local.ts"],
  ] as const)
    fs.copyFileSync(path.join(REPO_ROOT, from), path.join(cwd, to));
  write(
    cwd,
    "vitest.thresholds.json",
    `${JSON.stringify({ global: floor })}\n`
  );
  write(cwd, "tsconfig.json", "{}\n");
  write(cwd, ".gitignore", "node_modules/\n.lisa/\ntmp/\ncoverage/\n");
  write(cwd, ".lisa.config.json", `${JSON.stringify(config, null, 2)}\n`);
  for (const [name, value] of [
    ["alpha", 1],
    ["beta", 2],
  ] as const) {
    write(cwd, `src/${name}.ts`, moduleSource(name, value));
    write(cwd, `tests/${name}.test.ts`, testSource(name, value));
  }
}

/**
 * Build a TypeScript host, commit it as `origin/main`, and branch off it.
 * @param options - Host shape
 * @param options.pushGate - A `pushGate` block, when the host writes one
 * @param options.map - Whether to record an access map for the base
 * @returns Host root
 */
export async function typescriptHost(
  options: { pushGate?: Record<string, unknown>; map?: boolean } = {}
): Promise<string> {
  const cwd = fs.mkdtempSync(path.join(parent, "host-"));
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(`${cwd}-state`, { recursive: true });
  layOut(cwd, options.pushGate);
  await applyPackageTemplate(cwd);
  linkModules(cwd);
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "base");
  git(cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(cwd, "checkout", "-q", "-b", "feature");
  if (options.map !== false) recordMap(cwd);
  return cwd;
}

/**
 * The `Test Files` summary lines Vitest printed.
 * @param output - Run output
 * @returns The summary lines, trimmed
 */
export function testFileSummaries(output: string): string[] {
  return output
    .split("\n")
    .filter(line => line.includes("Test Files "))
    .map(line => line.trim());
}
