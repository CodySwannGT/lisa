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
const INJECT_RULES_HOOK_CMD = "${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.sh";

describe("per-agent-hook-filter", () => {
  describe("shouldShipScript", () => {
    it("ships block-no-verify.sh to claude, codex, cursor, copilot — not agy", () => {
      expect(shouldShipScript(BLOCK_NO_VERIFY, "claude")).toBe(true);
      expect(shouldShipScript(BLOCK_NO_VERIFY, "codex")).toBe(true);
      expect(shouldShipScript(BLOCK_NO_VERIFY, "cursor")).toBe(true);
      expect(shouldShipScript(BLOCK_NO_VERIFY, "agy")).toBe(false);
      expect(shouldShipScript(BLOCK_NO_VERIFY, "copilot")).toBe(true);
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
  });

  describe("filterHooksForAgent", () => {
    const sampleBlock = {
      SessionStart: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: INJECT_RULES_HOOK_CMD,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "${CLAUDE_PLUGIN_ROOT}/hooks/block-no-verify.sh",
            },
          ],
        },
      ],
    };

    it("returns undefined for agy (variant ships no hooks)", () => {
      expect(filterHooksForAgent(sampleBlock, "agy")).toBeUndefined();
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
    it("returns empty array for agy", () => {
      expect(
        filterScriptsForAgent([BLOCK_NO_VERIFY, INJECT_RULES], "agy")
      ).toEqual([]);
    });

    it("strips per-agent denylist entries", () => {
      const notifyNtfy = "notify-ntfy.sh";
      const all = [
        BLOCK_NO_VERIFY,
        ENFORCE_TEAM_FIRST,
        INJECT_RULES,
        notifyNtfy,
      ];
      const cursorKeep = filterScriptsForAgent(all, "cursor");
      expect(cursorKeep).toContain(BLOCK_NO_VERIFY);
      expect(cursorKeep).toContain(notifyNtfy);
      expect(cursorKeep).not.toContain(INJECT_RULES);
      expect(cursorKeep).not.toContain(ENFORCE_TEAM_FIRST);
    });
  });
});
