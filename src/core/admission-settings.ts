/**
 * Where headroom admission's switch, thresholds and wait bounds come from.
 *
 * - **The switch** is `pushGate.admission` in the committed `.lisa.config.json`
 *   (default off). Callers that route work through admission — the gate runner
 *   and `lisa-test-run` — consult it; `lisa admit` itself always admits, since
 *   calling it is the decision.
 * - **Thresholds** are machine-local: `.lisa.config.local.json` → `admission`
 *   (never committed), overridden by `LISA_ADMISSION_*` environment variables,
 *   with code defaults underneath.
 * - **The wait bound** is short inside `git push` (5 minutes, well below the
 *   ~35-minute remote timeout) and 30 minutes elsewhere. It always ends in a
 *   refusal; nothing ever starts anyway once it expires.
 * @module core/admission-settings
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MAX_LOAD_PER_CORE,
  DEFAULT_MIN_FREE_MEMORY_MB,
  type HeadroomThresholds,
  RECENT_RESERVATION_WINDOW_MS,
} from "./admission-decision.js";
import { validatePushGateConfig } from "./project-config-push-gate.js";

/** Wait bound for a standalone run. */
export const DEFAULT_MAX_WAIT_MS = 30 * 60_000;

/** Wait bound inside `git push`. */
export const DEFAULT_PUSH_MAX_WAIT_MS = 5 * 60_000;

/** How often a waiting run re-checks the machine. */
export const DEFAULT_POLL_MS = 3_000;

/** Value of `LISA_ADMISSION_CONTEXT` a push sets for its children. */
export const PUSH_CONTEXT = "push";

/** Granted worker count handed to an admitted run. */
export const ADMITTED_WORKERS_ENV = "LISA_ADMITTED_WORKERS";

/** Pid of the process holding the reservation an admitted run lives under. */
export const ADMISSION_HOLDER_ENV = "LISA_ADMISSION_HOLDER";

/** Everything admission needs to run once. */
export interface AdmissionSettings {
  /** Why admission is skipped, or null when it is armed. */
  readonly skipped: string | null;
  /** Decision thresholds. */
  readonly thresholds: HeadroomThresholds;
  /** How long a run may wait before it is refused. */
  readonly maxWaitMs: number;
  /** Re-check interval while waiting. */
  readonly pollMs: number;
  /** Whether this run is inside `git push`. */
  readonly push: boolean;
  /** Machine-wide state directory shared by every repository of this user. */
  readonly stateDir: string;
}

/** The `admission` block of `.lisa.config.local.json`. */
interface LocalAdmissionConfig {
  readonly maxLoadPerCore?: number | undefined;
  readonly minFreeMemoryMb?: number | undefined;
  readonly maxWaitSeconds?: number | undefined;
  readonly pushMaxWaitSeconds?: number | undefined;
}

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/u;
const UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

/**
 * Parse a duration: a bare number is seconds; `ms`, `s`, `m`, `h` also work.
 * @param raw - Text such as `300`, `90s`, `5m`
 * @param name - Setting name shown in the error
 * @returns Milliseconds
 */
export function parseDuration(raw: string, name: string): number {
  const match = DURATION.exec(raw.trim());
  if (match?.[1] === undefined) {
    throw new Error(
      `${name} is ${JSON.stringify(raw)}; expected a duration such as 300, 90s or 5m.`
    );
  }
  return Math.round(Number(match[1]) * (UNIT_MS[match[2] ?? "s"] ?? 1000));
}

/**
 * Read a JSON file, or undefined when it does not exist.
 * @param path - File to read
 * @returns Parsed value
 */
function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/**
 * Whether `.lisa.config.json` in `cwd` switches admission on.
 * @param cwd - Project root
 * @returns The validated switch (default false)
 */
export function admissionSwitchOn(cwd: string): boolean {
  const path = join(cwd, ".lisa.config.json");
  const config = readJson(path) as Record<string, unknown> | undefined;
  return validatePushGateConfig(config?.pushGate, path)?.admission === true;
}

/**
 * Check one optional positive number in the local block.
 * @param block - Untrusted block
 * @param key - Key to read
 * @returns The number, or undefined when absent
 */
function positiveNumber(
  block: Record<string, unknown>,
  key: string
): number | undefined {
  const value = block[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Invalid admission.${key} in .lisa.config.local.json: expected a positive number`
    );
  }
  return value;
}

/**
 * Read `.lisa.config.local.json` → `admission`.
 * @param cwd - Project root
 * @returns Validated block (empty when absent)
 */
export function readLocalAdmissionConfig(cwd: string): LocalAdmissionConfig {
  const local = readJson(join(cwd, ".lisa.config.local.json")) as
    | Record<string, unknown>
    | undefined;
  const block = local?.admission;
  if (block === undefined) return {};
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    throw new Error(
      "Invalid admission in .lisa.config.local.json: expected an object"
    );
  }
  const record = block as Record<string, unknown>;
  return {
    maxLoadPerCore: positiveNumber(record, "maxLoadPerCore"),
    minFreeMemoryMb: positiveNumber(record, "minFreeMemoryMb"),
    maxWaitSeconds: positiveNumber(record, "maxWaitSeconds"),
    pushMaxWaitSeconds: positiveNumber(record, "pushMaxWaitSeconds"),
  };
}

/**
 * Read a positive numeric environment variable.
 * @param environment - Environment
 * @param name - Variable name
 * @returns The number, or undefined when unset
 */
function envNumber(
  environment: NodeJS.ProcessEnv,
  name: string
): number | undefined {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} is ${JSON.stringify(raw)}; expected a number.`);
  }
  return value;
}

/**
 * Why admission is skipped for this process, or null when it is armed.
 * @param environment - Environment
 * @returns Operator-readable reason, or null
 */
function skipReason(environment: NodeJS.ProcessEnv): string | null {
  const mode = environment.LISA_ADMISSION?.trim();
  if (mode === "off") return "admission is off (LISA_ADMISSION=off)";
  if (mode === "on") return null;
  const ci = environment.CI?.trim().toLowerCase();
  return ci === "true" || ci === "1"
    ? "admission is skipped on CI, where one job owns the runner (set LISA_ADMISSION=on to use it)"
    : null;
}

/**
 * The wait bound, in precedence order.
 * @param environment - Environment
 * @param local - Local config block
 * @param push - Whether this run is inside `git push`
 * @param override - `--max-wait` from the command line
 * @returns Milliseconds
 */
function maxWait(
  environment: NodeJS.ProcessEnv,
  local: LocalAdmissionConfig,
  push: boolean,
  override: string | undefined
): number {
  const general = environment.LISA_ADMISSION_MAX_WAIT;
  const pushOnly = environment.LISA_ADMISSION_PUSH_MAX_WAIT;
  if (override !== undefined) return parseDuration(override, "--max-wait");
  if (general !== undefined && general.trim() !== "") {
    return parseDuration(general, "LISA_ADMISSION_MAX_WAIT");
  }
  if (!push) {
    return local.maxWaitSeconds === undefined
      ? DEFAULT_MAX_WAIT_MS
      : local.maxWaitSeconds * 1000;
  }
  if (pushOnly !== undefined && pushOnly.trim() !== "") {
    return parseDuration(pushOnly, "LISA_ADMISSION_PUSH_MAX_WAIT");
  }
  return local.pushMaxWaitSeconds === undefined
    ? DEFAULT_PUSH_MAX_WAIT_MS
    : local.pushMaxWaitSeconds * 1000;
}

/**
 * Resolve every admission setting for one run.
 * @param options - Inputs
 * @param options.environment - Environment
 * @param options.cwd - Project root holding `.lisa.config.local.json`
 * @param options.maxWaitOverride - `--max-wait` from the command line
 * @returns Settings
 */
export function resolveAdmissionSettings(options: {
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly maxWaitOverride?: string;
}): AdmissionSettings {
  const { environment } = options;
  const local = readLocalAdmissionConfig(options.cwd);
  const push = environment.LISA_ADMISSION_CONTEXT?.trim() === PUSH_CONTEXT;
  const cache = environment.XDG_CACHE_HOME?.trim();
  return {
    skipped: skipReason(environment),
    thresholds: {
      maxLoadPerCore:
        envNumber(environment, "LISA_ADMISSION_MAX_LOAD_PER_CORE") ??
        local.maxLoadPerCore ??
        DEFAULT_MAX_LOAD_PER_CORE,
      minFreeMemoryMb:
        envNumber(environment, "LISA_ADMISSION_MIN_FREE_MEMORY_MB") ??
        local.minFreeMemoryMb ??
        DEFAULT_MIN_FREE_MEMORY_MB,
      recentWindowMs: RECENT_RESERVATION_WINDOW_MS,
    },
    maxWaitMs: maxWait(environment, local, push, options.maxWaitOverride),
    pollMs: envNumber(environment, "LISA_ADMISSION_POLL_MS") ?? DEFAULT_POLL_MS,
    push,
    stateDir:
      environment.LISA_ADMISSION_STATE_DIR?.trim() ||
      join(
        cache === undefined || cache === "" ? join(homedir(), ".cache") : cache,
        "lisa",
        "admission"
      ),
  };
}
