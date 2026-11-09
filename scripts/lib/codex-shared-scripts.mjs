/**
 * Emit the shared plugin scripts that Codex skill scripts import
 * (CodySwannGT/lisa#4730).
 *
 * Codex loads a plugin's skills from `.codex-plugin/skills/`, a copy of the
 * plugin's authored `skills/`. Skill scripts reach shared modules with
 * `../../../scripts/<m>.mjs`, which from the authored tree lands on the
 * plugin's own `scripts/` but from the Codex copy lands on
 * `.codex-plugin/scripts/`. This module follows every relative import of every
 * emitted skill module, transitively, and copies each target that falls
 * outside `.codex-plugin/skills/` from `<plugin>/<rel>` to
 * `<plugin>/.codex-plugin/<rel>` — the place the unchanged specifier resolves.
 * Specifiers are never rewritten, so the Claude tree and the Codex tree run
 * byte-identical skill scripts.
 *
 * The specifier parse mirrors `src/opencode/relative-imports.ts` (a `.mjs`
 * build script cannot import TypeScript); the guard test uses that TypeScript
 * checker as an independent oracle over what this module emits.
 * @module scripts/lib/codex-shared-scripts
 */
import fs from "node:fs";
import path from "node:path";

const CODEX_PLUGIN_DIR = ".codex-plugin";
const SCRIPT_MODULE_EXTENSIONS = new Set([".mjs", ".js", ".cjs"]);
const RELATIVE_SPECIFIER_PATTERN =
  /\b(?:from|import\(?|require\()\s*(["'])(\.\.?\/[^"'\n]*)\1/g;
const LINE_OPENING_BLOCK_COMMENT = /^[ \t]*\/\*[\s\S]*?\*\//gm;
const LINE_OPENING_LINE_COMMENT = /^[ \t]*\/\/.*$/gm;

/**
 * Extract every static relative specifier from module source text. Exported
 * so a parity test can hold it equal to the TypeScript checker's parse.
 * @param {string} source JavaScript module source.
 * @returns {string[]} Unique relative specifiers in first-seen order.
 */
export function extractRelativeSpecifiers(source) {
  const stripped = source
    .replace(LINE_OPENING_BLOCK_COMMENT, "")
    .replace(LINE_OPENING_LINE_COMMENT, "");
  const specifiers = Array.from(
    stripped.matchAll(RELATIVE_SPECIFIER_PATTERN),
    match => match[2]
  );
  return [...new Set(specifiers)];
}

/**
 * Predicate: is `candidate` the directory `root` or somewhere beneath it?
 * @param {string} root Absolute directory.
 * @param {string} candidate Absolute path.
 * @returns {boolean} True when `candidate` does not escape `root`.
 */
function isWithin(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * List every script module beneath a directory, sorted for determinism.
 * @param {string} dir Absolute directory.
 * @returns {string[]} Absolute module paths.
 */
function listScriptModules(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() && SCRIPT_MODULE_EXTENSIONS.has(path.extname(entry.name))
    )
    .map(entry => path.join(entry.parentPath, entry.name))
    .sort();
}

/**
 * Resolve the shared targets one emitted module imports. A target outside
 * `.codex-plugin/skills/` must lie inside `.codex-plugin/scripts/`: that is
 * the only directory this step clears, so it is the only one it may write —
 * it can never overwrite `hooks.json`, `plugin.json`, or anything else.
 * @param {string} codexDir Absolute `.codex-plugin/` directory.
 * @param {string} importer Absolute emitted module path.
 * @returns {{ specifier: string, target: string }[]} Imports whose absolute
 *   target lies inside `.codex-plugin/scripts/`.
 */
function sharedTargetsOf(codexDir, importer) {
  const skillsDir = path.join(codexDir, "skills");
  const scriptsDir = path.join(codexDir, "scripts");
  return extractRelativeSpecifiers(fs.readFileSync(importer, "utf8"))
    .map(specifier => ({
      specifier,
      target: path.resolve(path.dirname(importer), specifier),
    }))
    .filter(({ specifier, target }) => {
      if (isWithin(skillsDir, target)) return false;
      if (!isWithin(scriptsDir, target)) {
        throw new Error(
          `${path.relative(codexDir, importer)} imports "${specifier}", which resolves outside ${CODEX_PLUGIN_DIR}/scripts/ and cannot be emitted`
        );
      }
      return true;
    });
}

/**
 * Copy one shared module from the plugin root into `.codex-plugin/`.
 * @param {string} pluginDir Built plugin directory.
 * @param {string} codexDir Absolute `.codex-plugin/` directory.
 * @param {string} importer Absolute module that imports `target`.
 * @param {{ specifier: string, target: string }} edge The import being emitted.
 */
function copySharedModule(
  pluginDir,
  codexDir,
  importer,
  { specifier, target }
) {
  const rel = path.relative(codexDir, target);
  const source = path.join(pluginDir, rel);
  if (!fs.existsSync(source)) {
    throw new Error(
      `${path.relative(codexDir, importer)} imports "${specifier}", but its source ${rel} does not exist in the plugin`
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

/**
 * Emit every shared module the plugin's Codex skill scripts import,
 * transitively, into `<plugin>/.codex-plugin/`. Must run after the skill
 * variants are emitted. Stale emitted shared modules are removed first.
 * @param {string} pluginDir Built plugin directory.
 * @returns {string[]} Emitted paths relative to `.codex-plugin/`, sorted.
 */
export function emitCodexSharedScripts(pluginDir) {
  const codexDir = path.join(pluginDir, CODEX_PLUGIN_DIR);
  fs.rmSync(path.join(codexDir, "scripts"), { force: true, recursive: true });
  const emitted = new Set();
  const pending = listScriptModules(path.join(codexDir, "skills"));
  while (pending.length > 0) {
    const importer = pending.shift();
    for (const edge of sharedTargetsOf(codexDir, importer)) {
      const { target } = edge;
      if (emitted.has(target)) continue;
      copySharedModule(pluginDir, codexDir, importer, edge);
      emitted.add(target);
      if (SCRIPT_MODULE_EXTENSIONS.has(path.extname(target))) {
        pending.push(target);
      }
    }
  }
  return [...emitted]
    .map(target => path.relative(codexDir, target).split(path.sep).join("/"))
    .sort();
}
