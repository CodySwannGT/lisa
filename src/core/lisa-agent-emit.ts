/**
 * @file lisa-agent-emit.ts
 * @description Codex, Claude, Antigravity, and Sonar agent-surface emission. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { installAgentsMd } from "../codex/agents-md-installer.js";
import { installCodexProjectOverlay } from "../codex/project-overlay.js";
import { installAgyPlugin } from "../agy/plugin-installer.js";
import {
  collectLisaMcpServers,
  installAgyMcpConfig,
  resolveAgyMcpConfigPath,
} from "../agy/mcp-installer.js";
import { installSonarIntegrations } from "../sonar/sonar-installer.js";
import { installClaudeMd } from "../claude/claude-md-installer.js";
import { harnessIncludesAgent } from "./config.js";
import { LisaPlugins } from "./lisa-plugins.js";
import { HOST_OWNED_LABEL } from "./lisa-state.js";

/**
 * Codex, Claude, Antigravity, and Sonar agent-surface emission.
 */
export abstract class LisaAgentEmit extends LisaPlugins {
  /**
   * Emit Codex-targeted artifacts (agents, hooks, settings) when the host
   * project's harness includes Codex (`codex` or `fleet`). No-op for `claude`
   * (default).
   *
   * Lisa writes the complete Codex surface and a filtered repository
   * marketplace into the host. No user-wide plugin activation participates.
   * Ownership is tracked via `.codex/.lisa-managed.json` so updates remove
   * stale stack artifacts without touching host customizations.
   */
  protected async processCodexEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "codex")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("Codex emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Codex emit: skipped (dry-run mode)"));
      return;
    }

    const result = await installCodexProjectOverlay(
      this.config.lisaDir,
      this.config.destDir,
      this.detectedTypes
    );
    const totalStale =
      result.staleAgentCount +
      result.staleHookRuleCount +
      result.staleSkillCount;
    this.deps.logger.info(
      pc.cyan(
        `Codex emit: ${result.agentCount} agents, ${result.hookCount} repository enforcement fallback plus plugin-bundled hooks, ${result.modelVisibleSkillCount} native skills from ${result.marketplacePluginCount} project plugins, ${result.mcpServerCount} MCP servers, settings ${result.settingsCreated ? "created" : "merged"}${
          totalStale > 0
            ? ` (${result.staleAgentCount} stale agents, ${result.staleHookRuleCount} stale hook/rule files, ${result.staleSkillCount} stale skills removed)`
            : ""
        }`
      )
    );
  }

  /**
   * Emit Claude-Code-targeted artifacts when the harness includes Claude.
   *
   * Claude's primary distribution is the GitHub marketplace; the per-project
   * artifacts Lisa writes are the canonical `AGENTS.md` and a thin `CLAUDE.md`
   * that `@AGENTS.md`-imports it (Claude Code doesn't read AGENTS.md natively).
   * Both are create-only and host-owned from creation onward. Skipped in dry-run
   * mode and on harness modes that don't include Claude.
   */
  protected async processClaudeEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "claude")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("Claude emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Claude emit: skipped (dry-run mode)"));
      return;
    }
    // Ensure the canonical AGENTS.md exists first — it is the import target of
    // the CLAUDE.md pointer.
    const agentsResult = await installAgentsMd(this.config.destDir);
    const result = await installClaudeMd(this.config.destDir);
    this.deps.logger.info(
      pc.cyan(
        `Claude emit: AGENTS.md ${agentsResult.created ? "created" : HOST_OWNED_LABEL}, CLAUDE.md ${result.created ? "created (pointer → AGENTS.md)" : HOST_OWNED_LABEL}`
      )
    );
  }

  /**
   * Per-agent stack variant directory names for the detected project types
   * that have a built variant. Filters by on-disk existence so a detected type
   * without a stack plugin (e.g. `npm-package`) is naturally skipped.
   * @param pluginRoot - Absolute path to the `plugins/` directory.
   * @param agent - Per-agent variant suffix (`agy` | `copilot` | `cursor`).
   * @returns Variant directory names like `lisa-typescript-agy`.
   */
  protected perAgentStackVariants(pluginRoot: string, agent: string): string[] {
    return this.detectedTypes
      .map(type => `lisa-${type}-${agent}`)
      .filter(name => existsSync(path.join(pluginRoot, name)));
  }

  /**
   * Emit Antigravity-targeted artifacts when the harness includes agy.
   *
   * Runtime probes of agy 1.0.3 (ticket-1054) established how agy consumes each
   * surface, so each is delivered the way agy actually reads it:
   *   1. `agy plugin install` Lisa's variant from `plugins/lisa-agy/` (when agy
   *      is on PATH). This installs the variant into
   *      `~/.gemini/config/plugins/<variant>/`.
   *   2. Hooks → PLUGIN-BUNDLED. agy loads a plugin's hooks from a `hooks.json`
   *      at the installed plugin ROOT, so the hooks config + agy-protocol script
   *      are emitted into the variant at BUILD time by
   *      generate-agy-plugin-artifacts.mjs and ride along with the plugin
   *      install above — nothing is written here. Only `block-no-verify`
   *      (PreToolUse) maps; SessionStart hooks aren't supported by agy.
   *   3. MCP → USER-GLOBAL. agy ignores plugin-bundled MCP and only auto-loads
   *      `~/.gemini/config/mcp_config.json`, so `installAgyMcpConfig` writes
   *      there (servers collected from the built plugin `.mcp.json` files via
   *      `collectLisaMcpServers`, translated to agy's `serverUrl` shape,
   *      tagged-merge preserving host entries). Cross-project caveat: the most
   *      recent `lisa apply` carrying MCP wins globally.
   *   4. Instruction file → the canonical create-only `AGENTS.md` (the same file
   *      every other agent reads), plus a bounded project-learnings bridge
   *      reconciled by `processInstructionFilesMigration`. Lisa does not bake
   *      eager rule bodies into AGENTS.md: a giant generated file is not worth
   *      carrying just to polyfill agy's headless (`-p`) mode, where SessionStart
   *      hooks don't fire. In interactive mode it still receives Lisa's plugin
   *      (skills/agents/MCP) above.
   */
  protected async processAgyEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "agy")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("agy emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("agy emit: skipped (dry-run mode)"));
      return;
    }

    const pluginRoot = path.join(this.config.lisaDir, "plugins");
    // Install the base variant plus the matching variant for each detected
    // stack so agy reaches parity with Claude/Codex on stack-specific plugins.
    const variantNames = [
      "lisa-agy",
      ...this.perAgentStackVariants(pluginRoot, "agy"),
    ];
    const pluginResults = [];
    for (const variant of variantNames) {
      pluginResults.push(await installAgyPlugin(pluginRoot, variant));
    }

    // MCP: agy ignores plugin-bundled MCP AND only auto-loads the USER-GLOBAL
    // config (~/.gemini/config/mcp_config.json) — the project-scope
    // `.agents/mcp_config.json` is never read by the agy CLI (verified-by-run,
    // ticket-1054). So collect Lisa's servers from the built plugin .mcp.json
    // files (base + detected stacks) and install them into the user-scope
    // aggregate (translated to agy's serverUrl shape, tagged-merge preserving
    // host entries). Caveat: this is shared across projects — the most recent
    // `lisa apply` carrying MCP servers wins globally; host-authored entries are
    // preserved by the _lisaManaged tagged-merge. Skip when no stack ships MCP.
    const lisaMcpServers = collectLisaMcpServers(
      pluginRoot,
      this.detectedTypes
    );
    // Always call installAgyMcpConfig — even when lisaMcpServers is empty —
    // so the tagged-merge logic strips any previously-written _lisaManaged
    // entries. Skipping on empty would leave stale managed entries behind
    // from a previous `lisa apply` for a project that had MCP servers.
    const mcpResult = await installAgyMcpConfig(
      lisaMcpServers,
      resolveAgyMcpConfigPath({ scope: "user" })
    );
    const mcpServerCount = mcpResult.lisaEntryCount;

    // Hooks: delivered as a plugin-bundled root hooks.json inside the installed
    // agy variant (emitted at build time by generate-agy-plugin-artifacts.mjs,
    // installed via `agy plugin install` above) — NOT written here at apply time.

    // Instruction file: the canonical, create-only AGENTS.md. The bounded
    // project-learnings bridge is reconciled after all emit paths run.
    const agentsMdResult = await installAgentsMd(this.config.destDir);

    const attempted = pluginResults.some(r => r.attempted);
    const installedCount = pluginResults.filter(r => r.installed).length;
    const pluginMessage = attempted
      ? `${installedCount}/${variantNames.length} variants installed`
      : "skipped (agy not on PATH)";
    // Only mention MCP when servers were actually written.
    const mcpMessage =
      mcpServerCount > 0
        ? `, ${mcpServerCount} MCP server(s) → ~/.gemini/config/mcp_config.json`
        : "";

    this.deps.logger.info(
      pc.cyan(
        `agy emit: ${pluginMessage}, AGENTS.md ${
          agentsMdResult.created ? "created" : HOST_OWNED_LABEL
        }${mcpMessage}`
      )
    );
  }

  /**
   * Wire the official SonarQube MCP into each harness agent via the vendor's
   * `sonar integrate <agent>`.
   *
   * Hard-gated inside {@link installSonarIntegrations}: a no-op unless the project
   * opted in (`verification.sonar.enabled`) AND the `sonar` CLI is on PATH, so it
   * never touches a project that only wants the CI SonarCloud gate. Kiro and
   * Gemini are never wired — they are not Lisa-supported agents. Only the
   * apply-time emit agents with a vendor integrate path are wired here (claude,
   * codex, copilot, antigravity). Cursor (consumed natively, no apply-time emit)
   * and OpenCode (no vendor integrate path) are wired by `/lisa:setup:sonar`.
   */
  protected async processSonarIntegration(): Promise<void> {
    const { harness } = this.config;
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("Sonar integrate: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Sonar integrate: skipped (dry-run mode)"));
      return;
    }
    // Map Lisa harness emit agents to the vendor's integrate agent names.
    const candidates: readonly (readonly [boolean, string])[] = [
      [harnessIncludesAgent(harness, "claude"), "claude"],
      [harnessIncludesAgent(harness, "codex"), "codex"],
      [harnessIncludesAgent(harness, "copilot"), "copilot"],
      [harnessIncludesAgent(harness, "agy"), "antigravity"],
    ];
    const vendorAgents = candidates
      .filter(([included]) => included)
      .map(([, name]) => name);
    const result = await installSonarIntegrations(
      this.config.destDir,
      vendorAgents
    );
    if (!result.enabled) {
      return;
    }
    const failure =
      result.failed.length > 0 ? ` (failed: ${result.failed.join(", ")})` : "";
    const message = result.attempted
      ? `${result.integrated.length}/${vendorAgents.length} agent(s) wired${failure}`
      : "skipped (sonar CLI not on PATH)";
    this.deps.logger.info(pc.cyan(`Sonar integrate: ${message}`));
  }
}
