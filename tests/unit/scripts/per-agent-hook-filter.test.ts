/**
 * Unit tests for scripts/lib/per-agent-hook-filter.mjs.
 *
 * Verifies the Wave 1 audit's ship-list is faithfully encoded in the helper
 * (per-agent script applicability + hook event translation).
 * @module tests/unit/scripts/per-agent-hook-filter
 */
import { describe, expect, it } from "vitest";
import {
  filterHooksForAgent,
  filterScriptsForAgent,
  shouldShipHook,
  shouldShipScript,
  translateEventName,
} from "../../../scripts/lib/per-agent-hook-filter.mjs";

const BLOCK_NO_VERIFY = "block-no-verify.sh";
const ENFORCE_TEAM_FIRST = "enforce-team-first.sh";
const INJECT_RULES = "inject-rules.sh";
const INJECT_FLOW = "inject-flow-context.sh";
const INSTALL_PKGS = "install-pkgs.sh";
const SETUP_JIRA = "setup-jira-cli.sh";
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}/hooks/";
const INJECT_RULES_HOOK_CMD = `${PLUGIN_ROOT}${INJECT_RULES}`;

// Build a Claude-shaped hook entry referencing one or more hooks/<script> commands.
const scriptEntry = (...scripts: readonly string[]) => ({
  matcher: "",
  hooks: scripts.map(s => ({ type: "command", command: `${PLUGIN_ROOT}${s}` })),
});

// Build a Claude-only `entire hooks claude-code` analytics entry.
const entireEntry = (verb: string) => ({
  matcher: "",
  hooks: [
    {
      type: "command",
      command: `command -v entire >/dev/null 2>&1 && entire hooks claude-code ${verb} || true`,
    },
  ],
});

describe("per-agent-hook-filter", () => {
  describe("shouldShipScript", () => {
    it("ships block-no-verify.sh to claude, codex, cursor, copilot, and agy", () => {
      expect(shouldShipScript(BLOCK_NO_VERIFY, "claude")).toBe(true);
      expect(shouldShipScript(BLOCK_NO_VERIFY, "codex")).toBe(true);
      expect(shouldShipScript(BLOCK_NO_VERIFY, "cursor")).toBe(true);
      expect(shouldShipScript(BLOCK_NO_VERIFY, "agy")).toBe(true);
      expect(shouldShipScript(BLOCK_NO_VERIFY, "copilot")).toBe(true);
    });

    it("ships the agy hook ship-list (3 universal scripts), strips the rest", () => {
      // agy now fires plugin hooks from a subdir; the ship-list matches Cursor's.
      expect(shouldShipScript(BLOCK_NO_VERIFY, "agy")).toBe(true);
      expect(shouldShipScript(INSTALL_PKGS, "agy")).toBe(true);
      expect(shouldShipScript(SETUP_JIRA, "agy")).toBe(true);
      // Stripped for agy:
      expect(shouldShipScript(ENFORCE_TEAM_FIRST, "agy")).toBe(false);
      expect(shouldShipScript(INJECT_RULES, "agy")).toBe(false);
      expect(shouldShipScript(INJECT_FLOW, "agy")).toBe(false);
    });

    it("ships enforce-team-first.sh only to claude (Claude-team-specific)", () => {
      expect(shouldShipScript(ENFORCE_TEAM_FIRST, "claude")).toBe(true);
      expect(shouldShipScript(ENFORCE_TEAM_FIRST, "codex")).toBe(false);
      expect(shouldShipScript(ENFORCE_TEAM_FIRST, "cursor")).toBe(false);
      expect(shouldShipScript(ENFORCE_TEAM_FIRST, "agy")).toBe(false);
      expect(shouldShipScript(ENFORCE_TEAM_FIRST, "copilot")).toBe(false);
    });

    it("strips inject-rules.sh from cursor (auto-loads rules/) and agy (hooks don't fire)", () => {
      expect(shouldShipScript(INJECT_RULES, "claude")).toBe(true);
      expect(shouldShipScript(INJECT_RULES, "codex")).toBe(true);
      expect(shouldShipScript(INJECT_RULES, "cursor")).toBe(false);
      expect(shouldShipScript(INJECT_RULES, "agy")).toBe(false);
      expect(shouldShipScript(INJECT_RULES, "copilot")).toBe(true);
    });

    it("excludes any *debug*.sh universally", () => {
      expect(shouldShipScript("debug-hook.sh", "claude")).toBe(false);
      expect(shouldShipScript("my-debug-script.sh", "claude")).toBe(false);
    });

    it("excludes unregistered scripts (catalog item without registered hook entry)", () => {
      expect(shouldShipScript("ticket-sync-reminder.sh", "claude")).toBe(false);
      expect(shouldShipScript("track-plan-sessions.sh", "claude")).toBe(false);
    });

    it("defaults to ship for unknown scripts (conservative)", () => {
      expect(shouldShipScript("new-future-hook.sh", "claude")).toBe(true);
    });
  });

  describe("translateEventName", () => {
    it("rewrites PascalCase to Copilot camelCase", () => {
      expect(translateEventName("PreToolUse", "copilot")).toBe("preToolUse");
      expect(translateEventName("Stop", "copilot")).toBe("agentStop");
      expect(translateEventName("UserPromptSubmit", "copilot")).toBe(
        "userPromptSubmitted"
      );
    });

    it("keeps PascalCase for cursor (auto-normalized at load)", () => {
      expect(translateEventName("PreToolUse", "cursor")).toBe("PreToolUse");
    });
  });

  describe("shouldShipHook", () => {
    it("strips entire hooks claude-code calls universally for non-claude", () => {
      const hook = {
        type: "command",
        command:
          "command -v entire >/dev/null 2>&1 && entire hooks claude-code session-start || true",
      };
      expect(shouldShipHook(hook, undefined, "cursor")).toBe(false);
      expect(shouldShipHook(hook, undefined, "codex")).toBe(false);
      expect(shouldShipHook(hook, undefined, "copilot")).toBe(false);
    });

    it("strips inject-rules.sh hook on cursor (collision rule)", () => {
      const hook = {
        type: "command",
        command: INJECT_RULES_HOOK_CMD,
      };
      expect(shouldShipHook(hook, undefined, "cursor")).toBe(false);
      expect(shouldShipHook(hook, undefined, "codex")).toBe(true);
    });

    it("conditionally strips inject-rules.sh on copilot per probe", () => {
      const hook = {
        type: "command",
        command: INJECT_RULES_HOOK_CMD,
      };
      expect(
        shouldShipHook(hook, undefined, "copilot", {
          copilotRulesAutoLoads: false,
        })
      ).toBe(true);
      expect(
        shouldShipHook(hook, undefined, "copilot", {
          copilotRulesAutoLoads: true,
        })
      ).toBe(false);
    });

    it("strips inject-rules.sh hook on agy (rules delivered via AGENTS.md bake)", () => {
      const hook = {
        type: "command",
        command: INJECT_RULES_HOOK_CMD,
      };
      expect(shouldShipHook(hook, "SessionStart", "agy")).toBe(false);
    });

    it("ships block-no-verify.sh hook on agy", () => {
      const hook = {
        type: "command",
        command: "${CLAUDE_PLUGIN_ROOT}/hooks/block-no-verify.sh",
      };
      expect(shouldShipHook(hook, "PreToolUse", "agy")).toBe(true);
    });
  });

  describe("filterHooksForAgent", () => {
    const sampleBlock = {
      SessionStart: [scriptEntry(INJECT_RULES)],
      PreToolUse: [scriptEntry(BLOCK_NO_VERIFY)],
    };

    it("flows agy through normal filtering: strips inject-rules, keeps block-no-verify (PascalCase)", () => {
      const out = filterHooksForAgent(sampleBlock, "agy");
      expect(out).toBeDefined();
      const result = out as Record<string, unknown>;
      // SessionStart only had inject-rules.sh → dropped.
      expect("SessionStart" in result).toBe(false);
      // PreToolUse block-no-verify.sh survives; event stays PascalCase.
      expect("PreToolUse" in result).toBe(true);
    });

    it("filters the full base hook block for agy to exactly the 3-script ship-list", () => {
      const fullBlock = {
        UserPromptSubmit: [
          entireEntry("user-prompt-submit"),
          scriptEntry(ENFORCE_TEAM_FIRST),
        ],
        PreToolUse: [scriptEntry(BLOCK_NO_VERIFY)],
        // Stop now carries only the Claude-only `entire ... stop` call
        // (notify-ntfy.sh retired) — stripped for agy, so Stop won't survive.
        Stop: [entireEntry("stop")],
        SessionStart: [scriptEntry(INSTALL_PKGS, INJECT_RULES, SETUP_JIRA)],
        SubagentStart: [scriptEntry(INJECT_FLOW)],
      };
      const out = filterHooksForAgent(fullBlock, "agy") as Record<
        string,
        Array<{ hooks: Array<{ command: string }> }>
      >;
      expect(out).toBeDefined();
      // Events that survive (PascalCase preserved):
      expect(Object.keys(out).sort((a, b) => a.localeCompare(b))).toEqual([
        "PreToolUse",
        "SessionStart",
      ]);
      // SessionStart keeps install-pkgs + setup-jira-cli, drops inject-rules.
      const sessionCmds = out.SessionStart.flatMap(e =>
        e.hooks.map(h => h.command)
      );
      expect(sessionCmds).toEqual([
        `${PLUGIN_ROOT}install-pkgs.sh`,
        `${PLUGIN_ROOT}setup-jira-cli.sh`,
      ]);
      // No entire-claude-code calls, no enforce-team-first, no inject-rules.
      const allCmds = Object.values(out)
        .flat()
        .flatMap(e => e.hooks.map(h => h.command));
      expect(allCmds.some(c => c.includes("entire hooks claude-code"))).toBe(
        false
      );
      expect(allCmds.some(c => c.includes(ENFORCE_TEAM_FIRST))).toBe(false);
      expect(allCmds.some(c => c.includes(INJECT_RULES))).toBe(false);
      expect(allCmds.some(c => c.includes(INJECT_FLOW))).toBe(false);
    });

    it("strips SessionStart inject-rules from cursor, keeps PreToolUse block-no-verify", () => {
      const out = filterHooksForAgent(sampleBlock, "cursor");
      expect(out).toBeDefined();
      const result = out as Record<string, unknown>;
      expect("SessionStart" in result).toBe(false);
      expect("PreToolUse" in result).toBe(true);
    });

    it("translates event names for copilot", () => {
      const out = filterHooksForAgent(sampleBlock, "copilot", {
        copilotRulesAutoLoads: false,
      });
      expect(out).toBeDefined();
      const result = out as Record<string, unknown>;
      // PreToolUse → preToolUse, SessionStart → sessionStart
      expect("preToolUse" in result).toBe(true);
      expect("sessionStart" in result).toBe(true);
      expect("PreToolUse" in result).toBe(false);
    });

    it("returns undefined when nothing survives the filter", () => {
      const emptyAfterFilter = {
        SessionEnd: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command:
                  "command -v entire >/dev/null 2>&1 && entire hooks claude-code session-end || true",
              },
            ],
          },
        ],
      };
      expect(filterHooksForAgent(emptyAfterFilter, "cursor")).toBeUndefined();
    });
  });

  describe("filterScriptsForAgent", () => {
    it("returns exactly the 3-script ship-list for agy", () => {
      const all = [
        BLOCK_NO_VERIFY,
        ENFORCE_TEAM_FIRST,
        INJECT_RULES,
        INJECT_FLOW,
        INSTALL_PKGS,
        SETUP_JIRA,
      ];
      expect(filterScriptsForAgent(all, "agy")).toEqual([
        BLOCK_NO_VERIFY,
        INSTALL_PKGS,
        SETUP_JIRA,
      ]);
    });

    it("strips per-agent denylist entries", () => {
      const all = [
        BLOCK_NO_VERIFY,
        ENFORCE_TEAM_FIRST,
        INJECT_RULES,
        INSTALL_PKGS,
      ];
      const cursorKeep = filterScriptsForAgent(all, "cursor");
      expect(cursorKeep).toContain(BLOCK_NO_VERIFY);
      expect(cursorKeep).toContain(INSTALL_PKGS);
      expect(cursorKeep).not.toContain(INJECT_RULES);
      expect(cursorKeep).not.toContain(ENFORCE_TEAM_FIRST);
    });
  });
});
