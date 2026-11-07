#!/usr/bin/env node
/**
 * Retire only hash-proven Lisa safety-net handlers. Old registrations stay
 * callable, including commands captured by an already running agent. Never
 * disable the enclosing Lisa plugin or rewrite an operator's settings.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  lstatSync,
  openSync,
  closeSync,
  chmodSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(
    new URL("./lib/retired-safety-net-manifest.json", import.meta.url),
    "utf8"
  )
);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

/**
 * Known installed plugin containers, never arbitrary registry installPaths.
 * Walks do not follow symlinks into source checkouts or other user directories.
 * Global Lisa plugin copies must also retire: they can serve many projects.
 * @param {NodeJS.ProcessEnv} [env] Runtime configuration
 * @returns {string[]} Container roots
 */
export function installedPluginRoots(env = process.env) {
  const home = homedir();
  return [
    path.join(
      env.CLAUDE_CODE_PLUGIN_CACHE_DIR ||
        path.join(
          env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
          "plugins"
        ),
      "cache"
    ),
    path.join(env.CODEX_HOME || path.join(home, ".codex"), "plugins/cache"),
    path.join(home, ".cursor/plugins/cache"),
    path.join(home, ".cursor/plugins/local"),
    path.join(home, ".gemini/config/plugins"),
    path.join(home, ".copilot/installed-plugins"),
    path.join(
      env.XDG_CONFIG_HOME || path.join(home, ".config"),
      "devin/plugins"
    ),
  ];
}

/**
 * Inspect a path without treating inaccessible data as an absent installation.
 * @param {string} file Candidate path
 * @returns {import('node:fs').Stats|undefined} Stat if present
 */
function stat(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Refuse symlink ancestors: renaming through them would edit another checkout.
 * @param {string} file Absolute path
 * @returns {boolean} Whether all existing components are literal
 */
function literalPath(file) {
  const parent = path.dirname(file);
  if (parent !== file && !literalPath(parent)) return false;
  return stat(file)?.isSymbolicLink() !== true;
}

/**
 * Select exact target filenames under bounded plugin trees, preserving all else.
 * @param {string} root Container or project handler directory
 * @param {number} depth Remaining nesting budget
 * @returns {string[]} Existing regular target handlers
 */
function findHandlers(root, depth = 7) {
  const info = stat(root);
  if (!info?.isDirectory() || !literalPath(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    if (entry.isFile() && Object.hasOwn(manifest, entry.name)) return [file];
    return depth > 0 && entry.isDirectory()
      ? findHandlers(file, depth - 1)
      : [];
  });
}

/**
 * Replace an owned target atomically, breaking cache hardlinks instead of
 * changing their shared inode. Revalidate the read image immediately before
 * rename. A custom or concurrently changed copy is preserved and reported.
 * @param {string} file Target handler
 * @param {boolean} dryRun Report without writes
 * @returns {{path:string,status:string}} Per-handler result
 */
function retireHandler(file, dryRun) {
  const entry = manifest[path.basename(file)];
  const before = stat(file);
  if (!before?.isFile() || !literalPath(file))
    return { path: file, status: "preserved-nonliteral" };
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    bytes = readFileSync(fd);
  } finally {
    closeSync(fd);
  }
  if (bytes.equals(Buffer.from(entry.shim)))
    return { path: file, status: "already-retired" };
  if (!entry.hashes.includes(sha(bytes)))
    return { path: file, status: "preserved-custom" };
  if (dryRun) return { path: file, status: "would-retire" };
  const temporary = path.join(
    path.dirname(file),
    `.lisa-retire-${randomUUID()}`
  );
  try {
    writeFileSync(temporary, entry.shim, {
      flag: "wx",
      mode: before.mode & 0o777,
    });
    chmodSync(temporary, before.mode & 0o777);
    const current = stat(file);
    if (
      !literalPath(file) ||
      current?.ino !== before.ino ||
      current?.dev !== before.dev ||
      !readFileSync(file).equals(bytes)
    ) {
      throw new Error(
        `Safety-net retirement preserved a concurrently changed handler: ${file}`
      );
    }
    renameSync(temporary, file);
  } finally {
    if (stat(temporary)) unlinkSync(temporary);
  }
  return { path: file, status: "retired" };
}

/**
 * Reconcile existing target handlers; no template apply or evidence writes.
 * @param {{projectDir:string,dryRun?:boolean,pluginRoots?:readonly string[]}} options Scope
 * @returns {{path:string,status:string}[]} Exact decisions
 */
export function retireNativeSafetyNet({
  projectDir,
  dryRun = false,
  pluginRoots = [],
}) {
  const root = realpathSync(projectDir);
  const local = [
    "scripts/lisa-hooks",
    ".claude",
    ".codex",
    ".devin",
    ".cursor",
    ".opencode",
    ".agents/plugins",
    ".github/plugins",
    "plugins",
  ];
  const handlers = [
    ...new Set(
      [...local.map(dir => path.join(root, dir)), ...pluginRoots].flatMap(dir =>
        findHandlers(dir)
      )
    ),
  ].sort();
  return handlers.map(file => retireHandler(file, dryRun));
}

if (invokedAsScript(import.meta.url)) {
  const args = process.argv.slice(2);
  const supported = new Set(["--install", "--dry-run", "--json"]);
  for (const argument of args.filter(value => value.startsWith("--"))) {
    if (!supported.delete(argument))
      throw new Error(`Unknown or duplicate retirement option: ${argument}`);
  }
  const destinations = args.filter(value => !value.startsWith("--"));
  if (destinations.length > 1)
    throw new Error("Retirement accepts exactly one project destination");
  const dependency = packageRoot.endsWith(
    path.join(path.sep, "node_modules", "@codyswann", "lisa")
  );
  const virtualStore = path.join(path.sep, "node_modules", ".pnpm") + path.sep;
  const installRoot = packageRoot.includes(virtualStore)
    ? packageRoot.split(virtualStore)[0]
    : dependency
      ? path.resolve(packageRoot, "../../..")
      : packageRoot;
  const projectDir = path.resolve(
    destinations[0] ||
      (args.includes("--install") ? installRoot : process.cwd())
  );
  // Source-repository dependency installation is not a downstream update.
  // Explicit apply reuses this reconciler after copying its target templates.
  const selfInstall = args.includes("--install") && projectDir === packageRoot;
  const decisions = selfInstall
    ? []
    : retireNativeSafetyNet({
        projectDir,
        dryRun: args.includes("--dry-run"),
        // A source checkout's build/test/apply is not a dependency update. Only
        // an installed dependency reconciles its independent installed copies.
        pluginRoots: dependency ? installedPluginRoots() : [],
      });
  if (args.includes("--json")) console.log(JSON.stringify(decisions));
  else
    for (const decision of decisions) {
      if (decision.status !== "already-retired")
        console.log(`lisa: safety-net ${decision.status}: ${decision.path}`);
    }
}
