/**
 * Harness for the session-manager CLI integration tests.
 *
 * Each test gets a throwaway project root, a throwaway HOME, and a PATH whose
 * first entry is `tests/fixtures/session-manager/stub-bin`, so `claude`,
 * `tmux`, `vm_stat` and `gh` resolve to recording stubs. The CLI is run as a
 * real child process (`node session-manager.mjs …`, started through
 * `boundedSpawnSync` so a hung child is killed, not waited on), which is the
 * only way to prove what it hands to a spawned process: the stub writes its
 * argv, cwd and
 * environment-variable names to a log this harness reads back.
 *
 * TELEGRAM_STATE_DIR and TELEGRAM_BOT_TOKEN are planted in the CLI's own
 * environment on every run, the same way a manager session would carry them,
 * so every worker-spawn test can assert they never reach the worker.
 * @module tests/unit/session-manager/support/cli-harness
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";

const REPO = path.resolve(import.meta.dirname, "../../../..");

export const CLI = path.join(
  REPO,
  "plugins/src/base/skills/lisa-session-manager/scripts/session-manager.mjs"
);

export const STUB_BIN = path.join(
  REPO,
  "tests/fixtures/session-manager/stub-bin"
);

export const MEMINFO = path.join(
  REPO,
  "tests/fixtures/session-manager/meminfo.txt"
);

export const MANAGER = "demo-manager";

/** Temp dirs made by {@link makeSandbox}, removed by {@link removeSandboxes}. */
const created: string[] = [];

/** Remove every sandbox made so far; register with `afterEach`. */
export function removeSandboxes(): void {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One recorded stub invocation. */
export interface StubCall {
  readonly bin: string;
  readonly argv: string[];
  readonly cwd: string;
  readonly envKeys: string[];
}

/** A throwaway project and its sandbox. */
export interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly stateDir: string;
  readonly log: string;
}

/** Options for {@link makeSandbox}. */
export interface SandboxOptions {
  /** Child repo keys; each gets `projects/<key>/.lisa.config.json`. */
  readonly repos?: readonly string[];
  /** Child repo keys created WITHOUT a `.lisa.config.json`. */
  readonly bareRepos?: readonly string[];
  /** Replace the default `sessionManager` block; `null` omits it. */
  readonly sessionManager?: Record<string, unknown> | null;
  /** Extra top-level keys merged into `.lisa.config.json`. */
  readonly extraConfig?: Record<string, unknown>;
}

/**
 * The default `sessionManager` block. Load and memory limits are set so the
 * host machine running the tests can never make a spawn test flaky.
 * @param stateDir - Per-project Telegram state dir
 * @param repoKeys - Child repo keys, empty for a single-repo project
 * @returns Block
 */
function defaultBlock(stateDir: string, repoKeys: readonly string[]) {
  return {
    name: MANAGER,
    interval: "5m",
    capacity: {
      maxWorkers: 6,
      gbPerWorker: 1,
      reserveGb: 0,
      cpuFraction: 1,
      maxLoadPerCore: 1000,
    },
    notify: { provider: "telegram", stateDir },
    ...(repoKeys.length > 0
      ? {
          repos: {
            root: "projects",
            entries: Object.fromEntries(
              repoKeys.map(key => [key, { hints: [key] }])
            ),
          },
        }
      : {}),
  };
}

/**
 * Build a project root, HOME and stub log in a fresh temp dir.
 * @param options - Shape of the project
 * @returns Sandbox paths (real paths, so they compare with a child's cwd)
 */
export function makeSandbox(options: SandboxOptions = {}): Sandbox {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "sm-cli-")));
  const root = path.join(base, "project");
  const home = path.join(base, "home");
  const stateDir = path.join(home, ".claude/channels/telegram-demo");
  const repos = options.repos ?? [];
  const bare = options.bareRepos ?? [];
  const block =
    options.sessionManager === undefined
      ? defaultBlock(stateDir, [...repos, ...bare])
      : options.sessionManager;
  created.push(base);
  mkdirSync(home, { recursive: true });
  for (const key of [...repos, ...bare]) {
    mkdirSync(path.join(root, "projects", key), { recursive: true });
  }
  mkdirSync(root, { recursive: true });
  for (const key of repos) {
    writeJson(path.join(root, "projects", key, ".lisa.config.json"), {
      tracker: "github",
    });
  }
  writeJson(path.join(root, ".lisa.config.json"), {
    tracker: "github",
    github: {
      org: "example-org",
      repo: "demo-repo",
      labels: { build: { ready: "status:ready" } },
    },
    ...options.extraConfig,
    ...(block === null ? {} : { sessionManager: block }),
  });
  return { root, home, stateDir, log: path.join(base, "stub-calls.jsonl") };
}

/**
 * Write pretty JSON to a file.
 * @param file - Destination
 * @param value - Value
 */
export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Options for {@link runCli}. */
export interface RunOptions {
  readonly input?: string;
  readonly env?: Record<string, string>;
  /** Rows the stub prints for `claude agents --json`. */
  readonly agents?: readonly Record<string, unknown>[];
  /** Skip the automatic `--project-root <root>`. */
  readonly noProjectRoot?: boolean;
}

/** Whatever `JSON.parse` returns: CLI output is untyped JSON. */
type Json = ReturnType<typeof JSON.parse>;

/** What one CLI run produced. */
export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: Json;
  readonly calls: StubCall[];
}

/**
 * Run the CLI with the stub PATH, recording every stub call.
 * @param sandbox - Project sandbox
 * @param args - CLI arguments (subcommand first)
 * @param options - stdin, extra env and the agents fixture
 * @returns Exit status, output, parsed JSON stdout and the stub calls
 */
export function runCli(
  sandbox: Sandbox,
  args: readonly string[],
  options: RunOptions = {}
): RunResult {
  const agentsFile = writeAgentsFile(sandbox, options.agents ?? []);
  const before = readCalls(sandbox).length;
  const result = boundedSpawnSync({
    label: `session-manager ${args[0] ?? ""}`,
    command: process.execPath,
    args: [
      CLI,
      ...args,
      ...(options.noProjectRoot ? [] : ["--project-root", sandbox.root]),
    ],
    cwd: sandbox.root,
    input: options.input ?? "",
    env: {
      PATH: `${STUB_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: sandbox.home,
      STUB_LOG: sandbox.log,
      STUB_AGENTS_FILE: agentsFile,
      TELEGRAM_STATE_DIR: sandbox.stateDir,
      TELEGRAM_BOT_TOKEN: "planted-value-never-forwarded",
      ...options.env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: parseJson(result.stdout),
    calls: readCalls(sandbox).slice(before),
  };
}

/**
 * Write the rows the stub `claude agents --json` prints.
 * @param sandbox - Project sandbox
 * @param agents - Rows
 * @returns The file path
 */
function writeAgentsFile(
  sandbox: Sandbox,
  agents: readonly Record<string, unknown>[]
): string {
  const file = path.join(path.dirname(sandbox.log), "agents.json");
  writeJson(file, agents);
  return file;
}

/**
 * Parse stdout as JSON, or null when it is not JSON.
 * @param text - stdout
 * @returns Parsed value or null
 */
function parseJson(text: string): Json {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Every stub call recorded so far in this sandbox.
 * @param sandbox - Project sandbox
 * @returns Calls in order
 */
export function readCalls(sandbox: Sandbox): StubCall[] {
  if (!existsSync(sandbox.log)) return [];
  return readFileSync(sandbox.log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as StubCall);
}
