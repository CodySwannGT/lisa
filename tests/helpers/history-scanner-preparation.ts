/**
 * One genuine cold acquisition of the pinned history scanner per applicable
 * Vitest invocation.
 *
 * ## Why the acquisition moved out of the suites
 *
 * Each history-scanner suite used to run the production `provision` CLI in its
 * own `beforeAll`, inside the same 30,000ms bounded-child base its controls
 * use. That base is sized for one control's real work. A download's duration
 * belongs to the network: provisioning was measured at 49.9-57.4s on a
 * workstation whose windows scaled to about 36-46s, so every push from it
 * stopped in `beforeAll` and the suites' cases never ran
 * (CodySwannGT/lisa#4581). Raising the base would loosen every control the base
 * exists to hold, so the base stays and the acquisition moves.
 *
 * ## What happens instead
 *
 * The `history-scanner` Vitest project in `vitest.config.local.ts` owns the
 * affected suites. Vitest runs a project's globalSetup only when that project
 * has files among the run's selected files (before any `--shard` split), so no
 * run without one of these suites gains a network prerequisite. Its
 * globalSetup calls {@link prepareHistoryScanner}, which runs the unchanged
 * production CLI `provision` verb once, against the public official release,
 * into a fresh owned scope. That child is bounded by the provisioner's own
 * declared phase limits, not by the per-control window, and its own temporary
 * files land inside the scope. Each suite then receives a qualified owned copy
 * through `tests/helpers/history-scanner-handoff.ts`.
 *
 * There is no cache and no reuse across invocations. Every applicable run
 * performs its own cold acquisition, and a run whose acquisition fails hands no
 * scanner to anything.
 * @module tests/helpers/history-scanner-preparation
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  PINS,
  VERSION,
  qualifyScanner,
} from "../../all/copy-overwrite/scripts/lib/history-secret-scanner.mjs";
import { errorMessage, writeStderrSync } from "./stderr-sync.js";

/** Repository root, resolved from this module. */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/** Key the history-scanner project provides its preparation under. */
export const PREPARATION_KEY = "historyScannerPreparation";

/** The unchanged production CLI the cold acquisition runs, repository-relative. */
export const PROVISION_CLI =
  "all/copy-overwrite/scripts/lisa-history-secrets.mjs";

/** Exactly what a successful production provision prints. */
export const PROVISIONED =
  "Provisioned checksum/version-pinned Gitleaks 8.30.1.\n";

/** Basename of the evidence record inside a preparation scope. */
export const PREPARATION_RECORD = "preparation.json";

/**
 * The provisioner's own declared phase limits, in milliseconds.
 *
 * As written in `all/copy-overwrite/scripts/lib/history-secret-scanner.mjs`:
 * one `AbortSignal` bounds the download and its transfer, `tar` extraction has
 * its own deadline, and qualification bounds the version check. The
 * preparation suite reads them back out of that file, so they cannot drift.
 */
export const PROVISIONER_PHASE_LIMITS_MS = {
  transfer: 120_000,
  extraction: 120_000,
  version: 10_000,
} as const;

/**
 * Containing deadline for the one cold acquisition.
 *
 * Derived, not chosen: the sum of the provisioner's phase limits, so the child
 * is killed only when the production code has overrun its own declared bounds.
 * It is unscaled, like the limits it adds up. No existing limit changes: every
 * control keeps its 30,000ms scaled base, and this bound replaces none of them.
 */
export const COLD_PROVISION_DEADLINE_MS = Object.values(
  PROVISIONER_PHASE_LIMITS_MS
).reduce((total, limit) => total + limit, 0);

/** Largest stream captured from the provision child, in characters. */
const MAX_CAPTURE = 64 * 1024;

/** Error code recorded when the containing deadline killed the child. */
const TIMED_OUT = "ETIMEDOUT";

/** Archive and executable pins for one platform. */
export interface ScannerPin {
  readonly archive: string;
  readonly binary: string;
}

/** What one cold provision child did, recorded before it is judged. */
export interface ColdProvisionEvidence {
  /** Exact argv the child ran, destination included. */
  readonly argv: readonly string[];
  /** Exit status, or null when the child did not exit on its own. */
  readonly status: number | null;
  /** Terminating signal, or null. */
  readonly signal: NodeJS.Signals | null;
  /** `ETIMEDOUT` when the containing deadline killed it, else a spawn errno. */
  readonly errorCode: string | null;
  /** Captured stdout. */
  readonly stdout: string;
  /** Captured stderr. */
  readonly stderr: string;
  /** Wall time from spawn to close, in milliseconds. */
  readonly elapsedMs: number;
  /** The containing deadline it ran under, in milliseconds. */
  readonly deadlineMs: number;
  /** `<platform>_<arch>` the pins were selected for. */
  readonly platform: string;
  /**
   * The archive pin the provisioner enforces. It refuses any downloaded archive
   * whose SHA256 differs before extracting anything, so a successful provision
   * implies these bytes. Recorded from the pin, not re-measured here: the
   * production CLI keeps the archive in its own scratch and removes it.
   */
  readonly archivePinSha256: string | null;
  /** Measured SHA256 of the executable it wrote, when it wrote a pinned one. */
  readonly executableSha256: string | null;
  /** Version the production qualification confirmed, when it passed. */
  readonly version: string | null;
}

/** A cold acquisition that produced a qualified official scanner. */
export interface ReadyPreparation {
  readonly ok: true;
  /** Per-invocation value binding the on-disk record to this provided one. */
  readonly nonce: string;
  /** Owned scope holding the executable and its record. */
  readonly scope: string;
  /** The provisioned executable. */
  readonly executable: string;
  readonly evidence: ColdProvisionEvidence;
}

/** A cold acquisition that did not, and why. */
export interface FailedPreparation {
  readonly ok: false;
  readonly reason: string;
  readonly evidence: ColdProvisionEvidence | null;
}

/** The one preparation an applicable invocation provides to its suites. */
export type HistoryScannerPreparation = ReadyPreparation | FailedPreparation;

declare module "vitest" {
  /** Values a Vitest project's globalSetup provides to its suites. */
  interface ProvidedContext {
    /** Provided by the history-scanner project's globalSetup only. */
    historyScannerPreparation?: HistoryScannerPreparation;
  }
}

/** Explicit failure-handling seams. Real acquisition takes the defaults. */
export interface ColdProvisionOptions {
  /** Full argv for the provision child, given the owned destination. */
  readonly argv?: (destination: string) => readonly [string, ...string[]];
  /** Containing deadline. Defaults to {@link COLD_PROVISION_DEADLINE_MS}. */
  readonly deadlineMs?: number;
  /** Directory the owned scope is created in. Defaults to `os.tmpdir()`. */
  readonly parent?: string;
}

/** One preparation, and how to give its scope back. */
export interface PreparedScope {
  readonly preparation: HistoryScannerPreparation;
  /** Stop any child still running and remove the owned scope. Idempotent. */
  readonly dispose: () => void;
}

/** One finished provision child. */
type ChildRun = Pick<
  ColdProvisionEvidence,
  "status" | "signal" | "errorCode" | "stdout" | "stderr" | "elapsedMs"
>;

/**
 * SHA256 of some bytes, as lowercase hex.
 * @param bytes - Bytes to digest
 * @returns The hex digest
 */
export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * The pins for this platform, when the shipped scanner supports it.
 * @returns Archive and executable pins, or undefined
 */
export function platformPin(): ScannerPin | undefined {
  const pins: Readonly<Record<string, ScannerPin | undefined>> = PINS;
  return pins[`${process.platform}_${process.arch}`];
}

/**
 * Read a path's bytes only when it is a real regular file, never through a link.
 * @param path - Candidate file
 * @param role - What the file is, for the refusal
 * @returns The bytes, or the refusal
 */
export function regularFileBytes(
  path: string,
  role: string
): { readonly bytes: Buffer } | { readonly refusal: string } {
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink())
      return { refusal: `the ${role} is a symbolic link` };
    if (!entry.isFile())
      return { refusal: `the ${role} is not a regular file` };
    return { bytes: readFileSync(path) };
  } catch {
    return { refusal: `the ${role} is missing` };
  }
}

/**
 * Qualify an executable with the production checksum-and-version check.
 * @param path - Executable to qualify
 * @returns The qualification failure, or undefined when it passed
 */
export function qualificationFailure(path: string): string | undefined {
  try {
    qualifyScanner(path);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Run one child under a containing deadline, capturing bounded streams.
 * @param argv - Executable and arguments
 * @param limits - The containing deadline and the child's environment
 * @param limits.deadlineMs - Kill the child with SIGKILL at this age
 * @param limits.env - Complete environment for the child
 * @param live - Holds the running child so a dispose can stop it
 * @param live.child - The running child, while it runs
 * @returns What the child did
 */
function runBounded(
  argv: readonly [string, ...string[]],
  limits: { readonly deadlineMs: number; readonly env: NodeJS.ProcessEnv },
  live: { child?: ChildProcess | undefined }
): Promise<ChildRun> {
  return new Promise(settle => {
    const started = performance.now();
    const [command, ...args] = argv;
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: limits.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    /* eslint-disable functional/no-let, functional/immutable-data -- live child streams and outcome accumulate until the real process closes */
    const captured = { stdout: "", stderr: "" };
    let errorCode: string | null = null;
    const timer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      errorCode = TIMED_OUT;
      child.kill("SIGKILL");
    }, limits.deadlineMs);
    const finish = (
      status: number | null,
      signal: NodeJS.Signals | null
    ): void => {
      clearTimeout(timer);
      live.child = undefined;
      settle({
        status,
        signal,
        // The deadline explains only a death it caused. A child that exited on
        // its own in the turn the timer fired keeps its own outcome.
        errorCode:
          errorCode === TIMED_OUT && signal !== "SIGKILL" ? null : errorCode,
        ...captured,
        elapsedMs: Math.round(performance.now() - started),
      });
    };
    // Listen for a spawn failure before touching the streams: when the spawn
    // itself fails (EMFILE, ENOENT) they can be absent.
    child.once("error", (error: NodeJS.ErrnoException) => {
      errorCode ??= error.code ?? "ERROR";
      if (child.pid === undefined) finish(null, null);
    });
    live.child = child;
    for (const name of ["stdout", "stderr"] as const)
      child[name]?.on("data", (chunk: Buffer) => {
        if (captured[name].length < MAX_CAPTURE)
          captured[name] += chunk.toString("utf8");
      });
    /* eslint-enable functional/no-let, functional/immutable-data -- capture ends with the close event below */
    child.once("close", finish);
  });
}

/**
 * Why a finished provision child is not a successful one, if it is not.
 *
 * Success is the contract the suites asserted before: status 0 and the
 * provisioner's exact success line. Stderr is recorded, not judged, so a
 * runtime warning cannot turn a genuine acquisition into a failure.
 * @param run - What the child did
 * @param deadlineMs - The containing deadline it ran under
 * @returns The truthful failure, or undefined for an exact success
 */
function childFailure(run: ChildRun, deadlineMs: number): string | undefined {
  if (run.errorCode === TIMED_OUT)
    return `The cold scanner provision did not complete within its ${deadlineMs}ms containing deadline, the sum of the provisioner's own phase limits: it was killed by SIGKILL after ${run.elapsedMs}ms.`;
  if (run.errorCode !== null)
    return `The cold scanner provision could not run: ${run.errorCode}.`;
  if (run.signal !== null)
    return `The cold scanner provision was killed by ${run.signal} after ${run.elapsedMs}ms.`;
  if (run.status !== 0)
    return `The cold scanner provision exited ${String(run.status)}: ${run.stderr.trim() || "no diagnostic"}`;
  if (run.stdout !== PROVISIONED)
    return `The cold scanner provision exited 0 without the provisioner's exact success line (stdout ${JSON.stringify(run.stdout)}).`;
  return undefined;
}

/**
 * Judge the provisioned artifact: real file, pinned bytes, production-qualified.
 * @param executable - Where the provision was told to write
 * @param pin - This platform's pins
 * @returns The measured digest, or the refusal
 */
function artifactJudgement(
  executable: string,
  pin: ScannerPin | undefined
): { readonly digest: string } | { readonly refusal: string } {
  if (pin === undefined)
    return { refusal: "this platform has no pinned scanner" };
  const read = regularFileBytes(executable, "provisioned executable");
  if ("refusal" in read) return read;
  const digest = sha256(read.bytes);
  if (digest !== pin.binary)
    return {
      refusal: `the provisioned executable's SHA256 ${digest} is not the pinned ${pin.binary}`,
    };
  const failure = qualificationFailure(executable);
  return failure === undefined
    ? { digest }
    : { refusal: `production qualification refused it: ${failure}` };
}

/**
 * Run one cleanup step, reporting a failure on stderr instead of throwing.
 * @param what - What failed, for the report
 * @param step - The cleanup step
 */
function reportFailure(what: string, step: () => unknown): void {
  try {
    step();
  } catch (error) {
    writeStderrSync(
      `history-scanner preparation: ${what} (${errorMessage(error)}); the scratch reaper reclaims what is left.\n`
    );
  }
}

/**
 * Create a private scope, released on process exit if nothing releases it first.
 *
 * Vitest answers SIGINT and SIGTERM by calling `process.exit`, so the exit
 * listener also covers an interrupted run, including one interrupted while the
 * provision child is still downloading: dispose kills that child too. The
 * scope holds a private `tmp` directory that the child uses as its TMPDIR, so
 * the provisioner's own archive scratch is removed with the scope.
 *
 * The exit listener is prepended, so it runs ahead of any listener armed
 * earlier, such as the global setup's release of this scope's parent: at exit
 * the child is stopped and the scope removed before the parent goes, as in the
 * normal teardown (CodySwannGT/lisa#4621).
 *
 * Dispose never throws, whoever calls it: the exit listener, the failure path
 * or a teardown. A throw from an exit listener crashes the process and skips
 * every later listener, and a throw from a teardown skips the parent's
 * release. A failure is reported on stderr synchronously instead, and the
 * scratch reaper reclaims what is left.
 * @param parent - Directory to create the scope in
 * @returns The scope, the slot for its live child, and its idempotent dispose
 */
function ownedScope(parent: string): {
  readonly scope: string;
  readonly live: { child?: ChildProcess | undefined };
  readonly dispose: () => void;
} {
  const scope = mkdtempSync(join(parent, "lisa-history-scanner-preparation-"));
  const live: { child?: ChildProcess | undefined } = {};
  const dispose = (): void => {
    process.off("exit", dispose);
    reportFailure("its provision child could not be stopped", () =>
      live.child?.kill("SIGKILL")
    );
    reportFailure("its preparation scope could not be removed", () => {
      rmSync(scope, { recursive: true, force: true });
    });
  };
  chmodSync(scope, 0o700);
  mkdirSync(join(scope, "tmp"), { mode: 0o700 });
  process.prependOnceListener("exit", dispose);
  return { scope, live, dispose };
}

/**
 * Run the one genuine cold acquisition into a fresh owned scope.
 *
 * Real acquisition takes no options: the unchanged production CLI, from the
 * public official release, under {@link COLD_PROVISION_DEADLINE_MS}. The seams
 * exist only for the explicit failure controls, which never stand in for it.
 * @param options - Explicit failure-handling seams
 * @returns The preparation, and the dispose that removes its scope
 */
export async function prepareHistoryScanner(
  options: ColdProvisionOptions = {}
): Promise<PreparedScope> {
  const deadlineMs = options.deadlineMs ?? COLD_PROVISION_DEADLINE_MS;
  const { scope, live, dispose } = ownedScope(options.parent ?? tmpdir());
  const executable = join(scope, "gitleaks");
  const argv = options.argv?.(executable) ?? [
    process.execPath,
    join(REPO_ROOT, PROVISION_CLI),
    "provision",
    executable,
  ];
  // eslint-disable-next-line no-restricted-syntax -- the provision child inherits the real environment, as each suite's provision child did; only its TMPDIR moves into the owned scope
  const env = { ...process.env, TMPDIR: join(scope, "tmp") };
  const run = await runBounded(argv, { deadlineMs, env }, live);
  const pin = platformPin();
  const failure = childFailure(run, deadlineMs);
  const artifact =
    failure === undefined
      ? artifactJudgement(executable, pin)
      : { refusal: failure };
  const qualified = "digest" in artifact;
  const evidence: ColdProvisionEvidence = {
    argv,
    ...run,
    deadlineMs,
    platform: `${process.platform}_${process.arch}`,
    archivePinSha256: pin?.archive ?? null,
    executableSha256: qualified ? artifact.digest : null,
    version: qualified ? VERSION : null,
  };
  if (!qualified) {
    const reason =
      failure ??
      `The cold scanner provision exited 0, but ${artifact.refusal}.`;
    dispose();
    return { preparation: { ok: false, reason, evidence }, dispose };
  }
  const nonce = randomBytes(16).toString("hex");
  writeFileSync(
    join(scope, PREPARATION_RECORD),
    JSON.stringify({ nonce, ...evidence }),
    { mode: 0o600, flag: "wx" }
  );
  return {
    preparation: { ok: true, nonce, scope, executable, evidence },
    dispose,
  };
}
