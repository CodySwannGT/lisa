/**
 * Harness for executing the shipped Rails scratch supervisor as a real process.
 *
 * The supervisor is a POSIX shell program, deliberately not a Node one: a Rails
 * repository is not required to have Node, npm, Bun, Yarn, a populated
 * `node_modules`, or a network at test runtime. These helpers therefore drive
 * it the way a Rails route does — `sh <script> --suite <label> -- <command>` —
 * rather than importing anything out of it.
 * @module tests/integration/support/rails-scratch-supervisor
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Absolute interpreter path, so nothing here depends on a writable PATH. */
const SH = "/bin/sh";

/** Repo-relative path of the single canonical supervisor implementation. */
export const SUPERVISOR_RELATIVE_PATH =
  "rails/copy-overwrite/scripts/lisa-scratch-run.sh";

/** Absolute path of the supervisor inside this checkout. */
export const SUPERVISOR_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  SUPERVISOR_RELATIVE_PATH
);

/** Directory the supervisor creates beneath the temp base. */
export const SCRATCH_NAMESPACE = "lisa-rails-scratch";

/** Exit codes the supervisor documents. */
export const SUPERVISOR_EXIT = {
  usage: 64,
  leak: 65,
  arming: 70,
  ambiguous: 78,
} as const;

/** A 64-character token placeholder for hand-built markers. */
export const FAKE_TOKEN = "a".repeat(64);

/** A 64-character run-root suffix for hand-built probe directories. */
export const PROBE_SUFFIX = "0".repeat(64);

/** Outcome of one supervisor invocation. */
export interface SupervisorRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A temp base plus the scratch namespace beneath it. */
export interface ScratchBase {
  readonly base: string;
  readonly namespace: string;
  readonly cleanup: () => void;
}

/**
 * Seed entropy only for explicit collision/signal utility protocol controls.
 * @param directory - Positively owned fixture base
 * @returns Private utility directory, never a vendor/runtime qualification
 */
export function seededEntropy(directory: string): string {
  const bin = path.join(directory, "entropy-control");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "od"),
    `#!/bin/sh\nprintf '%s\\n' '${FAKE_TOKEN}'\n`,
    { mode: 0o700 }
  );
  return bin;
}

/**
 * Deliver TERM after actual mkdir returns, before parent arming resumes.
 * @param scratch - Owned fixture base and namespace
 * @param existing - Whether native mkdir must encounter a foreign collision
 * @returns Exact fixture identities and utility directory for assertions
 */
export function creationSignalControl(scratch: ScratchBase, existing: boolean) {
  const root = path.join(scratch.namespace, `r.${FAKE_TOKEN.slice(0, 24)}`);
  const retained = path.join(root, "foreign-marker");
  if (existing) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(retained, "preserved");
  }
  const inode = existing ? fs.statSync(root).ino : null;
  const bin = seededEntropy(scratch.base);
  fs.writeFileSync(
    path.join(bin, "mkdir"),
    `#!/bin/sh
case "$1" in
  '${root}')
    /bin/mkdir "$@"
    status=$?
    kill -TERM "$PPID"
    exit "$status"
    ;;
  *) exec /bin/mkdir "$@" ;;
esac
`,
    { mode: 0o700 }
  );
  return { root, retained, inode, bin };
}

/**
 * Create an isolated temp base for one test.
 *
 * Canonicalized eagerly: on Darwin `os.tmpdir()` returns the symlinked
 * spelling of the per-user temp root rather than its physical one, and the
 * supervisor refuses a root that resolves elsewhere — which is the behavior
 * under test rather than something to work around.
 * @returns The base, its scratch namespace path, and a cleanup function
 */
export function makeScratchBase(): ScratchBase {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-rails-sup-"))
  );
  return {
    base,
    namespace: path.join(base, SCRATCH_NAMESPACE),
    cleanup: (): void => {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

/** Extra environment for one supervisor invocation. */
export type SupervisorEnv = Readonly<Record<string, string>>;

/**
 * Spawn the supervisor without waiting for it.
 * @param base - Temp base the run must allocate beneath
 * @param args - Arguments after the script path
 * @param env - Additional environment variables
 * @returns The live child process
 */
export function spawnSupervisor(
  base: string,
  args: readonly string[],
  env: SupervisorEnv = {}
): ChildProcess {
  // Direct hostile authority controls retain a complete expected authority,
  // independently of the marker the case damages. Normal runs mint their own.
  const authorityEnv =
    args[0] === "--authority" ? { LISA_SCRATCH_TOKEN: FAKE_TOKEN } : {};
  return spawn(SH, [SUPERVISOR_PATH, ...args], {
    env: { ...process.env, LISA_SCRATCH_BASE: base, ...authorityEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Collect a child process's stdio and terminal status.
 * @param child - A spawned supervisor process
 * @returns The completed run
 */
export function collect(child: ChildProcess): Promise<SupervisorRun> {
  const out: string[] = [];
  const err: string[] = [];
  const append = (sink: string[]) => (chunk: Buffer) => {
    sink.push(chunk.toString());
  };
  child.stdout?.on("data", append(out));
  child.stderr?.on("data", append(err));
  return new Promise<SupervisorRun>(resolve => {
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout: out.join(""), stderr: err.join("") });
    });
  });
}

/**
 * Run the supervisor to completion.
 * @param base - Temp base the run must allocate beneath
 * @param args - Arguments after the script path
 * @param env - Additional environment variables
 * @returns The completed run
 */
export function runSupervisor(
  base: string,
  args: readonly string[],
  env: SupervisorEnv = {}
): Promise<SupervisorRun> {
  return collect(spawnSupervisor(base, args, env));
}

/**
 * List the entries directly beneath a scratch namespace.
 * @param namespace - The `lisa-rails-scratch` directory
 * @returns Entry names in a stable order, or an empty list when absent
 */
export function namespaceEntries(namespace: string): readonly string[] {
  if (!fs.existsSync(namespace)) return [];
  return fs
    .readdirSync(namespace)
    .slice()
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Read a trace file written by `LISA_SCRATCH_TRACE`, as `role event` pairs in
 * the order they were appended. The file order IS the ordering proof.
 * @param tracePath - Path passed as LISA_SCRATCH_TRACE
 * @returns One `"<role> <event>"` string per traced step
 */
export function readTrace(tracePath: string): readonly string[] {
  if (!fs.existsSync(tracePath)) return [];
  return fs
    .readFileSync(tracePath, "utf-8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => {
      const parts = line.split(" ");
      return `${parts[1] ?? ""} ${parts[2] ?? ""}`;
    });
}

/**
 * Poll until a predicate holds or the budget expires.
 * @param predicate - Condition to wait for
 * @param budgetMs - Maximum time to wait
 * @param stepMs - Poll interval
 * @returns True when the predicate held within the budget
 */
export async function waitFor(
  predicate: () => boolean,
  budgetMs = 20_000,
  stepMs = 50
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, stepMs));
  }
  return predicate();
}

/**
 * Whether a process is alive, without signalling it.
 * @param pid - Process id to probe
 * @returns True when the process exists
 */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A long-lived process the run neither started nor owns. */
export interface OutsideService {
  readonly pid: number;
  readonly stop: () => void;
}

/**
 * Start a long-lived process in its OWN session, standing in for a workflow
 * database service or an already-running developer database.
 * @param seconds - How long the stand-in should live
 * @returns Its pid, and a function that kills it
 */
export function startOutsideService(seconds = 120): OutsideService {
  const service = spawn(SH, ["-c", `sleep ${seconds}`], {
    detached: true,
    stdio: "ignore",
  });
  const pid = service.pid as number;
  service.unref();
  return {
    pid,
    stop: (): void => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * Write a hand-built arming marker into a probe directory, so the cleanup
 * authority can be driven directly with hostile input.
 * @param root - Probe run root
 * @param body - Marker body, written verbatim
 */
export function writeMarker(root: string, body: string): void {
  fs.writeFileSync(path.join(root, ".lisa-scratch-arm"), body);
}

/**
 * Build a complete, otherwise-valid marker whose fields a caller can override.
 * @param root - Probe run root, used for `root=` and its real device+inode
 * @param overrides - Field values replacing the defaults
 * @returns Marker body text
 */
export function markerBody(
  root: string,
  overrides: Readonly<Record<string, string>> = {}
): string {
  const stat = fs.statSync(root);
  const defaults: Readonly<Record<string, string>> = {
    version: "1",
    token: FAKE_TOKEN,
    root,
    devino: `${stat.dev} ${stat.ino}`,
    suite: "probe",
    pgid: "999999",
    birth: "irrelevant",
    suppid: "999999",
    supbirth: "irrelevant",
  };
  return `${Object.entries({ ...defaults, ...overrides })
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

/**
 * Create a probe run root directly beneath a scratch namespace.
 * @param namespace - The `lisa-rails-scratch` directory
 * @returns Absolute path of the created directory
 */
export function makeProbeRoot(namespace: string): string {
  const root = path.join(namespace, `r.${FAKE_TOKEN.slice(0, 24)}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}
