/**
 * @file lisa-agent-emit-extra.ts
 * @description Copilot, Devin, and OpenCode agent-surface emission. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import * as path from "node:path";
import pc from "picocolors";
import { installAgentsMd } from "../codex/agents-md-installer.js";
import { collectLisaMcpServers } from "../agy/mcp-installer.js";
import { installCopilotPlugin } from "../copilot/plugin-installer.js";
import { detectDevin, installDevinPlugin } from "../devin/plugin-installer.js";
import { installDevinEnforcementFallback } from "../devin/enforcement-fallback-installer.js";
import { installCopilotInstructions } from "../copilot/copilot-instructions-installer.js";
import {
  readManagedManifest as readOpencodeManifest,
  writeManagedManifest as writeOpencodeManifest,
} from "../opencode/manifest.js";
import { installSkills as installOpencodeSkills } from "../opencode/skills-installer.js";
import { installHooks as installOpencodeHooks } from "../opencode/hooks-installer.js";
import { installSettings as installOpencodeSettings } from "../opencode/settings-installer.js";
import {
  installOpencodeMcpConfig,
  resolveOpencodeConfigPath,
} from "../opencode/mcp-installer.js";
import { discoverAndInstallAgents as installOpencodeAgents } from "../opencode/agent-installer.js";
import { discoverAndInstallCommands as installOpencodeCommands } from "../opencode/command-installer.js";
import { harnessIncludesAgent } from "./config.js";
import { LisaAgentEmit } from "./lisa-agent-emit.js";
import { HOST_OWNED_LABEL } from "./lisa-state.js";

/**
 * Copilot, Devin, and OpenCode agent-surface emission.
 */
export abstract class LisaAgentEmitExtra extends LisaAgentEmit {
  /**
   * Emit GitHub-Copilot-targeted artifacts when the harness includes copilot.
   *
   * Three per-project actions:
   *   1. `copilot plugin install lisa@CodySwannGT/lisa` (with local-path
   *      fallback when the marketplace path fails — currently does, pending
   *      the marketplace.json pluginRoot fix gated on Wave 2 spec step 8).
   *   2. Ensure the canonical `AGENTS.md` exists (Copilot reads it natively).
   *   3. Create-only write of `.github/copilot-instructions.md`.
   */
  protected async processCopilotEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "copilot")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("Copilot emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Copilot emit: skipped (dry-run mode)"));
      return;
    }

    const pluginRoot = path.join(this.config.lisaDir, "plugins");
    // Base variant plus the matching variant for each detected stack.
    const variantNames = [
      "lisa-copilot",
      ...this.perAgentStackVariants(pluginRoot, "copilot"),
    ];
    const pluginResults = [];
    for (const variant of variantNames) {
      pluginResults.push(await installCopilotPlugin(pluginRoot, variant));
    }
    // Copilot reads AGENTS.md natively at session start, so ensure the
    // canonical file exists; copilot-instructions.md stays a thin host-owned
    // file that points at it.
    const copilotAgentsResult = await installAgentsMd(this.config.destDir);
    const instructionsResult = await installCopilotInstructions(
      this.config.destDir
    );

    const attempted = pluginResults.some(r => r.attempted);
    const installedCount = pluginResults.filter(r => r.installed).length;
    const via = pluginResults.find(r => r.installed)?.via ?? "local";
    const pluginMessage = attempted
      ? `${installedCount}/${variantNames.length} variants installed via ${via}`
      : "skipped (copilot not on PATH)";

    this.deps.logger.info(
      pc.cyan(
        `Copilot emit: ${pluginMessage}, AGENTS.md ${
          copilotAgentsResult.created ? "created" : HOST_OWNED_LABEL
        }, copilot-instructions ${
          instructionsResult.created ? "created" : HOST_OWNED_LABEL
        }`
      )
    );
  }

  /**
   * Emit Devin-CLI-targeted artifacts when the harness includes devin.
   *
   * Three per-project actions (CodySwannGT/lisa#4427):
   *   1. `devin plugins install --local -y` Lisa's `lisa-devin` variant plus the
   *      matching stack variants, when `devin` is on PATH.
   *   2. Reconcile `.devin/hooks.v1.json` with the repository enforcement
   *      fallback, which keeps the guards firing when the plugin is missing,
   *      disabled, or untrusted — and which is written whether or not `devin`
   *      is on this machine, because the clone travels to machines that have it.
   *   3. Ensure the canonical `AGENTS.md` exists (Devin reads it natively).
   *
   * Documented gaps: Devin CLI has no native scheduler, so Lisa's recurring
   * loops are triggered manually or through `scheduler: "github-actions"`; and
   * Sonar has no Devin integrate path, so `processSonarIntegration` skips it.
   */
  protected async processDevinEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "devin")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("Devin emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Devin emit: skipped (dry-run mode)"));
      return;
    }

    const pluginRoot = path.join(this.config.lisaDir, "plugins");
    const variantNames = [
      "lisa-devin",
      ...this.perAgentStackVariants(pluginRoot, "devin"),
    ];
    const detection = await detectDevin();
    const devinOnPath = detection.available;
    if (detection.error !== undefined) {
      this.deps.logger.warn(
        `Devin emit: devin is on PATH but \`devin --version\` failed, so no plugins were installed: ${detection.error}`
      );
    }
    const pluginResults = [];
    if (devinOnPath) {
      for (const variant of variantNames) {
        pluginResults.push(await installDevinPlugin(pluginRoot, variant));
      }
    }
    const fallback = await installDevinEnforcementFallback(this.config.destDir);
    const agentsResult = await installAgentsMd(this.config.destDir);

    const installedCount = pluginResults.filter(r => r.installed).length;
    const pluginMessage = devinOnPath
      ? `${installedCount}/${variantNames.length} plugins installed`
      : "plugins skipped (devin not on PATH)";
    this.deps.logger.info(
      pc.cyan(
        `Devin emit: ${pluginMessage}, ${fallback.managedFiles.join(", ")} enforcement fallback reconciled, AGENTS.md ${
          agentsResult.created ? "created" : HOST_OWNED_LABEL
        }`
      )
    );
    for (const failure of pluginResults.filter(r => !r.installed)) {
      this.deps.logger.warn(
        `Devin plugin install failed for ${failure.source ?? "unknown"}: ${failure.error ?? "unknown error"}`
      );
    }
  }

  /**
   * Install the four manifest-tracked OpenCode artifact sets and persist the
   * ownership manifest.
   *
   * All three vendoring installers (skills, agents, commands) are gated on
   * `detectedTypes`, matching the hooks installer below and the Codex overlay.
   * OpenCode is the surface where Lisa copies its catalogue verbatim into the
   * host repo, so an ungated emit would put Expo/React skills and Phaser
   * game-design agents in front of a model working an unrelated stack (#3437).
   *
   * Each installer scopes its own stale cleanup to its `lisa-` namespace, so
   * handing the full previous manifest to all four is safe.
   * @returns The four install results, for logging and stale accounting.
   */
  protected async installOpencodeManagedArtifacts(): Promise<{
    skillsResult: Awaited<ReturnType<typeof installOpencodeSkills>>;
    hooksResult: Awaited<ReturnType<typeof installOpencodeHooks>>;
    opencodeAgentsResult: Awaited<ReturnType<typeof installOpencodeAgents>>;
    commandsResult: Awaited<ReturnType<typeof installOpencodeCommands>>;
  }> {
    const { lisaDir, destDir } = this.config;
    const previous = await readOpencodeManifest(destDir);
    const skillsResult = await installOpencodeSkills(
      lisaDir,
      destDir,
      previous.files,
      this.detectedTypes
    );
    // Hooks: block-no-verify maps to opencode.json `permission.bash`; the
    // runtime-behavior hooks ship as `.opencode/plugin/lisa-*.ts` modules.
    const hooksResult = await installOpencodeHooks(
      lisaDir,
      destDir,
      this.detectedTypes,
      previous.files
    );
    // OpenCode reads agents (`.opencode/agents/`) and commands
    // (`.opencode/commands/`) natively. Emit both from Lisa's plugin sources.
    const opencodeAgentsResult = await installOpencodeAgents(
      lisaDir,
      destDir,
      previous.files,
      this.detectedTypes
    );
    const commandsResult = await installOpencodeCommands(
      lisaDir,
      destDir,
      previous.files,
      this.detectedTypes
    );
    await writeOpencodeManifest(destDir, [
      ...skillsResult.managedFiles,
      ...hooksResult.managedFiles,
      ...opencodeAgentsResult.managedFiles,
      ...commandsResult.managedFiles,
    ]);
    return {
      skillsResult,
      hooksResult,
      opencodeAgentsResult,
      commandsResult,
    };
  }

  /**
   * Emit OpenCode-targeted artifacts when the harness includes OpenCode.
   *
   * OpenCode reads the open Agent Skills format, native agents
   * (`.opencode/agents/`), native commands (`.opencode/commands/`), and
   * `AGENTS.md` natively (opencode.ai/docs/skills, /docs/agents, /docs/commands,
   * /docs/rules), so Lisa needs no transformed plugin variant. It writes:
   *   - skills (bundled + command-derived) into `.opencode/skills/lisa/`,
   *   - agents (Markdown, `lisa-` prefixed) into `.opencode/agents/`,
   *   - commands (Markdown, `lisa-` prefixed) into `.opencode/commands/`,
   * and ensures the canonical `AGENTS.md` exists. Ownership of skills/agents/
   * commands is tracked via `.opencode/.lisa-managed.json` so updates clean up
   * stale artifacts without touching host customizations. Skipped in dry-run
   * mode and on harness modes that don't include OpenCode.
   */
  protected async processOpencodeEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "opencode")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("OpenCode emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("OpenCode emit: skipped (dry-run mode)"));
      return;
    }

    const { skillsResult, hooksResult, opencodeAgentsResult, commandsResult } =
      await this.installOpencodeManagedArtifacts();
    // OpenCode reads AGENTS.md natively; ensure the canonical file exists. It is
    // create-only and host-owned afterward, so it's not tracked in the manifest.
    const agentsMdResult = await installAgentsMd(this.config.destDir);

    // Config-level delivery (host-preserving merges into the project
    // `opencode.json`, NOT tracked in the manifest — deleting a merged host file
    // would be data loss). The hooks installer above already merged the
    // `permission.bash` deny rules; settings + MCP merge their own keys and
    // preserve everything else, so the three writers compose into one file.
    //   1. Settings: force `share: "disabled"` so applying the fleet config can
    //      never publish a host's sessions via OpenCode's default-on, public
    //      share URLs. Other host keys are preserved.
    //   2. MCP wrap: OpenCode ignores plugin-bundled MCP, so collect Lisa's
    //      servers from the built plugin `.mcp.json` files (base + detected
    //      stacks) and write them into the `mcp` key, translated to OpenCode's
    //      `type:"local"|"remote"` shape. Called unconditionally so stale
    //      `_lisaManaged` entries are stripped when a project drops MCP.
    await installOpencodeSettings(this.config.destDir);
    const pluginRoot = path.join(this.config.lisaDir, "plugins");
    const lisaMcpServers = collectLisaMcpServers(
      pluginRoot,
      this.detectedTypes
    );
    const mcpResult = await installOpencodeMcpConfig(
      lisaMcpServers,
      resolveOpencodeConfigPath(this.config.destDir)
    );
    const mcpMessage =
      mcpResult.lisaEntryCount > 0
        ? `, ${mcpResult.lisaEntryCount} MCP server(s)`
        : "";
    const staleCount =
      skillsResult.deleted.length +
      hooksResult.deleted.length +
      opencodeAgentsResult.deleted.length +
      commandsResult.deleted.length;

    // The hooks installer is the first writer, so its `configCreated` flag
    // reflects whether `opencode.json` existed before this emit.
    this.deps.logger.info(
      pc.cyan(
        `OpenCode emit: ${skillsResult.installed.length} skills, ${hooksResult.pluginCount} plugin hooks, ${opencodeAgentsResult.installed.length} agents, ${commandsResult.installed.length} commands${
          staleCount > 0 ? ` (${staleCount} stale removed)` : ""
        }, AGENTS.md ${
          agentsMdResult.created ? "created" : HOST_OWNED_LABEL
        }, opencode.json ${
          hooksResult.configCreated ? "created" : "merged"
        }${mcpMessage}`
      )
    );
  }
}
