#!/usr/bin/env node
/**
 * Generate the agy (Antigravity) variant of a Lisa plugin from the built
 * Claude artifact.
 *
 * agy's plugin manifest is a bare `plugin.json` at the plugin root (NOT
 * `.claude-plugin/plugin.json`). This generator copies + reshapes the artifact
 * AND emits a plugin-bundled hooks config.
 *
 * HOOKS (plugin-bundled, ROOT-level): a runtime probe of agy 1.0.3 (ticket-1054)
 * proved agy loads a plugin's hooks ONLY from a `hooks.json` at the plugin ROOT
 * of an installed global plugin (`~/.gemini/config/plugins/<variant>/hooks.json`)
 * — a `hooks/` SUBDIR hooks.json (the earlier attempt) is NOT scanned. Lisa
 * already `agy plugin install`s these variants there, so this generator emits a
 * root `hooks.json` in agy's schema (top-level HOOK NAME → event → handlers),
 * matcher `run_command` (agy's shell tool), and ships the agy-protocol script
 * into the variant's `hooks/` subdir (scripts in a subdir are fine — only
 * hooks.json must be at root; the command points at the absolute installed path
 * via `$HOME`). Only events agy supports map: PreToolUse / PostToolUse /
 * PreInvocation / PostInvocation / Stop. SessionStart is NOT supported, so
 * install-pkgs / setup-jira-cli CANNOT ship as agy hooks. Portable PreToolUse
 * guards map through thin agy-protocol adapters. Only the BASE plugin manifest carries the universal hooks,
 * so only `lisa-agy` gets a hooks.json; stack variants emit none.
 *
 * MCP (user-global, NOT plugin-bundled): agy ignores plugin-bundled MCP and only
 * reads the user-global `~/.gemini/config/mcp_config.json`, so MCP is delivered
 * by the runtime installer (`src/agy/mcp-installer.ts`), and this generator
 * drops `.mcp.json`. Rules remain out of agy artifacts; the runtime reconciles
 * only a bounded AGENTS.md project-learnings bridge.
 *
 * Net: the agy variant ships a root `hooks.json` (base only) + its agy-protocol
 * script under `hooks/`, but NO `mcp_config.json`, NO `.mcp.json`, NO `rules/`,
 * and NO `hooks/hooks.json` subdir. The manifest carries neither `hooks` nor
 * `mcpServers`.
 *
 * Usage: node scripts/generate-agy-plugin-artifacts.mjs <source-plugin-dir> <out-dir> <version>
 *
 * @module scripts/generate-agy-plugin-artifacts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nestCommandsUnderLisa } from "./lib/nest-plugin-commands.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const POLICY_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "internal-agy-skill-policy.json"
);

/**
 * Read the per-agent skill policy file.
 *
 * @returns {{ denylist?: string[] }}
 */
function readPolicy() {
  if (!fs.existsSync(POLICY_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Recursive directory copy with optional path-level filter.
 *
 * @param {string} src
 * @param {string} dst
 * @param {(relPath: string, stat: fs.Stats) => boolean} keep
 */
function copyDir(src, dst, keep = () => true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const srcPath = path.join(current, entry.name);
      const relPath = path.join(rel, entry.name);
      const dstPath = path.join(dst, relPath);
      const stat = fs.statSync(srcPath);
      if (!keep(relPath, stat)) continue;
      if (entry.isDirectory()) {
        fs.mkdirSync(dstPath, { recursive: true });
        walk(srcPath, relPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  };
  walk(src, "");
}

/**
 * Generate the agy variant.
 *
 * Transformation steps:
 *   0. Filter skills/ against scripts/internal-agy-skill-policy.json.
 *   1. Copy source to outDir minus filtered skills, .codex-plugin/, hooks/,
 *      rules/, and the untranslated .mcp.json.
 *   2. Move .claude-plugin/plugin.json to bare plugin.json at root; drop .claude-plugin/.
 *   3. Drop the hooks + mcpServers fields from the manifest (delivered by the
 *      root hooks.json / runtime MCP installer, not as manifest components).
 *   4. Inject the version.
 *   5. Emit the plugin-bundled root hooks.json (base variant only) + copy the
 *      agy-protocol script(s) into the variant's hooks/ subdir.
 *
 * @param {string} srcDir Built Claude plugin directory (input).
 * @param {string} outDir agy variant output directory.
 * @param {string} version Version string for the manifest.
 */
export function generateAgyVariant(srcDir, outDir, version) {
  const claudeManifest = path.join(srcDir, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(claudeManifest)) return;

  const policy = readPolicy();
  const denylist = new Set(policy.denylist ?? []);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Copy source minus structural strips.
  copyDir(srcDir, outDir, relPath => {
    // Strip directories that don't apply to agy.
    if (relPath.startsWith(".codex-plugin/") || relPath === ".codex-plugin") {
      return false;
    }
    // Drop the source hooks/ (Claude scripts + stale codex hooks.json). The agy
    // hooks.json (root) + the agy-protocol script are re-emitted by
    // emitAgyPluginHooks below.
    if (relPath.startsWith("hooks/") || relPath === "hooks") return false;
    if (relPath.startsWith("rules/") || relPath === "rules") return false; // no full rules tree in agy artifacts
    // Drop the untranslated Claude .mcp.json — agy ignores it (and the agy
    // MCP shape differs); MCP is delivered by the user-global runtime MCP installer.
    if (relPath === ".mcp.json") return false;
    // Drop Codex-specific per-skill openai.yaml artifacts.
    if (/^skills\/[^/]+\/agents\/openai\.ya?ml$/.test(relPath)) return false;
    // Apply skill denylist.
    const skillsPrefix = path.join("skills") + path.sep;
    if (relPath.startsWith(skillsPrefix)) {
      const skillName = relPath.slice(skillsPrefix.length).split(path.sep)[0];
      if (denylist.has(skillName)) return false;
    }
    // Skip the .claude-plugin manifest — we'll write a bare plugin.json instead.
    if (
      relPath === path.join(".claude-plugin", "plugin.json") ||
      relPath === ".claude-plugin"
    ) {
      return false;
    }
    return true;
  });

  // 1a. Remove any now-empty `skills/<n>/agents/` directories left by the openai.yaml strip.
  const skillsDir = path.join(outDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const skillName of fs.readdirSync(skillsDir)) {
      const agentsDir = path.join(skillsDir, skillName, "agents");
      if (fs.existsSync(agentsDir) && fs.readdirSync(agentsDir).length === 0) {
        fs.rmdirSync(agentsDir);
      }
    }
  }

  // 1b. Nest commands under commands/lisa/ — agy does not prefix plugin
  // commands with the plugin name, so the directory manufactures the /lisa:*
  // namespace that Claude gets from the plugin name alone.
  nestCommandsUnderLisa(outDir);

  // 2. Read the Claude manifest, drop hooks + mcpServers, write bare plugin.json.
  // agy reads hooks from a root hooks.json (emitted below), not the manifest;
  // MCP is user-global. So the bare manifest carries neither field.
  const manifest = JSON.parse(fs.readFileSync(claudeManifest, "utf8"));
  manifest.version = version;
  const sourceHooks = manifest.hooks ?? {};
  delete manifest.hooks;
  delete manifest.mcpServers;

  const bareManifestPath = path.join(outDir, "plugin.json");
  fs.writeFileSync(bareManifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // 3. Ensure no .claude-plugin/ directory survives.
  const ghostDir = path.join(outDir, ".claude-plugin");
  if (fs.existsSync(ghostDir)) {
    fs.rmSync(ghostDir, { recursive: true, force: true });
  }

  // 4. Emit the plugin-bundled root hooks.json + agy-protocol script (base only).
  // `agy plugin install` names the install dir by the manifest `name`
  // (`~/.gemini/config/plugins/<name>/`, verified-by-run per
  // reference_agy_plugin_capabilities), NOT the source dir basename — so the
  // hook command path must use manifest.name (e.g. "lisa"), falling back to the
  // dir basename only if a manifest somehow omits name.
  const installDirName = manifest.name ?? path.basename(outDir);
  emitAgyPluginHooks(srcDir, outDir, sourceHooks, installDirName);
}

/**
 * agy-portable hook map. Only events agy supports + scripts whose protocol has
 * an agy variant. Each entry emits one top-level hook-name key in the root
 * hooks.json. `sourceScript` is what the BASE Claude manifest references (used
 * to detect whether this variant should carry the hook); `agyScript` is the
 * agy-protocol script copied into the variant's hooks/ and referenced by the
 * command. NOTE: install-pkgs / setup-jira-cli are SessionStart-only, which agy
 * hooks don't support, so they are intentionally absent. inject-rules is absent
 * too (rules stay out of agy artifacts).
 */
const AGY_PLUGIN_HOOKS = [
  {
    sourceScript: "block-no-verify.sh",
    hookName: "lisa-block-no-verify",
    event: "PreToolUse",
    matcher: "run_command",
    agyScript: "block-no-verify.agy.sh",
    supportScripts: [],
  },
  {
    sourceScript: "parity-safety-net.sh",
    hookName: "lisa-parity-safety-net",
    event: "PreToolUse",
    matcher: "run_command",
    agyScript: "parity-safety-net.agy.sh",
    supportScripts: ["parity-safety-net.sh", "parity-safety-net-heredoc.py"],
  },
  {
    sourceScript: "block-shell-json-parsing.sh",
    hookName: "lisa-block-shell-json-parsing",
    event: "PreToolUse",
    matcher: "run_command",
    agyScript: "block-shell-json-parsing.agy.sh",
    supportScripts: ["block-shell-json-parsing.sh"],
  },
];

/**
 * Whether the source manifest hook block references `scriptName` anywhere. Used
 * to ship a hook only for the variant whose manifest carries it (the base
 * plugin); stack variants have empty manifest hooks and emit no hooks.json.
 * @param {Record<string, Array<{ hooks?: Array<{ command?: string }> }>>} sourceHooks
 * @param {string} scriptName
 * @returns {boolean}
 */
function sourceReferencesScript(sourceHooks, scriptName) {
  return Object.values(sourceHooks ?? {}).some(
    entries =>
      Array.isArray(entries) &&
      entries.some(
        e =>
          Array.isArray(e?.hooks) &&
          e.hooks.some(
            h =>
              typeof h?.command === "string" && h.command.includes(scriptName)
          )
      )
  );
}

/**
 * Emit the plugin-bundled root `hooks.json` (agy schema) and copy the
 * agy-protocol script(s) into the variant's `hooks/` subdir. No-op for variants
 * whose source manifest carries none of the mapped hooks (e.g. stack variants).
 * @param {string} srcDir Built Claude plugin directory (input).
 * @param {string} outDir agy variant output directory.
 * @param {Record<string, unknown>} sourceHooks Source manifest hook block.
 * @param {string} installDirName Name agy installs the plugin under in
 *   `~/.gemini/config/plugins/<installDirName>/` (the manifest `name`); baked
 *   into the hook command path so it resolves to the installed script.
 * @returns {void}
 */
function emitAgyPluginHooks(srcDir, outDir, sourceHooks, installDirName) {
  const applicable = AGY_PLUGIN_HOOKS.filter(h => {
    if (!sourceReferencesScript(sourceHooks, h.sourceScript)) return false;
    for (const script of [h.agyScript, ...(h.supportScripts ?? [])]) {
      const scriptSource = path.join(srcDir, "hooks", script);
      if (!fs.existsSync(scriptSource)) {
        throw new Error(
          `Missing agy hook script for ${h.sourceScript}: ${scriptSource}`
        );
      }
    }
    return true;
  });
  if (applicable.length === 0) return;

  const hooksConfig = Object.fromEntries(
    applicable.map(h => [
      h.hookName,
      {
        [h.event]: [
          {
            matcher: h.matcher,
            hooks: [
              {
                type: "command",
                command: `bash "$HOME/.gemini/config/plugins/${installDirName}/hooks/${h.agyScript}"`,
              },
            ],
          },
        ],
      },
    ])
  );
  fs.writeFileSync(
    path.join(outDir, "hooks.json"),
    JSON.stringify(hooksConfig, null, 2) + "\n"
  );

  // Copy the agy-protocol scripts into the variant's hooks/ subdir.
  const hooksDir = path.join(outDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const scripts = new Set(
    applicable.flatMap(h => [h.agyScript, ...(h.supportScripts ?? [])])
  );
  for (const script of scripts) {
    const scriptSource = path.join(srcDir, "hooks", script);
    const scriptDest = path.join(hooksDir, script);
    fs.copyFileSync(scriptSource, scriptDest);
    fs.chmodSync(scriptDest, 0o755);
  }
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [srcDir, outDir, version] = process.argv.slice(2);
  if (!srcDir || !outDir || !version) {
    console.error(
      "Usage: generate-agy-plugin-artifacts.mjs <src> <out> <version>"
    );
    process.exit(1);
  }
  generateAgyVariant(srcDir, outDir, version);
  console.log(`Generated agy variant at ${outDir} (v${version})`);
}
