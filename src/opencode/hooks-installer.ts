/**
 * Install Lisa-managed OpenCode hooks into a host project.
 *
 * Unlike Codex (which drives every hook through shell scripts wired into
 * `.codex/hooks.json`), OpenCode is mapped to its NATIVE surfaces first, then
 * falls back to runtime plugins only where genuine behavior is required:
 *
 *   - block-no-verify → a `tool.execute.before` plugin running the canonical
 *     `block-no-verify.sh`, with the `permission.bash` deny globs kept beneath
 *     it as a floor. The globs alone were a SPELLING filter: they matched
 *     `--no-verify` and two `git commit -n` prefixes and missed `--no-veri`,
 *     which git resolves to the same option. Whether a token is an option or
 *     merely contains one's text is a question only a tokenizer can answer, so
 *     the semantic guard is the plugin and the globs are what survives if the
 *     plugin fails to load.
 *   - format-on-edit → OpenCode's BUILT-IN prettier formatter already formats on
 *     edit, so Lisa emits no formatter config (overriding it would be worse than
 *     the default). This is why there is no format plugin below.
 *   - inject-rules → OpenCode has no SessionStart additional-context hook like
 *     Codex, so Lisa mirrors eager rules into `.opencode/lisa-rules/` and merges
 *     those files into `opencode.json` `instructions`.
 *   - everything that needs runtime behavior (blocking suppression directives /
 *     migration edits, linting / scanning just-edited files, session bootstrap)
 *     → a `.opencode/plugin/lisa-*.ts` module. OpenCode loads project plugins
 *     and fires their `tool.execute.before` / `tool.execute.after` hooks under
 *     `opencode run` headless (verified-by-run; unlike agy / Copilot).
 *
 * The plugin templates live in `src/opencode/plugin-templates/` and are copied
 * verbatim into the host's `.opencode/plugin/`. Stack-specific plugins are gated
 * by `forProjectTypes` so they ship only when the relevant project type is
 * detected, exactly like the Codex hook catalog.
 * @module opencode/hooks-installer
 */
import * as fse from "fs-extra";
import { copyFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type ParseError,
} from "jsonc-parser";
import type { ProjectType } from "../core/config.js";
import { PLUGIN_CATALOG, type PluginCatalogEntry } from "./plugin-catalog.js";
import { mirrorLisaRules } from "../core/lisa-rules-mirror.js";
import { OPENCODE_CONFIG_DIR } from "./manifest.js";
import { OPENCODE_SCHEMA_URL } from "./settings-installer.js";
import { resolveSupportFile } from "./support-file-resolver.js";

/** Subdirectory inside `.opencode/` where OpenCode discovers project plugins */
export const OPENCODE_PLUGIN_SUBDIR = "plugin";

/** Filename of the OpenCode project config merged at the host root */
export const OPENCODE_CONFIG_FILENAME = "opencode.json";

/** Prefix every Lisa-managed plugin filename carries (used for stale cleanup) */
const LISA_PLUGIN_PREFIX = "lisa-";

/** Subdirectory inside `.opencode/` for Lisa rule instruction files. */
export const OPENCODE_LISA_RULES_SUBDIR = "lisa-rules";

/** OpenCode instruction glob that loads Lisa eager rules every session. */
export const OPENCODE_EAGER_RULES_INSTRUCTION = `${OPENCODE_CONFIG_DIR}/${OPENCODE_LISA_RULES_SUBDIR}/eager/*.md`;

/**
 * `permission.bash` deny patterns that back up Lisa's `block-no-verify` guard.
 * Each glob is matched against the parsed shell command; `*` matches any run of
 * characters. Deny-only (no catch-all allow) so non-matching commands fall
 * through to the host's / OpenCode's default posture.
 *
 * A FLOOR, and no longer the guard. The premise this list was written under —
 * "OpenCode gives Lisa a glob list, not a hook it can tokenize" — is false:
 * `tool.execute.before` fires for the `bash` tool under `opencode run` and a
 * throw cancels the call, which is what `lisa-block-no-verify.ts` now uses to
 * run the same tokenizing script Claude, Codex, Cursor and Copilot run.
 *
 * What a glob list cannot do is separate a token that IS an option from a token
 * that merely contains one's text, and that limit runs in both directions.
 * `git commit --no-veri` is an abbreviation git accepts and no glob here
 * matches, and no addition fixes the class, because which abbreviations git
 * accepts is a property of git's parser; `git commit -am wip -n` reaches `-n`
 * late on the line and cannot be matched without a glob broad enough to refuse
 * `grep -n`. In the other direction these globs are too eager: `*--no-verify*`
 * fires on the flag quoted inside a commit message, which the tokenizing guard
 * correctly allows.
 *
 * Both costs are accepted rather than removed. A guard that is silently absent
 * reads exactly like a guard that is passing, so if the plugin fails to load —
 * a Bun transpile error, a run that skips project plugins — the literal
 * spellings are still refused here. A reworded commit message is a cheaper
 * failure than an unguarded `--no-verify`.
 */
const NO_VERIFY_DENY_PATTERNS: Readonly<Record<string, "deny">> = {
  "*--no-verify*": "deny",
  "*git commit -n*": "deny",
  "*git commit -an*": "deny",
  "*HUSKY=0*": "deny",
  "*HUSKY_SKIP_HOOKS=*": "deny",
  "*core.hooksPath*/dev/null*": "deny",
};

/**
 * Canonical policy files used by universal OpenCode adapters.
 *
 * Kept in step with `canonicalSupportFiles` in
 * `scripts/copy-opencode-plugin-templates.mjs`, which stages the same list into
 * `dist/` for the packaged installer. A file listed here and not there resolves
 * in a source checkout and is missing from every installed copy.
 */
const PLUGIN_SUPPORT_FILES = [
  "block-no-verify.sh",
  "parity-safety-net.sh",
  "parity-safety-net-heredoc.py",
] as const;

/** Result of the OpenCode hooks install pass */
export interface OpencodeHooksInstallResult {
  /** Files written, relative to `.opencode/` (added to the manifest). */
  readonly managedFiles: readonly string[];
  /** Number of plugin templates emitted into `.opencode/plugin/`. */
  readonly pluginCount: number;
  /** Whether `opencode.json` was created (vs merged into an existing file). */
  readonly configCreated: boolean;
  /** Stale Lisa plugin files removed because they're no longer shipped. */
  readonly deleted: readonly string[];
}

/**
 * Install Lisa's OpenCode hooks: merge `permission.bash` deny rules into
 * `opencode.json`, mirror Lisa rule files for `instructions`, and emit the
 * applicable `.opencode/plugin/lisa-*.ts` modules.
 * @param lisaDir - Absolute path to the Lisa repo root or installed package.
 *
 * `opencode.json` lives at the host ROOT (outside `.opencode/`), is a shared
 * merged file, and is intentionally NOT returned in `managedFiles` — the
 * `.opencode/`-relative manifest never deletes it. Plugin files under
 * `.opencode/plugin/` ARE tracked so renames clean up stale modules.
 * @param destDir - Absolute path to the host project root.
 * @param detectedTypes - Project types Lisa detected; gates stack-specific
 *   plugins. Universal plugins/config install regardless.
 * @param previousManagedFiles - Files Lisa managed last run (relative to
 *   `.opencode/`); used to detect stale plugin modules.
 * @returns Result describing what was written + removed.
 */
export async function installHooks(
  lisaDir: string,
  destDir: string,
  detectedTypes: readonly ProjectType[],
  previousManagedFiles: readonly string[]
): Promise<OpencodeHooksInstallResult> {
  const configCreated = await mergeOpencodeConfig(destDir);

  const rulesDir = path.join(
    destDir,
    OPENCODE_CONFIG_DIR,
    OPENCODE_LISA_RULES_SUBDIR
  );
  await fse.ensureDir(rulesDir);
  const ruleFiles = (
    await mirrorLisaRules(lisaDir, rulesDir, detectedTypes)
  ).map(file => path.join(OPENCODE_LISA_RULES_SUBDIR, file));

  const pluginDir = path.join(
    destDir,
    OPENCODE_CONFIG_DIR,
    OPENCODE_PLUGIN_SUBDIR
  );
  await fse.ensureDir(pluginDir);

  const applicable = filterCatalogByTypes(detectedTypes);
  const managedPlugins = await Promise.all(
    applicable.map(async entry => {
      const source = resolveTemplate(entry.templateFilename);
      const dest = path.join(pluginDir, entry.templateFilename);
      await copyFile(source, dest);
      return path.join(OPENCODE_PLUGIN_SUBDIR, entry.templateFilename);
    })
  );
  const managedSupportFiles = await Promise.all(
    PLUGIN_SUPPORT_FILES.map(async filename => {
      const source = resolveSupportFile(import.meta.url, filename);
      const dest = path.join(pluginDir, filename);
      await copyFile(source, dest);
      return path.join(OPENCODE_PLUGIN_SUBDIR, filename);
    })
  );

  const currentFilenames = new Set(
    applicable.map(entry => entry.templateFilename)
  );
  const deleted = await deleteStalePlugins(
    previousManagedFiles,
    currentFilenames,
    destDir
  );

  return {
    managedFiles: Object.freeze([
      ...managedPlugins,
      ...managedSupportFiles,
      ...ruleFiles,
    ]),
    pluginCount: applicable.length,
    configCreated,
    deleted,
  };
}

/**
 * Filter the catalog by detected project types. Universal plugins (`"*"`)
 * always pass; stack-specific plugins pass only if their type is detected.
 * @param detectedTypes - Project types Lisa detected for the host.
 * @returns The catalog entries that apply to this host.
 */
function filterCatalogByTypes(
  detectedTypes: readonly ProjectType[]
): readonly PluginCatalogEntry[] {
  const detectedSet = new Set<string>(detectedTypes);
  return PLUGIN_CATALOG.filter(entry =>
    entry.forProjectTypes.some(t => t === "*" || detectedSet.has(t))
  );
}

/**
 * Resolve a bundled plugin template path. Templates ship alongside the compiled
 * installer at `dist/opencode/plugin-templates/<name>` (copied there by
 * `scripts/copy-opencode-plugin-templates.mjs`).
 * @param filename - Template filename (e.g. "lisa-lint-on-edit.ts").
 * @returns Absolute path to the bundled template.
 */
function resolveTemplate(filename: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(moduleDir, "plugin-templates", filename);
}

/**
 * Delete Lisa plugin modules that were managed last run but aren't shipped this
 * run (e.g. a project type stopped being detected, or a template was renamed).
 * Only files under `.opencode/plugin/` with the `lisa-` prefix are eligible, so
 * host-authored plugins are never touched.
 * @param previousManagedFiles - Files Lisa managed last run (relative to
 *   `.opencode/`).
 * @param currentFilenames - Plugin filenames Lisa is shipping this run.
 * @param destDir - Absolute path to the host project root.
 * @returns Sorted list of stale plugin filenames that were deleted.
 */
async function deleteStalePlugins(
  previousManagedFiles: readonly string[],
  currentFilenames: ReadonlySet<string>,
  destDir: string
): Promise<readonly string[]> {
  const prefix = `${OPENCODE_PLUGIN_SUBDIR}${path.sep}`;
  const stale = previousManagedFiles
    .filter(file => file.startsWith(prefix))
    .map(file => file.slice(prefix.length))
    .filter(
      name =>
        name.startsWith(LISA_PLUGIN_PREFIX) &&
        !name.includes(path.sep) &&
        !currentFilenames.has(name)
    );
  await Promise.all(
    stale.map(async name => {
      const absPath = path.join(
        destDir,
        OPENCODE_CONFIG_DIR,
        OPENCODE_PLUGIN_SUBDIR,
        name
      );
      if (await fse.pathExists(absPath)) {
        await rm(absPath, { force: true });
      }
    })
  );
  return Object.freeze([...new Set(stale)].sort((a, b) => a.localeCompare(b)));
}

/** JSONC edit formatting — 2-space indent, matching the repo's JSON style. */
const FORMATTING_OPTIONS = {
  formattingOptions: { tabSize: 2, insertSpaces: true },
} as const;

/**
 * Merge Lisa's `permission.bash` deny rules and eager-rules instruction glob
 * into the host's `opencode.json`, preserving every other key, comment, and
 * formatting choice. Creates the file (with `$schema`) when absent.
 *
 * Edits the document surgically via `jsonc-parser` — the same host-preserving
 * approach the sibling OpenCode settings/MCP installers use, so the three
 * writers compose into one `opencode.json` without clobbering each other or a
 * host's JSONC comments.
 * @param destDir - Absolute path to the host project root.
 * @returns Whether the config file was created (vs merged into an existing one).
 */
async function mergeOpencodeConfig(destDir: string): Promise<boolean> {
  const configPath = path.join(destDir, OPENCODE_CONFIG_FILENAME);
  const exists = await fse.pathExists(configPath);
  const existing = exists ? await readFile(configPath, "utf8") : "";
  await writeFile(configPath, mergeNoVerifyDenyRules(existing), "utf8");
  return !exists;
}

/**
 * Merge the `block-no-verify` deny globs into an `opencode.json` (JSONC) body.
 * Pure function for testability; `mergeOpencodeConfig` is the I/O wrapper.
 *
 * Empty input yields a clean Lisa-authored document. A host `permission.bash`
 * set to a bare string (e.g. `"allow"`) is re-seeded as a `{ "*": <string> }`
 * catch-all so the host's posture survives alongside the deny rules. Otherwise
 * each deny glob is added as its own key, preserving host bash patterns. `$schema`
 * is set only when absent. Throws on invalid JSONC so a corrupt host file is
 * surfaced, not silently overwritten.
 * @param existingJsonc - Current contents of `opencode.json` (or "").
 * @returns Merged JSON/JSONC string with host content preserved.
 */
export function mergeNoVerifyDenyRules(existingJsonc: string): string {
  if (existingJsonc.trim().length === 0) {
    const fresh = {
      $schema: OPENCODE_SCHEMA_URL,
      permission: { bash: { ...NO_VERIFY_DENY_PATTERNS } },
      instructions: [OPENCODE_EAGER_RULES_INSTRUCTION],
    };
    return `${JSON.stringify(fresh, null, 2)}\n`;
  }

  const current = parseJsoncOrThrow(existingJsonc);
  const permission = isPlainObject(current["permission"])
    ? current["permission"]
    : {};
  const existingBash = permission["bash"];

  const withBash =
    typeof existingBash === "string"
      ? // Replace the whole string posture with an object that keeps it as the
        // catch-all and adds the deny globs.
        upsertKey(
          existingJsonc,
          ["permission", "bash"],
          { "*": existingBash, ...NO_VERIFY_DENY_PATTERNS },
          undefined
        )
      : addDenyGlobs(
          existingJsonc,
          isPlainObject(existingBash) ? existingBash : undefined
        );

  const withSchema =
    current["$schema"] === undefined
      ? upsertKey(withBash, ["$schema"], OPENCODE_SCHEMA_URL, undefined)
      : withBash;

  const withInstructions = addLisaRuleInstructions(withSchema);

  return withInstructions.endsWith("\n")
    ? withInstructions
    : `${withInstructions}\n`;
}

/**
 * Add Lisa eager rules to OpenCode's native `instructions` array.
 * @param text - Current document text.
 * @returns The edited document text.
 */
function addLisaRuleInstructions(text: string): string {
  const current = parseJsoncOrThrow(text);
  const instructions = current["instructions"];
  const nextInstructions = Array.isArray(instructions)
    ? instructions.includes(OPENCODE_EAGER_RULES_INSTRUCTION)
      ? undefined
      : [...instructions, OPENCODE_EAGER_RULES_INSTRUCTION]
    : [OPENCODE_EAGER_RULES_INSTRUCTION];
  return nextInstructions === undefined
    ? text
    : upsertKey(text, ["instructions"], nextInstructions, instructions);
}

/**
 * Add each deny glob under `permission.bash` as an individual key, preserving
 * any host bash patterns (and their comments) already present.
 * @param text - Current document text.
 * @param currentBash - The host's `permission.bash` object, if any.
 * @returns The edited document text.
 */
function addDenyGlobs(
  text: string,
  currentBash: Record<string, unknown> | undefined
): string {
  return Object.entries(NO_VERIFY_DENY_PATTERNS).reduce(
    (acc, [pattern, value]) =>
      upsertKey(
        acc,
        ["permission", "bash", pattern],
        value,
        currentBash?.[pattern]
      ),
    text
  );
}

/**
 * Set `value` at `keyPath` via a surgical JSONC edit, skipping the write when
 * the document already holds that value (keeps re-runs no-op-clean).
 * @param text - Current document text.
 * @param keyPath - JSON path to the key.
 * @param value - Value to set.
 * @param currentValue - The value already present at `keyPath` (or undefined).
 * @returns The edited document text.
 */
function upsertKey(
  text: string,
  keyPath: readonly (string | number)[],
  value: unknown,
  currentValue: unknown
): string {
  if (currentValue === value) {
    return text;
  }
  const edits = modify(text, [...keyPath], value, FORMATTING_OPTIONS);
  return applyEdits(text, edits);
}

/**
 * Parse JSONC, throwing on the first syntax error so a corrupt host config is
 * surfaced rather than silently clobbered. Comments and trailing commas are
 * tolerated (OpenCode permits both).
 * @param jsonc - Raw `opencode.json` contents.
 * @returns The parsed object (empty object if the root is a non-object).
 */
function parseJsoncOrThrow(jsonc: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(jsonc, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    throw new Error(
      `Invalid ${OPENCODE_CONFIG_FILENAME} (JSONC syntax error at offset ${
        errors[0]?.offset ?? 0
      }); refusing to overwrite host config`
    );
  }
  return isPlainObject(parsed) ? parsed : {};
}

/**
 * Narrow an unknown value to a plain (non-array, non-null) object record.
 * @param value - The value to test.
 * @returns Whether `value` is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Enumerate the Lisa plugin filenames currently present in a host's
 * `.opencode/plugin/` directory. Exposed for tests/diagnostics.
 * @param destDir - Absolute path to the host project root.
 * @returns Sorted list of `lisa-*.ts` filenames (empty if the dir is absent).
 */
export async function listInstalledPluginFiles(
  destDir: string
): Promise<readonly string[]> {
  const pluginDir = path.join(
    destDir,
    OPENCODE_CONFIG_DIR,
    OPENCODE_PLUGIN_SUBDIR
  );
  if (!(await fse.pathExists(pluginDir))) {
    return [];
  }
  const entries = await readdir(pluginDir);
  return entries
    .filter(name => name.startsWith(LISA_PLUGIN_PREFIX) && name.endsWith(".ts"))
    .sort((a, b) => a.localeCompare(b));
}
