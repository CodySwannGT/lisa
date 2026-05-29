/**
 * Unit tests for the Codex hook filter/emit helpers in
 * scripts/generate-codex-plugin-artifacts.mjs.
 *
 * Locks in two behaviors the Wave 3b Codex hooks emission depends on:
 *   1. filterCodexHooks strips Claude-only commands, rewrites plugin-root paths
 *      to the Codex-relative ./hooks/ form, and drops empty matchers.
 *   2. buildCodexHooksDocument wraps the events block under a top-level "hooks"
 *      key — the root shape Codex's parser expects (HooksFile contract in
 *      src/codex/hooks-merger.ts). A regression here ships hooks Codex ignores.
 * @module tests/unit/scripts/codex-hook-filter
 */
import { describe, expect, it } from "vitest";
import {
  buildCodexHooksDocument,
  filterCodexHooks,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";

/**
 * Build a hook command referencing the Claude plugin root.
 * @param name Hook script filename.
 * @returns A ${CLAUDE_PLUGIN_ROOT}-prefixed command string.
 */
const PLUGIN_ROOT_CMD = (name: string): string =>
  `\${CLAUDE_PLUGIN_ROOT}/hooks/${name}`;
const ENTIRE_CMD =
  "command -v entire >/dev/null 2>&1 && entire hooks claude-code session-start || true";

/**
 * Build a single-event Claude hooks block for one command.
 * @param event Hook event name (e.g. PreToolUse).
 * @param matcher Matcher string for the entry.
 * @param command Command the lone handler runs.
 * @returns A minimal hooks block shaped like a Claude plugin manifest's hooks.
 */
const blockWith = (
  event: string,
  matcher: string,
  command: string
): Record<string, unknown> => ({
  [event]: [{ matcher, hooks: [{ type: "command", command }] }],
});

describe("generate-codex-plugin-artifacts: filterCodexHooks", () => {
  it("returns null for a missing or non-object hooks block", () => {
    expect(filterCodexHooks(undefined as unknown as object)).toBeNull();
    expect(filterCodexHooks(null as unknown as object)).toBeNull();
    expect(filterCodexHooks("nope" as unknown as object)).toBeNull();
  });

  it("rewrites ${CLAUDE_PLUGIN_ROOT}/hooks/ to the Codex-relative ./hooks/ form", () => {
    const out = filterCodexHooks(
      blockWith("PreToolUse", "Bash", PLUGIN_ROOT_CMD("block-no-verify.sh"))
    ) as Record<string, { hooks: { command: string }[] }[]>;
    expect(out["PreToolUse"][0].hooks[0].command).toBe(
      "./hooks/block-no-verify.sh"
    );
  });

  it("drops `entire hooks claude-code *` commands (Claude-only)", () => {
    expect(
      filterCodexHooks(blockWith("SessionEnd", "", ENTIRE_CMD))
    ).toBeNull();
  });

  it("drops enforce-team-first.sh (Claude-team-specific)", () => {
    expect(
      filterCodexHooks(
        blockWith("SessionStart", "", PLUGIN_ROOT_CMD("enforce-team-first.sh"))
      )
    ).toBeNull();
  });

  it("drops matchers whose handlers were all stripped but keeps surviving events", () => {
    const block = {
      SessionStart: [
        { matcher: "", hooks: [{ type: "command", command: ENTIRE_CMD }] },
      ],
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: PLUGIN_ROOT_CMD("block-no-verify.sh"),
            },
          ],
        },
      ],
    };
    const out = filterCodexHooks(block) as Record<string, unknown>;
    expect("SessionStart" in out).toBe(false);
    expect("PreToolUse" in out).toBe(true);
  });

  it("ships unknown command shapes verbatim", () => {
    const out = filterCodexHooks(
      blockWith("PreToolUse", "Bash", "echo custom")
    ) as Record<string, { hooks: { command: string }[] }[]>;
    expect(out["PreToolUse"][0].hooks[0].command).toBe("echo custom");
  });
});

describe("generate-codex-plugin-artifacts: buildCodexHooksDocument", () => {
  it("nests the events block under a top-level hooks key", () => {
    const filtered = { PreToolUse: [{ matcher: "Bash", hooks: [] }] };
    expect(buildCodexHooksDocument(filtered)).toEqual({ hooks: filtered });
  });

  it("does not place events at the document root", () => {
    const filtered = { Stop: [{ matcher: "", hooks: [] }] };
    const doc = buildCodexHooksDocument(filtered) as Record<string, unknown>;
    expect("Stop" in doc).toBe(false);
    expect("hooks" in doc).toBe(true);
  });
});
