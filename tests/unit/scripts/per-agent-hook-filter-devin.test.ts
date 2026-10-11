/**
 * Devin arm of scripts/lib/per-agent-hook-filter.mjs (CodySwannGT/lisa#4426):
 * the ship list, the unsupported-event drop, matcher translation, and the root
 * hooks.json builder. Kept apart from per-agent-hook-filter.test.ts so neither
 * file crosses the max-lines budget.
 * @module tests/unit/scripts/per-agent-hook-filter-devin
 */
import { describe, expect, it } from "vitest";
import {
  buildDevinHooksJson,
  DEVIN_TOOL_SHIM,
  isUnsupportedEvent,
  shouldShipScript,
  translateMatcherForDevin,
} from "../../../scripts/lib/per-agent-hook-filter.mjs";

const ROOT = "${CLAUDE_PLUGIN_ROOT}/hooks/";
const handler = (script: string) => ({
  type: "command",
  command: `${ROOT}${script}`,
});

describe("per-agent-hook-filter — devin", () => {
  it("ships the guards and session hooks Devin can fire", () => {
    expect(shouldShipScript("block-no-verify.sh", "devin")).toBe(true);
    expect(shouldShipScript("inject-rules.sh", "devin")).toBe(true);
    expect(shouldShipScript("secrets-preflight.sh", "devin")).toBe(true);
  });

  it("strips Claude-team and subagent-only scripts", () => {
    expect(shouldShipScript("enforce-team-first.sh", "devin")).toBe(false);
    expect(shouldShipScript("inject-flow-context.sh", "devin")).toBe(false);
    expect(shouldShipScript("block-no-verify.agy.sh", "devin")).toBe(false);
  });

  it("treats Claude's subagent and compaction events as unsupported", () => {
    expect(isUnsupportedEvent("SubagentStart", "devin")).toBe(true);
    expect(isUnsupportedEvent("PreCompact", "devin")).toBe(true);
    expect(isUnsupportedEvent("PreToolUse", "devin")).toBe(false);
  });

  describe("translateMatcherForDevin", () => {
    it("keeps a match-all matcher empty", () => {
      expect(translateMatcherForDevin("")).toBe("");
      expect(translateMatcherForDevin(undefined)).toBe("");
    });

    it("maps Bash to an anchored exec", () => {
      expect(translateMatcherForDevin("Bash")).toBe("^(exec)$");
    });

    it("dedupes the edit tools and adds apply_patch", () => {
      expect(translateMatcherForDevin("Write|Edit|MultiEdit")).toBe(
        "^(write|apply_patch|edit)$"
      );
    });

    it("keeps MCP tool names verbatim", () => {
      expect(translateMatcherForDevin("mcp__github__create_issue")).toBe(
        "^(mcp__github__create_issue)$"
      );
    });

    it("returns null when no named tool exists on Devin", () => {
      expect(translateMatcherForDevin("EnterWorktree")).toBeNull();
      expect(translateMatcherForDevin("TeamCreate")).toBeNull();
    });
  });

  describe("buildDevinHooksJson", () => {
    it("returns undefined for an empty or missing block", () => {
      expect(buildDevinHooksJson({})).toBeUndefined();
      expect(buildDevinHooksJson(undefined)).toBeUndefined();
    });

    it("drops entries whose matcher names no Devin tool", () => {
      const out = buildDevinHooksJson({
        PostToolUse: [
          { matcher: "EnterWorktree", hooks: [handler("worktree-guard.sh")] },
        ],
      });
      expect(out).toBeUndefined();
    });

    it("drops unsupported events wholesale", () => {
      const out = buildDevinHooksJson({
        SubagentStart: [{ matcher: "", hooks: [handler("inject-rules.sh")] }],
        Stop: [{ matcher: "", hooks: [handler("verify-gate.sh")] }],
      });
      expect(Object.keys(out?.hooks ?? {})).toEqual(["Stop"]);
    });

    it("wraps each handler in the shim and keeps other handler fields", () => {
      const out = buildDevinHooksJson({
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ ...handler("block-no-verify.sh"), timeout: 9 }],
          },
        ],
      });
      expect(out?.hooks.PreToolUse).toEqual([
        {
          matcher: "^(exec)$",
          hooks: [
            {
              type: "command",
              timeout: 9,
              command: `${ROOT}${DEVIN_TOOL_SHIM} ${ROOT}block-no-verify.sh`,
            },
          ],
        },
      ]);
    });

    it("omits a session-source matcher on non-tool events", () => {
      const out = buildDevinHooksJson({
        SessionStart: [
          { matcher: "startup", hooks: [handler("install-pkgs.sh")] },
        ],
      });
      expect(out?.hooks.SessionStart?.[0]).not.toHaveProperty("matcher");
    });
  });
});
