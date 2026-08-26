/**
 * Behavioral `lisa doctor` proof for active nightly bypass guards.
 *
 * Static capability markers can be copied into a dead file. This check follows
 * the active workflow target and asks that exact script for its contract under
 * a credential-free, no-shell, permission-bounded Node process. Node's
 * permission model does not fully govern network access; the probe therefore
 * remains deliberately tiny (`--contract-version`), offline by contract, and
 * time/output bounded.
 * @module cli/doctor-nightly-e2e-guard
 */
/* eslint-disable max-lines, max-lines-per-function -- filesystem proof, bounded child capture, contract parsing, and remediation form one security boundary */
import { spawn } from "node:child_process";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  classifyHostCopy,
  type HashLedger,
} from "../core/lisa-owned-provenance.js";
import type { DoctorCheck } from "./doctor.js";
import {
  scanNightlyE2eGuardCallers,
  type NightlyGuardCaller,
} from "./doctor-nightly-e2e-guard-scan.js";

/** Stable doctor row name shared by human and JSON output. */
export const NIGHTLY_GUARD_CHECK_NAME = "Nightly E2E bypass guard bounded?";

const CANONICAL = "scripts/check-nightly-e2e-health.mjs";
const SHIPPED = path.join(
  "typescript",
  "copy-overwrite",
  "scripts",
  "check-nightly-e2e-health.mjs"
);
const PROBE_ARGUMENT = "--contract-version";
const TARGET_TIMEOUT_MS = 2_000;
const AGGREGATE_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 4 * 1024;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\n)?$/u;

/** Successful contract output or a reason no verdict exists. */
export type NightlyGuardProbeResult =
  | { readonly state: "compatible"; readonly version: string }
  | {
      readonly state: "failure";
      readonly reason: string;
      readonly version?: string;
    };

/** Injected boundaries keep process/remediation behavior directly testable. */
export interface NightlyGuardDependencies {
  /** Child launcher; production always uses Node's no-shell `spawn`. */
  readonly spawnImpl?: typeof spawn;
  /** Installed Lisa root, for package-copy remediation classification. */
  readonly lisaRoot?: string;
  /** Known shipped hashes, injectable for provenance bite controls. */
  readonly ledger?: HashLedger;
  /** Monotonic-enough wall clock used to enforce the aggregate deadline. */
  readonly now?: () => number;
  /** Probe seam used only to red-leg aggregate exhaustion deterministically. */
  readonly probeImpl?: typeof probeNightlyE2eGuardTarget;
  /** Tighter internal deadline when the aggregate budget is nearly spent. */
  readonly timeoutMs?: number;
}

/** Internal process capture without interpreting partial bytes as a version. */
interface ProbeCapture {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly failure?: "timeout" | "overflow" | "spawn";
  readonly spawnReason?: string;
}

const defaultLisaRoot = (): string =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const displayError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const contained = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};

const permissionArguments = (
  directory: string
): readonly string[] | undefined => {
  const flags = process.allowedNodeEnvironmentFlags;
  const permission = flags.has("--permission")
    ? "--permission"
    : flags.has("--experimental-permission")
      ? "--experimental-permission"
      : undefined;
  return permission && flags.has("--allow-fs-read")
    ? [permission, `--allow-fs-read=${directory}`, "--no-warnings"]
    : undefined;
};

const killGroup = (child: ReturnType<typeof spawn>): void => {
  try {
    if (process.platform !== "win32" && child.pid !== undefined) {
      process.kill(-child.pid, "SIGKILL");
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
};

/* eslint-disable functional/immutable-data, functional/no-let -- event-stream capture keeps bounded mutable byte/error state together until the child closes */
const captureProbe = async (
  absoluteTarget: string,
  projectRoot: string,
  timeoutMs: number,
  spawnImpl: typeof spawn
): Promise<ProbeCapture> =>
  new Promise(resolve => {
    const permission = permissionArguments(path.dirname(absoluteTarget));
    if (!permission) {
      resolve({
        code: null,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        failure: "spawn",
        spawnReason:
          "this runtime exposes no compatible Node permission-mode and --allow-fs-read flags",
      });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnImpl(
        process.execPath,
        [...permission, absoluteTarget, PROBE_ARGUMENT],
        {
          cwd: projectRoot,
          detached: process.platform !== "win32",
          env: {},
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
    } catch (error) {
      resolve({
        code: null,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        failure: "spawn",
        spawnReason: displayError(error),
      });
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let failure: ProbeCapture["failure"];
    let spawnReason: string | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      failure = "timeout";
      killGroup(child);
    }, timeoutMs);
    const collect = (destination: Buffer[], chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes <= MAX_OUTPUT_BYTES) destination.push(chunk);
      if (bytes > MAX_OUTPUT_BYTES && failure !== "overflow") {
        failure = "overflow";
        killGroup(child);
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", error => {
      failure = "spawn";
      spawnReason = displayError(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        ...(failure ? { failure } : {}),
        ...(spawnReason ? { spawnReason } : {}),
      });
    });
  });
/* eslint-enable functional/immutable-data, functional/no-let -- restore immutable orchestration */

const validateTarget = async (
  projectRoot: string,
  target: string
): Promise<{ readonly absolute?: string; readonly reason?: string }> => {
  if (
    path.isAbsolute(target) ||
    target.split(/[\\/]/u).some(part => part === "..")
  ) {
    return { reason: "target escapes the project root" };
  }
  const absolute = path.resolve(projectRoot, target);
  try {
    const root = await realpath(projectRoot);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) return { reason: "target is a symlink" };
    if (!info.isFile()) return { reason: "target is not a regular file" };
    await access(absolute, constants.R_OK);
    const physical = await realpath(absolute);
    return contained(root, physical)
      ? { absolute: physical }
      : { reason: "target is not contained by the project root" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      reason:
        code === "ENOENT"
          ? "target is missing"
          : `target is unreadable (${code ?? displayError(error)})`,
    };
  }
};

const interpretCapture = (capture: ProbeCapture): NightlyGuardProbeResult => {
  if (capture.failure === "timeout")
    return {
      state: "failure",
      reason: "contract probe exceeded the 2 seconds target timeout",
    };
  if (capture.failure === "overflow")
    return {
      state: "failure",
      reason: "contract probe exceeded the 4 KiB combined output limit",
    };
  if (capture.failure === "spawn")
    return {
      state: "failure",
      reason: `contract probe could not spawn (${capture.spawnReason ?? "unknown error"})`,
    };
  if (capture.signal)
    return {
      state: "failure",
      reason: `contract probe was killed by signal ${capture.signal}`,
    };
  if (capture.code !== 0)
    return {
      state: "failure",
      reason: `contract probe exited with exit ${capture.code ?? "unknown"}`,
    };
  if (capture.stderr.length > 0)
    return {
      state: "failure",
      reason:
        "contract probe wrote unexpected stderr; expected one exact ASCII semantic version",
    };
  const output = capture.stdout.toString("utf8");
  const match = VERSION.exec(output);
  if (!match)
    return {
      state: "failure",
      reason:
        "contract probe must print one exact ASCII semantic version with only an optional final newline",
    };
  const version = output.trimEnd();
  return match[1] === "1"
    ? { state: "compatible", version }
    : {
        state: "failure",
        reason: `contract ${version} is incompatible; expected major 1`,
        version,
      };
};

/**
 * Probe one verified project-relative target without credentials or a shell.
 * @param projectRoot - Project root forming the containment boundary
 * @param target - Literal project-relative JavaScript file
 * @param dependencies - Optional child launcher for process-boundary tests
 * @returns Compatible major-1 version, or an explicit failed proof
 */
export async function probeNightlyE2eGuardTarget(
  projectRoot: string,
  target: string,
  dependencies: Pick<NightlyGuardDependencies, "spawnImpl" | "timeoutMs"> = {}
): Promise<NightlyGuardProbeResult> {
  const validated = await validateTarget(projectRoot, target);
  if (!validated.absolute)
    return {
      state: "failure",
      reason: validated.reason ?? "target unavailable",
    };
  const timeoutMs = dependencies.timeoutMs ?? TARGET_TIMEOUT_MS;
  const capture = await captureProbe(
    validated.absolute,
    projectRoot,
    timeoutMs,
    dependencies.spawnImpl ?? spawn
  );
  const result = interpretCapture(capture);
  return result.state === "failure" &&
    capture.failure === "timeout" &&
    timeoutMs < TARGET_TIMEOUT_MS
    ? { state: "failure", reason: "15 seconds aggregate probe limit exhausted" }
    : result;
}

const exactProbe = (target: string): string =>
  `node ${target} --contract-version`;
const preserveContext =
  "preserve the workflow/job names and required-check context unless a coordinated ruleset migration is planned";

const remediation = async (
  projectRoot: string,
  caller: NightlyGuardCaller,
  lisaRoot: string,
  ledger?: HashLedger
): Promise<string> => {
  const shippedPath = path.join(lisaRoot, SHIPPED);
  const shipped = await readFile(shippedPath).catch(() => undefined);
  if (!shipped) {
    return `upgrade first: install Lisa 2.353.0+ on 2.x or, preferably, the current release; then run \`lisa apply .\` and \`${exactProbe(CANONICAL)}\``;
  }
  if (caller.target !== CANONICAL) {
    return `install ${CANONICAL} with \`lisa apply .\`, repoint this job to it, retire ${caller.target}, then run \`${exactProbe(CANONICAL)}\`; ${preserveContext}`;
  }
  const host = await readFile(path.join(projectRoot, CANONICAL)).catch(
    () => undefined
  );
  if (!host)
    return `run \`lisa apply .\` to install ${CANONICAL}, then run \`${exactProbe(CANONICAL)}\``;
  const verdict = classifyHostCopy(CANONICAL, host, shipped, ledger);
  if (verdict.kind === "identical") {
    return `the failing target is the byte-identical packaged copy; reinstall or upgrade Lisa, re-run \`lisa apply .\`, then run \`${exactProbe(CANONICAL)}\``;
  }
  if (verdict.kind === "provably-stale") {
    return `this canonical copy is provably stale; run \`lisa apply .\`, then run \`${exactProbe(CANONICAL)}\``;
  }
  return `review the preserved modified canonical guard, then take Lisa's exact copy with \`lisa apply . --refresh-templates=${CANONICAL}\` and run \`${exactProbe(CANONICAL)}\``;
};

/**
 * Report whether every active bypass-bearing nightly caller runs a compatible
 * major-1 guard contract.
 * @param projectRoot - Project root to inspect without mutation
 * @param dependencies - Optional package/process collaborators for tests
 * @returns Existing `DoctorCheck` shape used by both renderers and exit logic
 */
export async function checkNightlyE2eGuard(
  projectRoot: string,
  dependencies: NightlyGuardDependencies = {}
): Promise<DoctorCheck> {
  const scan = await scanNightlyE2eGuardCallers(projectRoot);
  if (scan.state === "unavailable") {
    const facts = scan.failures
      .map(failure => `${failure.workflow}: ${failure.reason}`)
      .join("; ");
    return {
      name: NIGHTLY_GUARD_CHECK_NAME,
      status: "fail",
      detail: `Guard discovery unavailable: ${facts}. Remediation: keep workflow/job names and required-check context, use one literal \`node <relative-guard.js>\` target, then run \`node <relative-guard.js> --contract-version\`.`,
    };
  }
  if (scan.callers.length === 0) {
    return {
      name: NIGHTLY_GUARD_CHECK_NAME,
      status: "ok",
      detail:
        "Inspected active workflows: 0 bypass-bearing nightly callers (determinate zero).",
    };
  }
  const now = dependencies.now ?? (() => performance.now());
  const probe = dependencies.probeImpl ?? probeNightlyE2eGuardTarget;
  const deadline = now() + AGGREGATE_TIMEOUT_MS;
  const targets = new Set(scan.callers.map(caller => caller.target));
  const entries = await Array.from(targets).reduce(async (pending, target) => {
    const prior = await pending;
    const remaining = deadline - now();
    const result =
      remaining <= 0
        ? ({
            state: "failure",
            reason: "15 seconds aggregate probe limit exhausted",
          } as const)
        : await probe(projectRoot, target, {
            ...dependencies,
            timeoutMs: Math.min(TARGET_TIMEOUT_MS, remaining),
          });
    return [...prior, [target, result] as const];
  }, Promise.resolve<readonly (readonly [string, NightlyGuardProbeResult])[]>([]));
  const results = new Map(entries);
  const failures = scan.callers.filter(
    caller => results.get(caller.target)?.state !== "compatible"
  );
  if (failures.length === 0) {
    const facts = scan.callers.map(caller => {
      const result = results.get(caller.target);
      return `${caller.workflow}#${caller.job} -> ${caller.target} (${result?.state === "compatible" ? result.version : "unavailable"})`;
    });
    return {
      name: NIGHTLY_GUARD_CHECK_NAME,
      status: "ok",
      detail: `Inspected ${scan.callers.length} bypass-bearing nightly caller(s) and ${results.size} target(s): ${facts.join("; ")}.`,
    };
  }
  const lisaRoot = dependencies.lisaRoot ?? defaultLisaRoot();
  const facts = await Promise.all(
    failures.map(async caller => {
      const result = results.get(caller.target);
      const reason =
        result?.state === "failure" ? result.reason : "probe unavailable";
      const version =
        result?.state === "failure" && result.version
          ? ` (reported ${result.version})`
          : "";
      return `${caller.workflow}#${caller.job} -> ${caller.target}: ${reason}${version}. Remediation: ${await remediation(projectRoot, caller, lisaRoot, dependencies.ledger)}`;
    })
  );
  return {
    name: NIGHTLY_GUARD_CHECK_NAME,
    status: "fail",
    detail: `Nightly bypass guard contract failed for ${failures.length} caller(s):\n${facts.map(fact => `  - ${fact}`).join("\n")}`,
  };
}
/* eslint-enable max-lines, max-lines-per-function -- restore repository default */
