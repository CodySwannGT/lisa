#!/usr/bin/env node
/**
 * Generate the agy (Antigravity) variant of a Lisa plugin from the built
 * Claude artifact.
 *
 * agy's plugin manifest is a bare `plugin.json` at the plugin root (NOT
 * `.claude-plugin/plugin.json`). The Wave 1 audit also established that agy
 * plugin-bundled hooks DO NOT FIRE in `-p` headless mode, so the agy variant
 * ships no hooks at all — the manifest's `hooks` field is dropped and the
 * `hooks/` directory is omitted. Rules-injection for agy uses the AGENTS.md
 * bake-in alternative implemented in `src/agy/rules-bake.ts` (per the parity
 * research artifact's Cluster 4-agy / Option α).
 *
 * Usage: node scripts/generate-agy-plugin-artifacts.mjs <source-plugin-dir> <out-dir> <version>
 *
 * @module scripts/generate-agy-plugin-artifacts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * Transformation steps (from Wave 2 pattern-b-fan-out-spec.md):
 *   0. Filter skills/ against scripts/internal-agy-skill-policy.json.
 *   1. Copy source to outDir minus filtered skills, .codex-plugin/, hooks/, and rules/.
 *   2. Move .claude-plugin/plugin.json to bare plugin.json at root; drop .claude-plugin/.
 *   3. Drop the hooks field from the manifest (agy plugin hooks don't fire in -p).
 *   4. Inject the version.
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
    if (relPath.startsWith("hooks/") || relPath === "hooks") return false; // hooks don't fire on agy
    if (relPath.startsWith("rules/") || relPath === "rules") return false; // rules not a plugin component on agy
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

  // 2. Read the Claude manifest, drop hooks, rename to bare plugin.json.
  const manifest = JSON.parse(fs.readFileSync(claudeManifest, "utf8"));
  manifest.version = version;
  delete manifest.hooks;

  // 3. Drop any pointer fields that agy doesn't understand.
  // agy reads bare plugin.json with components: skills, agents, commands,
  // mcpServers, hooks. We omit hooks above. MCP is not a plugin component on
  // agy, so drop any `mcpServers` if present (Lisa's base today does not
  // emit one, but be defensive).
  delete manifest.mcpServers;

  const bareManifestPath = path.join(outDir, "plugin.json");
  fs.writeFileSync(bareManifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // 4. Ensure no .claude-plugin/ directory survives.
  const ghostDir = path.join(outDir, ".claude-plugin");
  if (fs.existsSync(ghostDir)) {
    fs.rmSync(ghostDir, { recursive: true, force: true });
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
