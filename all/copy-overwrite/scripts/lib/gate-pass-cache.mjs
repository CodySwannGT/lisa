// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Remember a push gate's pass by the content it proved (CodySwannGT/lisa#4594).
 *
 * A retry, or a re-push of an identical tree, used to pay every push gate
 * again — minutes to hours each — for content that had already passed. A pass
 * is remembered under a key derived from everything its verdict can depend on,
 * and a later run with the SAME key reports `CACHED PASS (<key>)` instead of
 * running the gate.
 *
 * ## The cache must never prove what it did not see
 *
 * Every rule here fails toward running the gate:
 *
 * - The working tree must be exactly the tree being pushed: nothing
 *   uncommitted or untracked, and `HEAD^{tree}` equal to the tree of every
 *   non-deletion ref in the push. Otherwise a green would describe a different
 *   tree than the one pushed (CodySwannGT/lisa#3874).
 * - Only a full PASS is recorded — never a failure, a kill, an unprovable or
 *   not-run outcome, or a pass inherited from a shared prover that did not
 *   itself pass — and only after the run, once the tree is re-read unchanged.
 * - A gate whose verdict depends on anything outside the key (the tracker,
 *   live machine state, history beyond the tree) declares `"cache": false` on
 *   its moment entry and always runs.
 * - CI never reads or writes it, and `LISA_GATE_CACHE=off` disables it.
 * - It is off unless `.lisa.config.json` sets `pushGate.cache: true`, so a
 *   host behaves exactly as before until its template turns it on.
 *
 * The store is machine-local — one JSON file per passing key under
 * `${XDG_CACHE_HOME:-~/.cache}/lisa/gate-passes/` — shared by every worktree,
 * and pruned of entries older than 30 days whenever it is written.
 *
 * ## The store never holds an environment value
 *
 * `LISA_*` variables enter the key because some of them change a verdict, but
 * that family also carries credentials — `LISA_SECRETS_BOOTSTRAP` and its key
 * hold the secrets-provider bootstrap credential. The key therefore takes one
 * digest of the relevant environment, and a stored record keeps only that
 * digest plus the NAMES of the variables that are not secret-looking. No value
 * is ever written. The directory is created (and re-tightened) 0700 and every
 * entry 0600, so even the names and digests are private to the user, and an
 * entry not written under the current schema is deleted on the next write —
 * an earlier schema stored raw values (CodySwannGT/lisa#4594 review).
 * @module lib/gate-pass-cache
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The environment variable that switches the cache off for one run. */
export const CACHE_ENV = "LISA_GATE_CACHE";

/** The per-moment gate field that opts a gate out of the cache. */
export const CACHE_FIELD = "cache";

/** Version of the key derivation; bumping it invalidates every entry. */
export const KEY_SCHEMA = "lisa.gate-pass/v2";

/**
 * Name fragments that mark a variable as possibly holding a credential. Such a
 * name stays out of every stored record; its value still enters the digest.
 */
export const SECRET_NAME_PATTERN =
  /KEY|TOKEN|SECRET|PASSWORD|PASSWD|BOOTSTRAP|CREDENTIAL|AUTH|PRIVATE/i;

/** Mode of the store directory: only the user may list or enter it. */
export const STORE_DIR_MODE = 0o700;

/** Mode of every stored entry: only the user may read it. */
export const STORE_FILE_MODE = 0o600;

/** Entries older than this are ignored on read and pruned on write. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Lockfiles whose bytes enter the key whenever they are present. */
export const LOCKFILES = Object.freeze([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Gemfile.lock",
]);

/** Non-`LISA_*` variables that change how a gate behaves. */
export const ENV_ALLOWLIST = Object.freeze(["NODE_OPTIONS", "NODE_ENV", "TZ"]);

/**
 * `LISA_*` variables left out of the key because they differ on every run
 * without changing a verdict: the switch itself, the hook's temp file of
 * pushed refs, and the cleanup sweep's ownership marker. Left in, each would
 * make every lookup miss.
 *
 * The admission wait bounds are excluded too, by the `LISA_ADMISSION` prefix
 * rule in `relevantEnvironment`: `lisa check` sets `LISA_ADMISSION_MAX_WAIT`
 * so it can wait longer for machine headroom than a push may, and the push
 * that follows does not. A wait bound decides when a gate STARTS, never what
 * it proves, so keying on it would only make the push miss every pass
 * `lisa check` recorded (CodySwannGT/lisa#4601).
 */
export const VOLATILE_LISA_ENV = Object.freeze([
  CACHE_ENV,
  "LISA_PUSHED_REFS_FILE",
  "LISA_CLEANUP_SWEPT",
  // The test-run owner marker (`<pid>:0`) a Rails pre-push command exports
  // before its payload (CodySwannGT/lisa#4603, #4613): a new pid every run.
  "LISA_TEST_RUN_OWNER",
  // Headroom admission (CodySwannGT/lisa#4596): a grant and a holder pid
  // describe the machine at that moment, not the content being proved.
  "LISA_ADMITTED_WORKERS",
  "LISA_ADMISSION_HOLDER",
]);

const ZERO_SHA = /^0+$/;

/**
 * Read `pushGate.cache` from the project config.
 * @param {object|null|undefined} config Parsed `.lisa.config.json`.
 * @returns {{enabled: boolean, problem: string|null}} Whether the cache is on,
 *   and why the declaration was refused when it is malformed.
 */
export function cacheSetting(config) {
  const block = config?.pushGate;
  if (block === undefined) return { enabled: false, problem: null };
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    return {
      enabled: false,
      problem: `pushGate is ${JSON.stringify(block)}; expected an object such as {"cache": true}`,
    };
  }
  if (block.cache === undefined) return { enabled: false, problem: null };
  if (typeof block.cache !== "boolean") {
    return {
      enabled: false,
      problem: `pushGate.cache is ${JSON.stringify(block.cache)}; expected true or false`,
    };
  }
  return { enabled: block.cache, problem: null };
}

/**
 * Where passes are stored.
 * @param {Record<string, string|undefined>} env Process environment.
 * @returns {string} Absolute directory path.
 */
export function cacheDirectory(env) {
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "lisa", "gate-passes");
}

/**
 * The environment variables that enter the key, sorted by name.
 * @param {Record<string, string|undefined>} env Process environment.
 * @returns {Record<string, string>} The allowlisted, defined variables.
 */
export function relevantEnvironment(env) {
  const names = Object.keys(env)
    .filter(
      name =>
        ENV_ALLOWLIST.includes(name) ||
        (name.startsWith("LISA_") &&
          !VOLATILE_LISA_ENV.includes(name) &&
          // Every headroom-admission knob (CodySwannGT/lisa#4596) changes
          // only WHEN a step starts, never what it proves.
          !name.startsWith("LISA_ADMISSION"))
    )
    .filter(name => env[name] !== undefined)
    .sort();
  return Object.fromEntries(names.map(name => [name, env[name]]));
}

/**
 * The relevant environment reduced to what may be stored: one digest of every
 * relevant name and value, and the names that do not look like credentials.
 * @param {Record<string, string|undefined>} env Process environment.
 * @returns {{digest: string, names: string[]}} The digest enters the key, so
 *   changing any relevant value — secret-looking or not — still misses.
 */
export function environmentFingerprint(env) {
  const relevant = relevantEnvironment(env);
  return {
    digest: createHash("sha256").update(canonicalJson(relevant)).digest("hex"),
    names: Object.keys(relevant).filter(
      name => !SECRET_NAME_PATTERN.test(name)
    ),
  };
}

/**
 * JSON with object keys sorted at every depth, so equal inputs hash equally.
 * @param {unknown} value Any JSON value.
 * @returns {string} Canonical JSON text.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort();
    return `{${keys
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The cache key for one gate.
 * @param {object} inputs Everything the verdict can depend on.
 * @returns {string} sha256 hex digest.
 */
export function gateKey(inputs) {
  return createHash("sha256")
    .update(canonicalJson({ schema: KEY_SCHEMA, ...inputs }))
    .digest("hex");
}

/**
 * Run git and return trimmed stdout, or null when it failed.
 * @param {string[]} args Git arguments.
 * @param {string} cwd Directory to run in.
 * @returns {string|null} Output.
 */
function defaultGit(args, cwd) {
  const child = spawnSync("git", args, { cwd, encoding: "utf8" });
  return child.status === 0 ? String(child.stdout).trim() : null;
}

/**
 * The tree this run proves, or why the cache cannot be used for it.
 * @param {object} options Inputs.
 * @param {string} options.cwd Repository directory.
 * @param {Record<string, string|undefined>} options.env Process environment.
 * @param {(args: string[], cwd: string) => (string|null)} options.git Git runner.
 * @returns {{tree: string}|{skip: string}} The proved tree, or a reason.
 */
export function provedTree({ cwd, env, git }) {
  const status = git(["status", "--porcelain"], cwd);
  if (status === null) return { skip: "git could not read the working tree" };
  if (status !== "") {
    return {
      skip: "the working tree differs from the pushed commit (uncommitted or untracked changes)",
    };
  }
  const tree = git(["rev-parse", "HEAD^{tree}"], cwd);
  if (!tree) return { skip: "HEAD has no tree to prove" };
  const refsFile = env.LISA_PUSHED_REFS_FILE;
  if (!refsFile) return { tree };
  let lines;
  try {
    lines = readFileSync(refsFile, "utf8").split("\n").filter(Boolean);
  } catch {
    return { skip: "the list of pushed refs could not be read" };
  }
  const shas = lines
    .map(line => line.trim().split(/\s+/)[1] ?? "")
    .filter(sha => /^[0-9a-f]+$/.test(sha) && !ZERO_SHA.test(sha));
  if (shas.length === 0) return { skip: "nothing pushed has a tree" };
  for (const sha of shas) {
    if (git(["rev-parse", `${sha}^{tree}`], cwd) !== tree) {
      return {
        skip: "the working tree differs from the pushed commit (a pushed ref's tree is not HEAD's tree)",
      };
    }
  }
  return { tree };
}

/**
 * Read one JSON file's `gates` block; absent file reads as null.
 * @param {string} path File path.
 * @returns {unknown} The block, or null.
 * @throws {Error} When the file exists but is not JSON.
 */
function gatesBlockOf(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")).gates ?? null;
}

/**
 * Key inputs shared by every gate in one run.
 * @param {string} cwd Repository directory.
 * @param {Record<string, string|undefined>} env Process environment.
 * @param {() => (string|null)} bunVersion Reads the bun version.
 * @param {Record<string, string|null>} [extraTools] Further toolchain
 *   versions a caller's gates depend on — a Rails host adds `ruby -v` and
 *   `bundle -v` (CodySwannGT/lisa#4613). Empty for the gate runner, so its
 *   keys are unchanged.
 * @returns {{lockfiles: Record<string, string>, tools: {node: string, bun: string|null}, gatesConfig: {project: unknown, local: unknown}, environment: {digest: string, names: string[]}}}
 *   Lockfile digests, tool versions, config and the environment fingerprint
 *   (never raw values — see `environmentFingerprint`).
 */
export function sharedInputs(cwd, env, bunVersion, extraTools = {}) {
  const lockfiles = Object.fromEntries(
    LOCKFILES.filter(name => existsSync(join(cwd, name))).map(name => [
      name,
      createHash("sha256")
        .update(readFileSync(join(cwd, name)))
        .digest("hex"),
    ])
  );
  return {
    lockfiles,
    tools: { node: process.versions.node, bun: bunVersion(), ...extraTools },
    gatesConfig: {
      project: gatesBlockOf(join(cwd, ".lisa.config.json")),
      local: gatesBlockOf(join(cwd, ".lisa.config.local.json")),
    },
    environment: environmentFingerprint(env),
  };
}

/**
 * `bun --version`, or null when bun is not installed.
 * @returns {string|null} Version.
 */
function defaultBunVersion() {
  const child = spawnSync("bun", ["--version"], { encoding: "utf8" });
  return child.status === 0 ? String(child.stdout).trim() : null;
}

/**
 * Why this run may not use the cache at all, or null when it may.
 * @param {object} config Parsed `.lisa.config.json`.
 * @param {Record<string, string|undefined>} env Process environment.
 * @returns {{silent: boolean, reason: string}|null} The refusal.
 */
function refusal(config, env) {
  const setting = cacheSetting(config);
  if (setting.problem) {
    return { silent: false, reason: `${setting.problem}, so it is off` };
  }
  if (!setting.enabled) return { silent: true, reason: "" };
  if (String(env[CACHE_ENV] ?? "").toLowerCase() === "off") {
    return { silent: false, reason: `the cache is off (${CACHE_ENV}=off)` };
  }
  if (env.CI || env.GITHUB_ACTIONS) {
    return { silent: false, reason: "CI never reads or writes the cache" };
  }
  return null;
}

/**
 * Whether a stored file was written under the current schema. An entry from an
 * earlier schema may hold raw environment values, so it is never kept.
 * @param {string} path Entry path.
 * @returns {boolean} True for a current entry.
 */
function isCurrentEntry(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).schema === KEY_SCHEMA;
  } catch {
    return false;
  }
}

/**
 * Create the store private to the user, or tighten one an earlier run left
 * readable. Throws when it cannot, so nothing is written to an open directory.
 * @param {string} dir Store directory.
 */
function preparePrivateStore(dir) {
  mkdirSync(dir, { recursive: true, mode: STORE_DIR_MODE });
  chmodSync(dir, STORE_DIR_MODE);
}

/**
 * Delete entries older than the retention window or from an earlier schema,
 * and tighten any left readable. Best effort.
 * @param {string} dir Store directory.
 * @param {number} now Epoch milliseconds.
 */
function prune(dir, now) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      const stale = now - statSync(path).mtimeMs > MAX_AGE_MS;
      const current = name.endsWith(".json") && isCurrentEntry(path);
      if (stale || (name.endsWith(".json") && !current))
        rmSync(path, { force: true });
      else chmodSync(path, STORE_FILE_MODE);
    } catch {
      // Another run pruned it first.
    }
  }
}

/**
 * Open the cache for one run, or return null when it may not be used.
 *
 * Prints one line saying why it was skipped, except when the project never
 * turned it on — that path stays silent and touches nothing, so a host is
 * unaffected until its template opts in.
 * @param {object} options Inputs.
 * @param {object} options.config Parsed `.lisa.config.json`.
 * @param {object} options.gates The gates block, for per-moment `cache` flags.
 * @param {string} options.moment The moment being run.
 * @param {(line: string) => void} options.out Line sink.
 * @param {string} [options.cwd] Repository directory.
 * @param {Record<string, string|undefined>} [options.env] Environment.
 * @param {() => number} [options.now] Clock.
 * @param {(args: string[], cwd: string) => (string|null)} [options.git] Git runner.
 * @param {() => (string|null)} [options.bunVersion] Bun version reader.
 * @param {Record<string, string|null>} [options.extraTools] Further toolchain
 *   versions that enter every key (see `sharedInputs`).
 * @returns {{lookup: Function, remember: Function, commit: Function}|null} The cache.
 */
export function openGatePassCache({
  config,
  gates,
  moment,
  out,
  cwd = process.cwd(),
  env = process.env,
  now = Date.now,
  git = defaultGit,
  bunVersion = defaultBunVersion,
  extraTools = {},
}) {
  const refused = refusal(config, env);
  if (refused) {
    if (!refused.silent)
      out(`🗃️  Gate pass cache not used: ${refused.reason}.`);
    return null;
  }
  const proved = provedTree({ cwd, env, git });
  if ("skip" in proved) {
    out(`🗃️  Gate pass cache skipped: ${proved.skip}. Every gate runs.`);
    return null;
  }
  let shared;
  try {
    shared = sharedInputs(cwd, env, bunVersion, extraTools);
  } catch (err) {
    out(`🗃️  Gate pass cache skipped: ${err.message}. Every gate runs.`);
    return null;
  }
  const dir = cacheDirectory(env);
  const keyFor = gate =>
    gateKey({
      ...shared,
      tree: proved.tree,
      moment,
      gate: gate.id,
      command: gate.command,
    });
  const eligible = gate =>
    Boolean(gate.command) &&
    gates?.[gate.id]?.[moment]?.[CACHE_FIELD] !== false;
  const pending = [];
  out(`🗃️  Gate pass cache on for tree ${proved.tree.slice(0, 12)}.`);
  return {
    lookup(gate) {
      if (!eligible(gate)) return null;
      const key = keyFor(gate);
      try {
        const entry = JSON.parse(
          readFileSync(join(dir, `${key}.json`), "utf8")
        );
        const age = now() - Date.parse(entry.passedAt);
        return entry.key === key && age >= 0 && age <= MAX_AGE_MS
          ? { key }
          : null;
      } catch {
        return null;
      }
    },
    remember(gate, durationMs) {
      if (eligible(gate)) pending.push({ gate, durationMs });
    },
    commit() {
      if (pending.length === 0) return;
      const after = provedTree({ cwd, env, git });
      if (!("tree" in after) || after.tree !== proved.tree) {
        out(
          "🗃️  Gate passes not recorded: the working tree changed during the run."
        );
        return;
      }
      try {
        preparePrivateStore(dir);
        prune(dir, now());
        for (const { gate, durationMs } of pending) {
          const key = keyFor(gate);
          const entry = {
            schema: KEY_SCHEMA,
            key,
            gate: gate.id,
            inputs: {
              ...shared,
              tree: proved.tree,
              moment,
              command: gate.command,
            },
            passedAt: new Date(now()).toISOString(),
            durationMs,
          };
          const temp = join(dir, `.${key}.${process.pid}.tmp`);
          writeFileSync(temp, `${JSON.stringify(entry, null, 2)}\n`, {
            mode: STORE_FILE_MODE,
          });
          renameSync(temp, join(dir, `${key}.json`));
        }
      } catch (err) {
        out(`🗃️  Gate passes not recorded: ${err.message}.`);
      }
    },
  };
}
