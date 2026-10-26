/**
 * Resolve the opt-in `sessionManager` block of `.lisa.config.json`.
 *
 * Every other session-manager module reads its settings from the object this
 * returns, so the documented defaults live in exactly one place. Merging is per
 * key, local over global, the same rule every other Lisa config key follows: a
 * developer can lower `capacity.maxWorkers` on their own machine without
 * restating the rest of the block.
 *
 * The block is deliberately not registered in `src/sync/registry.ts`. That
 * registry populates defaults into every project, and the manager starts
 * yolo-mode sessions; it must exist only where an operator wrote it.
 *
 * Pure. Repo detection, which reads the filesystem, lives in repo-detect.mjs
 * and is re-exported here so callers keep one import.
 * @module session-manager/config
 */

import { isAbsolute, resolve, sep } from "node:path";

import {
  mergeConfigLayers as mergeLayers,
  parseLoopInterval,
  validateSessionManager,
} from "../../lisa-secrets-access/scripts/validate-config.mjs";

export { parseLoopInterval, validateSessionManager };
export { detectRepoLayout, detectRepos, draftHints } from "./repo-detect.mjs";

/**
 * Documented defaults for every optional key.
 *
 * `name` and `notify.stateDir` have none: both are per-project, and a shared
 * default for either is how two projects end up fighting over one bot.
 * `buildDefaultBlock` derives them from the project slug at setup time.
 */
export const SESSION_MANAGER_DEFAULTS = Object.freeze({
  interval: "5m",
  capacity: Object.freeze({
    maxWorkers: 6,
    gbPerWorker: 3,
    reserveGb: 8,
    cpuFraction: 0.75,
    maxLoadPerCore: 1.5,
  }),
  stall: Object.freeze({
    noOutputMinutes: 60,
    maxAttempts: 3,
    requestionHours: 4,
  }),
  notify: Object.freeze({ provider: "telegram" }),
});

/**
 * @typedef {{ root: string, entries: Record<string, { hints: string[] }> }} ReposBlock
 * @typedef {{ maxWorkers: number, gbPerWorker: number, reserveGb: number,
 *   cpuFraction: number, maxLoadPerCore: number }} CapacityBlock
 * @typedef {{ noOutputMinutes: number, maxAttempts: number,
 *   requestionHours: number }} StallBlock
 * @typedef {{ provider: string, stateDir?: string }} NotifyBlock
 * @typedef {{
 *   name: string,
 *   interval: string,
 *   repos: ReposBlock | null,
 *   capacity: CapacityBlock,
 *   stall: StallBlock,
 *   notify: NotifyBlock,
 *   trustedAuthorIds: string[] | null,
 *   operatorIds?: string[] | null,
 *   backlogPickup?: boolean,
 * }} SessionManagerConfig
 * @typedef {{
 *   name: string,
 *   interval: string,
 *   repos?: ReposBlock,
 *   capacity: CapacityBlock,
 *   stall: StallBlock,
 *   notify: { provider: string, stateDir: string },
 * }} SessionManagerBlock
 */

/** Where child repos live when `repos.root` is omitted. */
const DEFAULT_REPOS_ROOT = "projects";

/** One path segment that cannot climb out of, or hide inside, its parent. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Whether a value is a plain object (not null, not an array).
 * @param {unknown} value Candidate.
 * @returns {boolean} True for `{}`-shaped values.
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve the effective `sessionManager` settings.
 *
 * Pass the two parsed config files, or one already-merged config. Returns
 * `null` when neither declares the block, so callers can say "not configured"
 * instead of running with a guessed name. Validation is separate
 * (`validateSessionManager`), because doctor wants every problem listed while
 * the CLI only needs a usable object.
 * @param {object|undefined} globalConfig Parsed `.lisa.config.json` (or a
 *   merged config).
 * @param {object|undefined} [localConfig] Parsed `.lisa.config.local.json`.
 * @returns {SessionManagerConfig | null} The resolved block, or null when
 *   absent.
 */
export function resolveSessionManagerConfig(globalConfig, localConfig) {
  const declared = [globalConfig, localConfig]
    .map(config => (isPlainObject(config) ? config.sessionManager : undefined))
    .filter(isPlainObject);
  if (declared.length === 0) return null;

  const merged = mergeLayers(SESSION_MANAGER_DEFAULTS, ...declared);
  const repos = isPlainObject(merged.repos)
    ? mergeLayers({ root: DEFAULT_REPOS_ROOT, entries: {} }, merged.repos)
    : null;
  return {
    ...merged,
    repos,
    trustedAuthorIds: merged.trustedAuthorIds ?? null,
    // Left as declared: absent stays undefined and an explicit null stays null,
    // so validation can refuse the null instead of reading it as "no operators".
    operatorIds: merged.operatorIds,
  };
}

/**
 * Turn a project name into a slug the validator accepts.
 * @param {string} projectSlug Project name, possibly with dots or capitals.
 * @returns {string} Lowercase, dash-separated slug.
 */
function normalizeSlug(projectSlug) {
  const slug = String(projectSlug ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    // Leave room for the "-manager" suffix inside the 64-character name limit.
    .slice(0, 56)
    .replace(/-+$/, "");
  if (!slug) {
    throw new Error(
      `project slug ${JSON.stringify(projectSlug)} has no letters or digits ` +
        `to name the manager after.`
    );
  }
  return slug;
}

/**
 * Build the block setup writes into a project's `.lisa.config.json`.
 *
 * Defaults are written out rather than left implicit, so an operator sees
 * every knob in the file they will edit. With no detected repos the block has
 * no `repos` key, which is what makes a project single-repo. Each detected
 * repo's hints are its drafted hints when given (`draftHints`), else its own
 * name: valid either way, and setup asks the operator to review them.
 * `reposRoot` is where the repos were found (`detectRepoLayout`): `projects`
 * by default, or `.` when they sit directly under the project root.
 * @param {{ projectSlug: string, detectedRepos?: string[],
 *   hints?: Record<string, string[]>, reposRoot?: string }} input Project
 *   slug, the output of `detectRepos`, drafted hints per repo, and the repos
 *   root they were found under.
 * @returns {SessionManagerBlock} A block `validateSessionManager` accepts.
 */
export function buildDefaultBlock({
  projectSlug,
  detectedRepos = [],
  hints = {},
  reposRoot = DEFAULT_REPOS_ROOT,
}) {
  const slug = normalizeSlug(projectSlug);
  const repos = [...detectedRepos].sort();
  return {
    name: `${slug}-manager`,
    interval: SESSION_MANAGER_DEFAULTS.interval,
    ...(repos.length > 0
      ? {
          repos: {
            root: reposRoot,
            entries: Object.fromEntries(
              repos.map(name => [
                name,
                { hints: hints[name]?.length ? [...hints[name]] : [name] },
              ])
            ),
          },
        }
      : {}),
    capacity: { ...SESSION_MANAGER_DEFAULTS.capacity },
    stall: { ...SESSION_MANAGER_DEFAULTS.stall },
    notify: {
      provider: SESSION_MANAGER_DEFAULTS.notify.provider,
      stateDir: `~/.claude/channels/telegram-${slug}`,
    },
  };
}

/**
 * Resolve the directory a worker for `key` must start in.
 *
 * Workers run with permissions bypassed, so this refuses rather than guesses:
 * an unknown key, a key on a single-repo project, or a missing key on a
 * multi-repo one all throw. Only own `entries` keys resolve, so `constructor`
 * and friends cannot.
 * @param {{ repos?: unknown } | null | undefined} config Resolved (or raw)
 *   `sessionManager` block.
 * @param {string|undefined} key Repo key; omit, or pass `.`, for single-repo.
 * @param {string} projectRoot Absolute project root.
 * @returns {string} Absolute repo directory.
 */
export function resolveRepoDir(config, key, projectRoot) {
  if (typeof projectRoot !== "string" || !isAbsolute(projectRoot)) {
    throw new Error(
      `project root ${JSON.stringify(projectRoot)} must be an absolute path.`
    );
  }
  const repos = isPlainObject(config?.repos) ? config.repos : null;
  const noKey = key === undefined || key === null || key === "" || key === ".";

  if (!repos) {
    if (noKey) return resolve(projectRoot);
    throw new Error(
      `repo ${JSON.stringify(key)} given, but this is a single-repo project ` +
        `(sessionManager.repos is not set); workers start at the project root.`
    );
  }

  const entries = isPlainObject(repos.entries) ? repos.entries : {};
  const known = Object.keys(entries).sort();
  if (noKey) {
    throw new Error(
      `this multi-repo project needs a repo key; one of: ${known.join(", ")}.`
    );
  }
  if (!Object.hasOwn(entries, key) || !SAFE_SEGMENT.test(key)) {
    throw new Error(
      `repo ${JSON.stringify(key)} is not one of sessionManager.repos.entries: ` +
        `${known.join(", ")}.`
    );
  }
  const base = resolve(projectRoot);
  const dir = resolve(base, repos.root ?? DEFAULT_REPOS_ROOT, key);
  // `repos.root` is validated elsewhere, but this is the last step before a
  // bypass-permissions launch, so it re-checks containment itself.
  if (!dir.startsWith(`${base}${sep}`)) {
    throw new Error(
      `sessionManager.repos.root ${JSON.stringify(repos.root)} resolves ` +
        `outside the project root.`
    );
  }
  return dir;
}
