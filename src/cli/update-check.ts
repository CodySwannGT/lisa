import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { gt, valid } from "semver";
import { getPackageVersion } from "./version.js";

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 2500;
const NPM_LATEST_URL = "https://registry.npmjs.org/@codyswann/lisa/latest";

/** Runtime options for Lisa's non-fatal update check. */
export interface UpdateCheckOptions {
  /** Process arguments used to detect --no-update-check. */
  argv?: readonly string[];
  /** Override cache path for tests and controlled runs. */
  cachePath?: string;
  /** Override current package version. */
  currentVersion?: string;
  /** Environment map used to detect LISA_SKIP_UPDATE_CHECK. */
  env?: NodeJS.ProcessEnv;
  /** Fetch implementation override. */
  fetchImpl?: typeof fetch;
  /** Clock override. */
  now?: () => Date;
  /** Registry timeout in milliseconds. */
  timeoutMs?: number;
  /** Cache TTL in milliseconds. */
  ttlMs?: number;
}

/** Result from a non-fatal npm latest-version check. */
export interface UpdateCheckResult {
  /** Installed Lisa version. */
  current: string;
  /** Latest npm version, or null when unavailable/skipped. */
  latest: string | null;
  /** True when latest is a valid semver greater than current. */
  isOutdated: boolean;
  /** Machine-readable non-fatal outcome reason. */
  reason?: string;
}

/** Serialized cache file shape. */
interface UpdateCheckCache {
  /** Cached npm latest version. */
  latest?: unknown;
  /** ISO timestamp for the cache write. */
  fetchedAt?: unknown;
  /** Optional non-fatal failure reason. */
  reason?: unknown;
}

/**
 * Resolve the default Lisa update-check cache path.
 * @param cwd Project working directory.
 * @returns Absolute cache file path
 */
export function getDefaultCachePath(cwd: string = process.cwd()): string {
  return path.join(
    cwd,
    "node_modules",
    ".cache",
    "@codyswann",
    "lisa",
    "update-check.json"
  );
}

/**
 * Read process.env through one explicit, reviewable exception to the app-template
 * env rule. The CLI needs externally supplied process env for this root opt-out.
 * @returns Current process environment
 */
function getProcessEnv(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- CLI root option must read externally supplied process env once
  return process.env;
}

/**
 * Determine whether the update check is disabled for this invocation.
 * @param argv - Process arguments
 * @param env - Process environment
 * @returns True when a flag or env opt-out is present
 */
function isUpdateCheckDisabled(
  argv: readonly string[],
  env: NodeJS.ProcessEnv
): boolean {
  return (
    argv.includes("--no-update-check") || env.LISA_SKIP_UPDATE_CHECK === "1"
  );
}

/**
 * Return a fresh cached latest version when the cache is usable.
 * @param raw - Raw cache JSON
 * @param now - Current wall-clock time
 * @param ttlMs - Freshness TTL in milliseconds
 * @returns Cached latest version, or null when missing/stale/malformed
 */
function readCachedLatest(
  raw: string,
  now: Date,
  ttlMs: number
): string | null {
  const parsed = JSON.parse(raw) as UpdateCheckCache;
  if (
    typeof parsed.latest !== "string" ||
    typeof parsed.fetchedAt !== "string"
  ) {
    return null;
  }

  if (valid(parsed.latest) === null) {
    return null;
  }

  const fetchedAt = Date.parse(parsed.fetchedAt);
  if (!Number.isFinite(fetchedAt)) {
    return null;
  }

  if (now.getTime() - fetchedAt > ttlMs) {
    return null;
  }

  return parsed.latest;
}

/**
 * Convert current/latest values into the public result shape.
 * @param current - Installed version
 * @param latest - Latest version or null
 * @param reason - Optional non-fatal reason
 * @returns Normalized update-check result
 */
function toResult(
  current: string,
  latest: string | null,
  reason?: string
): UpdateCheckResult {
  const isOutdated =
    typeof latest === "string" &&
    valid(current) !== null &&
    valid(latest) !== null &&
    gt(latest, current);

  return {
    current,
    latest,
    isOutdated,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Persist the latest-version cache used by later CLI invocations.
 * @param cachePath - Absolute cache path
 * @param latest - Latest version or null on failure
 * @param fetchedAt - Fetch completion timestamp
 * @param reason - Optional non-fatal reason
 * @returns Promise that resolves after the cache is written
 */
async function writeCache(
  cachePath: string,
  latest: string | null,
  fetchedAt: Date,
  reason?: string
): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    `${JSON.stringify(
      {
        latest,
        fetchedAt: fetchedAt.toISOString(),
        ...(reason ? { reason } : {}),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

/**
 * Check npm for the latest Lisa version without ever failing the caller.
 * @param opts - Runtime overrides for tests or controlled CLI execution
 * @returns Update-check result with current/latest/outdated metadata
 */
export async function runUpdateCheck(
  opts: UpdateCheckOptions = {}
): Promise<UpdateCheckResult> {
  const current = opts.currentVersion ?? getPackageVersion();
  const argv = opts.argv ?? process.argv;
  const env = opts.env ?? getProcessEnv();

  if (isUpdateCheckDisabled(argv, env)) {
    return toResult(current, null, "skipped");
  }

  const cachePath = opts.cachePath ?? getDefaultCachePath();
  const now = opts.now ?? (() => new Date());
  const ttlMs = opts.ttlMs ?? DEFAULT_CACHE_TTL_MS;

  try {
    const cached = readCachedLatest(
      await readFile(cachePath, "utf8"),
      now(),
      ttlMs
    );
    if (cached) {
      return toResult(current, cached, "cached");
    }
  } catch {
    // Missing or malformed cache should not prevent a fresh check.
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  try {
    const response = await (opts.fetchImpl ?? fetch)(NPM_LATEST_URL, {
      signal: controller.signal,
    });
    if (!response.ok) {
      await writeCache(cachePath, null, now(), `http-${response.status}`).catch(
        () => undefined
      );
      return toResult(current, null, `http-${response.status}`);
    }

    const body = (await response.json()) as { version?: unknown };
    if (typeof body.version !== "string" || valid(body.version) === null) {
      await writeCache(cachePath, null, now(), "invalid-response").catch(
        () => undefined
      );
      return toResult(current, null, "invalid-response");
    }

    await writeCache(cachePath, body.version, now()).catch(() => undefined);
    return toResult(current, body.version);
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "network-error";
    await writeCache(cachePath, null, now(), reason).catch(() => undefined);
    return toResult(current, null, reason);
  } finally {
    clearTimeout(timeout);
  }
}
