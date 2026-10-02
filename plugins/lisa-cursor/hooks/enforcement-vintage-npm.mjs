/**
 * The two rows `enforcement-vintage` could not show before: the Lisa version the
 * PROJECT installed, and the newest Lisa PUBLISHED (CodySwannGT/lisa#4325).
 *
 * Why these two. The session-copy rows answer "is this session running the
 * newest Lisa on this disk?" — and a whole host can be current by that measure
 * while sitting many releases behind npm, because nothing on the disk is newer
 * than the version the project last installed. A host only moves when something
 * opens an update PR for it. The agent standing in that host is the party most
 * able to notice and least likely to be told, so the comparison goes where the
 * agent reads: the injected context.
 *
 * NO NETWORK ON THE STARTUP PATH. A session start must never wait on npm. The
 * row is read from the cache the `lisa` CLI's own update check already writes
 * (`node_modules/.cache/@codyswann/lisa/update-check.json`, same shape, same
 * 6-hour freshness), so the two surfaces cannot disagree about "latest". When
 * that cache is missing or stale, a DETACHED child refreshes it for the next
 * session and this session reports what it has — a stale reading named as
 * stale, never a guess.
 *
 * FAIL SOFT, ALWAYS. Every function here returns a neutral value on any error.
 * @module plugins/src/base/hooks/enforcement-vintage-npm
 */
import { spawn } from "child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** The package whose versions are compared. */
export const LISA_PACKAGE = "@codyswann/lisa";

/** Same freshness window as the CLI update check (`src/cli/update-check.ts`). */
export const NPM_LATEST_TTL_MS = 6 * 60 * 60 * 1000;

/** Budget for the detached refresh; it runs after the session has started. */
const REFRESH_TIMEOUT_MS = 5000;

/**
 * Registry endpoint for the latest dist-tag.
 *
 * The cached mutable pointer lags a publish by minutes (CodySwannGT/lisa#3685).
 * That is fine here for the same reason it is fine in the CLI nag: nothing
 * downstream of this value chooses, publishes or gates — it is advice.
 */
const NPM_LATEST_URL = "https://registry.npmjs.org/@codyswann/lisa/latest";

/** A plain `x.y.z` release, optionally with a prerelease or build suffix. */
const VERSION_SHAPE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/u;

/**
 * Parse a JSON file, or return null.
 * @param {string} file Absolute path.
 * @returns {any} Parsed JSON, or null when unreadable or malformed.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The update-check cache path for a project — the CLI's own path.
 * @param {string} projectDir Project root.
 * @returns {string} Absolute cache path.
 */
export function npmLatestCachePath(projectDir) {
  return path.join(
    projectDir,
    "node_modules",
    ".cache",
    "@codyswann",
    "lisa",
    "update-check.json"
  );
}

/**
 * The Lisa version this project installed, or null when it has none to show.
 *
 * Null inside the Lisa monorepo itself: there `node_modules/@codyswann/lisa` is
 * a fixture pinned majors behind the repository, and reporting it as the
 * project's pin would tell every Lisa session its project is stale.
 * @param {string} projectDir Project root.
 * @returns {{version: string, source: string} | null} The installed copy.
 */
export function projectPin(projectDir) {
  const own = readJson(path.join(projectDir, "package.json"));
  if (own?.name === LISA_PACKAGE) return null;
  const source = path.join(
    projectDir,
    "node_modules",
    "@codyswann",
    "lisa",
    "package.json"
  );
  const version = readJson(source)?.version;
  return typeof version === "string" && VERSION_SHAPE.test(version)
    ? { version, source }
    : null;
}

/**
 * Read the cached npm latest.
 * @param {string} cachePath Absolute cache path.
 * @param {number} nowMs Current time in ms.
 * @param {number} [ttlMs] Freshness window.
 * @returns {{version: string, fetchedAt: string, fresh: boolean} | null} Cached value.
 */
export function cachedNpmLatest(cachePath, nowMs, ttlMs = NPM_LATEST_TTL_MS) {
  const cache = readJson(cachePath);
  const version = cache?.latest;
  const fetchedAt = cache?.fetchedAt;
  if (typeof version !== "string" || !VERSION_SHAPE.test(version)) return null;
  if (typeof fetchedAt !== "string") return null;
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return null;
  return { version, fetchedAt, fresh: nowMs - fetchedMs <= ttlMs };
}

/**
 * Whether a refresh should be started for this session.
 * @param {{version: string, fresh: boolean} | null} cached Cached value.
 * @param {NodeJS.ProcessEnv} env Environment.
 * @returns {boolean} True when the cache is missing or stale and checks are on.
 */
export function needsRefresh(cached, env) {
  if (env.LISA_SKIP_UPDATE_CHECK === "1") return false;
  return cached === null || !cached.fresh;
}

/**
 * Start a detached refresh of the cache and return immediately.
 * @param {string} script Absolute path of this module.
 * @param {string} cachePath Absolute cache path.
 * @param {typeof spawn} [spawnImpl] Injected for tests.
 * @returns {boolean} Whether a child was started.
 */
export function startDetachedRefresh(script, cachePath, spawnImpl = spawn) {
  try {
    const child = spawnImpl(
      process.execPath,
      [script, "--refresh-npm-latest", cachePath],
      { detached: true, stdio: "ignore" }
    );
    child.on?.("error", () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch npm latest and write it to the cache in the CLI's shape.
 *
 * probe-direction: neutral — a failed fetch writes nothing, so the next
 * session reports "npm latest: unknown" (or the older cached value, labelled
 * stale); no gate reads this value, it only shapes advisory context.
 * @param {string} cachePath Absolute cache path.
 * @param {{fetchImpl?: typeof fetch, now?: () => Date}} [deps] Injected for tests.
 * @returns {Promise<string | null>} The version written, or null.
 */
export async function refreshNpmLatest(cachePath, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  try {
    const response = await fetchImpl(NPM_LATEST_URL, {
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const version = body?.version;
    if (typeof version !== "string" || !VERSION_SHAPE.test(version)) {
      return null;
    }
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      `${JSON.stringify({ latest: version, fetchedAt: now().toISOString() }, null, 2)}\n`,
      "utf8"
    );
    return version;
  } catch {
    return null;
  }
}

/**
 * Render the project and npm rows, plus the guidance when the project is behind.
 * @param {{pin: {version: string, source: string} | null, latest: {version: string, fetchedAt: string, fresh: boolean} | null, refreshing: boolean, projectBehind: boolean}} state Resolved rows.
 * @returns {{rows: string[], guidance: string[]}} Lines to splice into the block.
 */
export function renderNpmRows(state) {
  const rows = [];
  if (state.pin) {
    rows.push(`project pin: lisa ${state.pin.version} at ${state.pin.source}`);
  }
  if (state.latest) {
    rows.push(
      `npm latest: lisa ${state.latest.version} (checked ${state.latest.fetchedAt}${state.latest.fresh ? "" : "; stale"}${state.refreshing ? ", refreshing for the next session" : ""})`
    );
  } else if (state.pin) {
    rows.push(
      `npm latest: unknown${state.refreshing ? " (checking in the background for the next session)" : ""}`
    );
  }
  const guidance = state.projectBehind
    ? [
        `PROJECT BEHIND — this project installs lisa ${state.pin?.version} while lisa ${state.latest?.version} is published.`,
        "- Do NOT upgrade Lisa inside the current task: a version bump plus its template apply belongs in its own pull request, never mixed into feature work.",
        "- Check for an open pull request on a `lisa/update-*` branch. If none is open, the project's Lisa Update workflow (`.github/workflows/lisa-update.yml`) opens one on its schedule; say so in your report, and if that workflow is missing, recommend running `lisa apply` once so the project receives it.",
      ]
    : [];
  return { rows, guidance };
}

/**
 * Resolve everything the npm rows need, starting a refresh when warranted.
 * @param {{projectDir: string, script?: string, env: NodeJS.ProcessEnv, nowMs: number, isOlder: (a: string, b: string) => boolean, spawnImpl?: typeof spawn}} input Inputs.
 * @returns {{pin: {version: string, source: string} | null, latest: {version: string, fetchedAt: string, fresh: boolean} | null, refreshing: boolean, projectBehind: boolean}} Resolved rows.
 */
export function resolveNpmState(input) {
  try {
    const pin = projectPin(input.projectDir);
    if (pin === null) {
      return { pin, latest: null, refreshing: false, projectBehind: false };
    }
    const cachePath = npmLatestCachePath(input.projectDir);
    const latest = cachedNpmLatest(cachePath, input.nowMs);
    const refreshing =
      needsRefresh(latest, input.env) &&
      startDetachedRefresh(
        input.script ?? fileURLToPath(import.meta.url),
        cachePath,
        input.spawnImpl
      );
    const projectBehind = Boolean(
      latest && input.isOlder(pin.version, latest.version)
    );
    return { pin, latest, refreshing, projectBehind };
  } catch {
    return { pin: null, latest: null, refreshing: false, projectBehind: false };
  }
}

/**
 * Whether this module is the process entry point (the detached refresh child).
 * Realpaths both sides for the reason `enforcement-vintage.mjs` gives.
 * @param {string} moduleUrl This module's `import.meta.url`.
 * @param {string | undefined} [argv1] Entry path.
 * @returns {boolean} True when run directly.
 */
function invokedDirectly(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (
  invokedDirectly(import.meta.url) &&
  process.argv[2] === "--refresh-npm-latest" &&
  process.argv[3]
) {
  refreshNpmLatest(process.argv[3]).catch(() => {});
}
