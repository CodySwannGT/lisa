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
 * Pure apart from `detectRepos`, whose filesystem calls are injectable.
 * @module session-manager/config
 */

import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

import {
  parseLoopInterval,
  validateSessionManager,
} from "../../lisa-secrets-access/scripts/validate-config.mjs";

export { parseLoopInterval, validateSessionManager };

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

/** Keys that would reach `Object.prototype` if copied by assignment. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Whether a value is a plain object (not null, not an array).
 * @param {unknown} value Candidate.
 * @returns {boolean} True for `{}`-shaped values.
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge objects key by key, later layers winning.
 *
 * Arrays and scalars are replaced, never concatenated: a local `hints` list
 * means "these hints", not "these as well". Prototype keys are dropped, since
 * the local file is operator-written but still parsed JSON.
 * @param {...unknown} layers Lowest precedence first.
 * @returns {Record<string, unknown>} A new object; no layer is mutated.
 */
function mergeLayers(...layers) {
  const objects = layers.filter(isPlainObject);
  const keys = [...new Set(objects.flatMap(Object.keys))].filter(
    key => !UNSAFE_KEYS.has(key)
  );
  return Object.fromEntries(
    keys.map(key => {
      const values = objects
        .filter(layer => Object.hasOwn(layer, key))
        .map(layer => layer[key]);
      const top = values.at(-1);
      return [
        key,
        isPlainObject(top) ? mergeLayers(...values.filter(isPlainObject)) : top,
      ];
    })
  );
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
  };
}

/**
 * List the Lisa-configured child repos of a multi-repo project.
 *
 * A child counts only when it carries its own `.lisa.config.json`: workers run
 * `/lisa:implement` inside it, which needs that file, and a stray directory
 * under `projects/` is not something to route tickets into.
 * @param {string} root Project root.
 * @param {{
 *   reposRoot?: string,
 *   fs?: { existsSync: (p: string) => boolean,
 *     readdirSync: (p: string, o: { withFileTypes: true }) =>
 *       Array<{ name: string, isDirectory: () => boolean }> },
 * }} [options] Repos root (default `projects`) and filesystem seam.
 * @returns {string[]} Child directory names, sorted.
 */
export function detectRepos(root, options = {}) {
  const fs = options.fs ?? { existsSync, readdirSync };
  const base = join(root, options.reposRoot ?? DEFAULT_REPOS_ROOT);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && SAFE_SEGMENT.test(entry.name))
    .filter(entry => fs.existsSync(join(base, entry.name, ".lisa.config.json")))
    .map(entry => entry.name)
    .sort();
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
 * repo's hints start as its own name: valid, and an obvious prompt to add real
 * ones.
 * @param {{ projectSlug: string, detectedRepos?: string[] }} input Project
 *   slug and the output of `detectRepos`.
 * @returns {SessionManagerBlock} A block `validateSessionManager` accepts.
 */
export function buildDefaultBlock({ projectSlug, detectedRepos = [] }) {
  const slug = normalizeSlug(projectSlug);
  const repos = [...detectedRepos].sort();
  return {
    name: `${slug}-manager`,
    interval: SESSION_MANAGER_DEFAULTS.interval,
    ...(repos.length > 0
      ? {
          repos: {
            root: DEFAULT_REPOS_ROOT,
            entries: Object.fromEntries(
              repos.map(name => [name, { hints: [name] }])
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
