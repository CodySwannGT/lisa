/**
 * A throwaway repository for the affected-test selection suites
 * (CodySwannGT/lisa#4600): a branch off `origin/main`, an access map on disk,
 * the real `lisa-affected-tests.mjs`, and a stand-in `vitest` that records
 * the command it was given and fails when a test named `failing` is in it.
 * @module tests/integration/affected-tests-fixture
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { sweepAlreadyRanEnv } from "../helpers/cleanup-sweep-skip.js";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** This repository's root. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Files the fixture borrows from this repository, and where they land. */
const BORROWED: ReadonlyArray<readonly [string, string]> = [
  [
    "all/copy-overwrite/scripts/lisa-affected-tests.mjs",
    "scripts/lisa-affected-tests.mjs",
  ],
  [
    "all/copy-overwrite/scripts/lib/affected-tests.mjs",
    "scripts/lib/affected-tests.mjs",
  ],
  [
    "all/copy-overwrite/scripts/lib/invoked-as-script.mjs",
    "scripts/lib/invoked-as-script.mjs",
  ],
  [
    "all/copy-overwrite/scripts/lib/push-gate-defaults.mjs",
    "scripts/lib/push-gate-defaults.mjs",
  ],
];

/**
 * The stand-in `vitest`. It records argv, writes a coverage summary into
 * `--coverage.reportsDirectory` from `coverage.json` when one is present, and
 * fails when a `failing` test is among its arguments, or when a full
 * coverage run (`--coverage`) finds a `whole-coverage.fail` marker, which
 * stands for whole-repo coverage below the project's thresholds.
 */
const FAKE_VITEST = `import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const argv = process.argv.slice(2);
appendFileSync(".vitest-calls", JSON.stringify(argv) + "\\n");
const dir = argv.find(arg => arg.startsWith("--coverage.reportsDirectory="));
if (dir && existsSync("coverage.json")) {
  const target = dir.slice("--coverage.reportsDirectory=".length);
  mkdirSync(target, { recursive: true });
  const raw = JSON.parse(readFileSync("coverage.json", "utf8"));
  const summary = Object.fromEntries(Object.entries(raw).map(([file, pct]) => [resolve(file), {
    statements: { pct }, branches: { pct }, functions: { pct }, lines: { pct },
  }]));
  writeFileSync(join(target, "coverage-summary.json"), JSON.stringify(summary));
}
if (argv.includes("--coverage") && existsSync("whole-coverage.fail")) process.exit(1);
process.exit(argv.some(arg => arg.includes("failing")) ? 1 : 0);
`;

/** The full test command the push gate runs. */
export const BASE_COMMAND: readonly string[] = [
  "node",
  "fake/vitest",
  "run",
  "--coverage",
  "--exclude=**/integration/**",
];

/** What the stand-in sees when the full command runs unchanged. */
export const FULL: readonly string[] = BASE_COMMAND.slice(2);

/** The one source module the map links to `tests/unit/mod.test.ts`. */
export const MOD = "src/mod.mjs";

/** A change to {@link MOD}. */
export const MOD_CHANGE: Readonly<Record<string, string>> = {
  [MOD]: "export const mod = 2;\n",
};

/** A change to the module the failing test reads. */
export const OTHER_CHANGE: Readonly<Record<string, string>> = {
  "src/other.mjs": "export const other = 2;\n",
};

/** The module that the failing test reads. */
const OTHER = "src/other.mjs";

/** One parent folder per test file, so cleanup is a single removal. */
const PARENT = mkdtempSync(path.join(tmpdir(), "lisa-affected-"));

/** Remove every fixture this test file made. */
export function removeFixtures(): void {
  rmSync(PARENT, { recursive: true, force: true });
}

/**
 * Run git in the fixture and return its output.
 * @param cwd - Fixture root
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
export function git(cwd: string, ...args: string[]): string {
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""} (affected-tests fixture)`,
    command: GIT_BIN,
    args,
    cwd,
    env: cleanGitEnv(),
  }).trim();
}

/**
 * Write a file, creating its folder.
 * @param root - Fixture root
 * @param file - Relative path
 * @param body - Content
 */
export function write(root: string, file: string, body: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), body);
}

/** The shape of one fixture. */
export interface FixtureOptions {
  readonly pushGate?: Record<string, unknown>;
  readonly coverageAtPush?: boolean;
  readonly map?: "fresh" | "none";
}

/**
 * Write the project files: sources, tests, scripts and config.
 * @param root - Fixture root
 * @param options - Fixture shape
 */
function writeProject(root: string, options: FixtureOptions): void {
  const task = { level: "required", run: "test:cov:unit:push" };
  const coverage =
    options.coverageAtPush === false
      ? {}
      : { "coverage-adequacy": { push: task } };
  for (const [from, to] of BORROWED) {
    mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, from), path.join(root, to));
  }
  write(root, "fake/vitest", FAKE_VITEST);
  write(
    root,
    ".gitignore",
    ".lisa/\n.vitest-calls\ncoverage.json\nwhole-coverage.fail\n"
  );
  write(root, MOD, "export const mod = 1;\n");
  write(root, OTHER, "export const other = 1;\n");
  write(root, "docs/notes.md", "notes\n");
  write(root, "tests/unit/mod.test.ts", "// mod\n");
  write(root, "tests/unit/other.test.ts", "// other\n");
  write(root, "tests/unit/failing.test.ts", "// fails\n");
  write(root, "tests/integration/mod.test.ts", "// integration\n");
  write(
    root,
    "package.json",
    `${JSON.stringify({
      name: "affected-fixture",
      private: true,
      type: "module",
      scripts: {
        "test:cov:unit:push": `node scripts/lisa-affected-tests.mjs -- ${BASE_COMMAND.join(" ")}`,
      },
    })}\n`
  );
  write(
    root,
    ".lisa.config.json",
    `${JSON.stringify({
      gates: {
        runner: "bun run",
        "test-correctness": { push: task },
        ...coverage,
      },
      pushGate: options.pushGate ?? {
        affectedTests: true,
        affectedCoverage: "skip",
      },
    })}\n`
  );
}

/**
 * Commit everything as `origin/main` and branch off it.
 * @param root - Fixture root
 * @returns The base commit
 */
export function branchOffMain(root: string): string {
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-q", "-b", "feature");
  return git(root, "rev-parse", "HEAD");
}

/**
 * Write an access map recorded for `baseSha` and downloaded for `requested`.
 * @param root - Fixture root
 * @param requested - The merge-base it was downloaded for
 * @param baseSha - The base it was recorded for
 */
export function writeMap(
  root: string,
  requested: string,
  baseSha: string
): void {
  write(
    root,
    ".lisa/test-access-map/map.json",
    JSON.stringify({
      "tests/unit/mod.test.ts": [MOD],
      "tests/unit/other.test.ts": [OTHER],
      "tests/unit/failing.test.ts": [OTHER],
      "tests/integration/mod.test.ts": [MOD],
    })
  );
  write(
    root,
    ".lisa/test-access-map/meta.json",
    JSON.stringify({
      requestedBase: requested,
      baseSha,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    })
  );
}

/**
 * Write the project and branch off its first commit.
 * @param root - Fixture root
 * @param options - Fixture shape
 * @returns The base commit
 */
function initialise(root: string, options: FixtureOptions): string {
  writeProject(root, options);
  return branchOffMain(root);
}

/**
 * A repository on a branch off `origin/main`, with a map for its merge-base.
 * @param options - Fixture shape
 * @returns Fixture root
 */
export function fixture(options: FixtureOptions = {}): string {
  const root = mkdtempSync(path.join(PARENT, "repo-"));
  const base = initialise(root, options);
  if (options.map !== "none") writeMap(root, base, base);
  return root;
}

/**
 * Commit a change on the branch.
 * @param root - Fixture root
 * @param files - Files to write
 */
export function change(
  root: string,
  files: Readonly<Record<string, string>>
): void {
  for (const [file, body] of Object.entries(files)) write(root, file, body);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
}

/**
 * The environment a push sees: no CI, no inherited git or selection state.
 * @param extra - Additional variables
 * @returns Environment
 */
export function pushEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const {
    CI: _ci,
    GITHUB_ACTIONS: _actions,
    LISA_SELECTION_REPORT: _report,
    LISA_ACCESS_MAP_MAX_AGE_DAYS: _age,
    ...rest
  } = cleanGitEnv();
  return { ...rest, ...sweepAlreadyRanEnv(), ...extra };
}

/**
 * Every argv the stand-in vitest received.
 * @param root - Fixture root
 * @returns Argument lists
 */
export function calls(root: string): string[][] {
  try {
    return readFileSync(path.join(root, ".vitest-calls"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as string[]);
  } catch {
    return [];
  }
}

/**
 * Run the selector directly, as the push gate's test task does.
 * @param root - Fixture root
 * @param extra - Additional environment
 * @param own - The selector's own flags, before `--`
 * @param command - The full test command (default {@link BASE_COMMAND})
 * @returns Exit status, output, and the commands the stand-in saw
 */
export function select(
  root: string,
  extra: Record<string, string> = {},
  own: readonly string[] = [],
  command: readonly string[] = BASE_COMMAND
): { status: number | null; output: string; calls: string[][] } {
  const child = boundedSpawnSync({
    label: "lisa-affected-tests (fixture)",
    command: process.execPath,
    args: ["scripts/lisa-affected-tests.mjs", ...own, "--", ...command],
    cwd: root,
    env: pushEnv(extra),
  });
  return {
    status: child.status,
    output: `${child.stdout}${child.stderr}`,
    calls: calls(root),
  };
}
