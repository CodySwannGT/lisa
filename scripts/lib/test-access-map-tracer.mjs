/**
 * Access-map tracer (CodySwannGT/lisa#4593), preloaded into every test worker
 * and every Node child through `NODE_OPTIONS=--import`, so grandchildren
 * inherit it. It records, against the test file named by
 * `LISA_ACCESS_MAP_TEST_FILE`:
 *
 * - module loads, through `module.registerHooks` (ESM imports and `require`);
 * - file reads: `fs.readFile*`, `fs.promises.readFile`, `fs.createReadStream`,
 *   and `fs.openSync` with a read flag;
 * - process spawns: the executable and every argument that names an existing
 *   file, so `spawnSync("bash", ["plugins/…/hook.sh"])` records the script.
 *
 * Records are kept in memory and appended as NDJSON to a per-process file
 * under `LISA_ACCESS_MAP_DIR` on `flush()` (the setup file calls it after each
 * test file) and at exit. It never writes to stdout or stderr: tests compare
 * child output byte for byte. Without `LISA_ACCESS_MAP=1` it does nothing.
 * @module test-access-map-tracer
 */
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TRACER_KEY = Symbol.for("lisa.testAccessMap");

const env = process.env;
const enabled =
  env["LISA_ACCESS_MAP"] === "1" &&
  typeof env["LISA_ACCESS_MAP_DIR"] === "string" &&
  typeof env["LISA_ACCESS_MAP_ROOT"] === "string" &&
  globalThis[TRACER_KEY] === undefined;

if (enabled) install(env["LISA_ACCESS_MAP_DIR"], env["LISA_ACCESS_MAP_ROOT"]);

/**
 * Patch the process and expose `globalThis[Symbol.for("lisa.testAccessMap")]`.
 * @param {string} directory - Raw-record directory
 * @param {string} root - Repository root
 * @returns {void}
 */
function install(directory, root) {
  const original = {
    statSync: fs.statSync,
    appendFileSync: fs.appendFileSync,
    mkdirSync: fs.mkdirSync,
  };
  const output = path.join(directory, `${process.pid}-${randomUUID()}.ndjson`);
  /** @type {Map<string, Set<string>>} */
  const records = new Map();
  const rootPrefix = `${root}${path.sep}`;

  /**
   * Record one absolute path against the current test file.
   * @param {unknown} target - Path, URL or Buffer
   * @returns {void}
   */
  function record(target) {
    const test = env["LISA_ACCESS_MAP_TEST_FILE"];
    if (!test) return;
    const file = toPath(target);
    if (file === undefined) return;
    const absolute = path.resolve(file);
    if (!absolute.startsWith(rootPrefix)) return;
    const set = records.get(test) ?? new Set();
    set.add(absolute);
    records.set(test, set);
  }

  /**
   * Record a spawned command and every argument that names an existing file.
   * @param {unknown} command - Executable
   * @param {ReadonlyArray<unknown>} args - Arguments
   * @param {unknown} options - Spawn options (for `cwd`)
   * @returns {void}
   */
  function recordSpawn(command, args, options) {
    if (!env["LISA_ACCESS_MAP_TEST_FILE"]) return;
    const cwd =
      options && typeof options === "object" && "cwd" in options
        ? toPath(options.cwd)
        : undefined;
    const base = cwd ?? process.cwd();
    [command, ...args].forEach(candidate => {
      if (typeof candidate !== "string" || candidate.length > 4096) return;
      const absolute = path.resolve(base, candidate);
      if (!absolute.startsWith(rootPrefix)) return;
      const stat = original.statSync(absolute, { throwIfNoEntry: false });
      if (stat?.isFile()) record(absolute);
    });
  }

  /**
   * Split a shell command string into the words that might be paths.
   * @param {unknown} command - Shell command
   * @returns {ReadonlyArray<string>} Words
   */
  function shellWords(command) {
    return typeof command === "string"
      ? command.split(/[\s'"`;|&<>()]+/).filter(Boolean)
      : [];
  }

  /**
   * Flush in-memory records to this process's NDJSON file.
   * @returns {void}
   */
  function flush() {
    if (records.size === 0) return;
    const lines = [...records].map(
      ([test, files]) => `${JSON.stringify({ test, files: [...files] })}\n`
    );
    records.clear();
    try {
      original.mkdirSync(directory, { recursive: true });
      original.appendFileSync(output, lines.join(""));
    } catch {
      // A lost record only widens what B4 runs; never fail the test for it.
    }
  }

  /**
   * Replace `target[name]` with a wrapper that records, then calls through.
   * Own symbol properties are carried over, so `util.promisify(exec)` keeps
   * resolving `{ stdout, stderr }` through `util.promisify.custom`.
   * @param {Record<string | symbol, unknown>} target - Module object
   * @param {string} name - Function name
   * @param {(...args: unknown[]) => void} before - Recorder
   * @returns {void}
   */
  const patchFs = (target, name, before) => {
    const originalFunction = target[name];
    if (typeof originalFunction !== "function") return;
    function traced(...args) {
      try {
        before(...args);
      } catch {
        // Recording must never change the call it observes.
      }
      return originalFunction.apply(this, args);
    }
    Object.getOwnPropertySymbols(originalFunction).forEach(symbol => {
      traced[symbol] = originalFunction[symbol];
    });
    target[name] = traced;
  };

  const readFirst = file => record(file);
  patchFs(fs, "readFileSync", readFirst);
  patchFs(fs, "readFile", readFirst);
  patchFs(fs, "createReadStream", readFirst);
  patchFs(fs.promises, "readFile", readFirst);
  patchFs(fs, "openSync", (file, flags) => {
    if (flags === undefined || String(flags).startsWith("r") || flags === 0)
      record(file);
  });

  const spawnLike = (command, args, options) =>
    Array.isArray(args)
      ? recordSpawn(command, args, options)
      : recordSpawn(command, [], args);
  ["spawn", "spawnSync", "execFile", "execFileSync", "fork"].forEach(name =>
    patchFs(childProcess, name, spawnLike)
  );
  ["exec", "execSync"].forEach(name =>
    patchFs(childProcess, name, (command, options) =>
      recordSpawn(shellWords(command)[0], shellWords(command).slice(1), options)
    )
  );
  module.syncBuiltinESMExports();

  if (typeof module.registerHooks === "function") {
    // A resolve hook only. A `load` hook moves `require` of CommonJS onto
    // the ESM loader on Node 22: `require.cache` disappears (ESLint's
    // eslint-comments plugin reads it) and CommonJS loaded through it fails
    // with ERR_INVALID_RETURN_PROPERTY_VALUE. Every load is resolved first,
    // so recording the resolved URL sees the same files.
    module.registerHooks({
      resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (resolved?.url?.startsWith("file:")) record(resolved.url);
        return resolved;
      },
    });
  }

  process.on("exit", flush);
  globalThis[TRACER_KEY] = { flush, record };
}

/**
 * A path-like value as a filesystem path, or undefined (file descriptors,
 * non-file URLs, anything else).
 * @param {unknown} target - Candidate
 * @returns {string | undefined} Path
 */
function toPath(target) {
  if (typeof target === "string")
    return target.startsWith("file:") ? fileURLToPath(target) : target;
  if (target instanceof URL)
    return target.protocol === "file:" ? fileURLToPath(target) : undefined;
  if (Buffer.isBuffer(target)) return target.toString();
  return undefined;
}
