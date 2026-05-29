#!/usr/bin/env node
/**
 * Generate the GitHub Copilot variant of a Lisa plugin from the built Claude
 * artifact.
 *
 * Copilot reads `.claude-plugin/plugin.json` as a documented fallback (per its
 * manifest lookup order: plugin.json → .plugin/ → .github/plugin/ →
 * .claude-plugin/). The Copilot variant keeps the `.claude-plugin/` manifest
 * but rewrites hook event names to Copilot's camelCase convention
 * (`preToolUse`, `agentStop`, etc.) and strips hooks that don't have a Copilot
 * equivalent (SubagentStart entries — Copilot lacks the event).
 *
 * Per the Wave 1 audit, Copilot ships:
 *   block-no-verify.sh, inject-rules.sh (conservative default — conditional on
 *   the rules-auto-load probe), install-pkgs.sh, setup-jira-cli.sh.
 *
 * Per the Wave 2 pattern-b-fan-out-spec.md, this generator runs four pre-flight
 * probes when `copilot` is on PATH and caches the results. When `copilot` is
 * not on PATH (CI builds, contributors without Copilot), the cached values are
 * used; absent cache values fall through to conservative defaults.
 *
 * Usage: node scripts/generate-copilot-plugin-artifacts.mjs <source-plugin-dir> <out-dir> <version>
 *
 * @module scripts/generate-copilot-plugin-artifacts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  filterHooksForAgent,
  filterScriptsForAgent,
} from "./lib/per-agent-hook-filter.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const POLICY_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "internal-copilot-skill-policy.json"
);
const PROBE_CACHE_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "internal-copilot-runtime-probe.json"
);

/**
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
 * Read cached Copilot runtime probe results.
 *
 * Fields documented in pattern-b-fan-out-spec.md §Pre-flight probes:
 *   - pluginRootEnvVar: e.g. "COPILOT_PLUGIN_ROOT" or null (use absolute paths)
 *   - rulesAutoLoads: boolean — Copilot reads plugin's rules/ natively
 *   - agentPathOverrideAccepted: boolean — manifest agents:"agents/" accepts non-.agent.md
 *   - cliVersion: string for invalidation
 *
 * @returns {{ pluginRootEnvVar?: string|null, rulesAutoLoads?: boolean, agentPathOverrideAccepted?: boolean, cliVersion?: string }}
 */
function readProbeCache() {
  if (!fs.existsSync(PROBE_CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(PROBE_CACHE_PATH, "utf8"));
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
 * Generate the Copilot variant.
 *
 * @param {string} srcDir Built Claude plugin directory (input).
 * @param {string} outDir Copilot variant output directory.
 * @param {string} version Version string for the manifest.
 */
export function generateCopilotVariant(srcDir, outDir, version) {
  if (!fs.existsSync(path.join(srcDir, ".claude-plugin", "plugin.json"))) {
    return;
  }

  const policy = readPolicy();
  const denylist = new Set(policy.denylist ?? []);
  const probe = readProbeCache();

  // Conservative defaults for any probe value not in cache:
  //   - rulesAutoLoads: false (ship inject-rules.sh, accept potential double-load
  //     until empirically refuted by the probe — same as the Wave 1 audit's default)
  //   - pluginRootEnvVar: null (use ${CLAUDE_PLUGIN_ROOT} in command strings; Copilot
  //     may or may not honor it. Wave 3 verify-by-run resolves this.)
  //   - agentPathOverrideAccepted: false (rename agents/*.md to *.agent.md in the variant
  //     to be safe; if the override works, this is harmless extra renaming)
  const copilotRulesAutoLoads = probe.rulesAutoLoads === true;
  const renameAgentsToAgentMd = probe.agentPathOverrideAccepted !== true;

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Copy source minus .codex-plugin/ and apply skill denylist.
  copyDir(srcDir, outDir, relPath => {
    if (relPath.startsWith(".codex-plugin/") || relPath === ".codex-plugin")
      return false;
    // Defensively drop any hooks/hooks.json. The base build now emits the Codex
    // hooks manifest under .codex-plugin/ (stripped above), not here (issue
    // #1058), but guard against a regression reintroducing it: Copilot reads its
    // (camelCase) hooks from .claude-plugin/plugin.json, not a Codex-shaped
    // (PascalCase, ${PLUGIN_ROOT}) file.
    if (relPath === path.join("hooks", "hooks.json")) return false;
    // Drop Codex-specific per-skill openai.yaml artifacts — Copilot does not use them.
    if (/^skills\/[^/]+\/agents\/openai\.ya?ml$/.test(relPath)) return false;
    const skillsPrefix = path.join("skills") + path.sep;
    if (relPath.startsWith(skillsPrefix)) {
      const skillName = relPath.slice(skillsPrefix.length).split(path.sep)[0];
      if (denylist.has(skillName)) return false;
    }
    return true;
  });

  // 1a. Remove any now-empty `skills/<n>/agents/` directories left by the openai.yaml strip.
  const skillsDirForCleanup = path.join(outDir, "skills");
  if (fs.existsSync(skillsDirForCleanup)) {
    for (const skillName of fs.readdirSync(skillsDirForCleanup)) {
      const agentsDir = path.join(skillsDirForCleanup, skillName, "agents");
      if (fs.existsSync(agentsDir) && fs.readdirSync(agentsDir).length === 0) {
        fs.rmdirSync(agentsDir);
      }
    }
  }

  // 2. Rename agents/<n>.md to agents/<n>.agent.md (per Copilot's default convention).
  //    This is the safe-default path; if the manifest agents-path override probe
  //    returns positive, this rename is unnecessary but harmless.
  if (renameAgentsToAgentMd) {
    const agentsDir = path.join(outDir, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          entry.name.endsWith(".md") &&
          !entry.name.endsWith(".agent.md")
        ) {
          const oldPath = path.join(agentsDir, entry.name);
          const newName = entry.name.replace(/\.md$/, ".agent.md");
          const newPath = path.join(agentsDir, newName);
          fs.renameSync(oldPath, newPath);
        }
      }
    }
  }

  // 3. Read + filter the manifest, translate event names to Copilot camelCase.
  const manifestPath = path.join(outDir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  const filteredHooks = filterHooksForAgent(manifest.hooks ?? {}, "copilot", {
    copilotRulesAutoLoads,
  });
  if (filteredHooks) {
    manifest.hooks = filteredHooks;
  } else {
    delete manifest.hooks;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // 4. Filter the hooks/ directory.
  const hooksDir = path.join(outDir, "hooks");
  if (fs.existsSync(hooksDir)) {
    const all = fs
      .readdirSync(hooksDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".sh"))
      .map(e => e.name);
    // Copilot ships everything Cursor ships, plus inject-rules.sh when
    // copilotRulesAutoLoads is false. The filter helper handles this.
    const keep = new Set(filterScriptsForAgent(all, "copilot"));
    // If the rules-auto-load probe is positive, ALSO strip inject-rules.sh.
    if (copilotRulesAutoLoads) keep.delete("inject-rules.sh");
    for (const name of all) {
      if (!keep.has(name)) fs.rmSync(path.join(hooksDir, name));
    }
    if (fs.readdirSync(hooksDir).length === 0) {
      fs.rmdirSync(hooksDir);
    }
  }
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [srcDir, outDir, version] = process.argv.slice(2);
  if (!srcDir || !outDir || !version) {
    console.error(
      "Usage: generate-copilot-plugin-artifacts.mjs <src> <out> <version>"
    );
    process.exit(1);
  }
  generateCopilotVariant(srcDir, outDir, version);
  console.log(`Generated Copilot variant at ${outDir} (v${version})`);
}
