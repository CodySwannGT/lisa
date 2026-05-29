/**
 * Direct unit tests for `buildCursorHooksJson` (and the command-path rewrite it
 * applies) from scripts/lib/per-agent-hook-filter.mjs — issue #1055, review
 * gap A. The function had only indirect coverage via the generator's
 * committed-artifact regression; this pins its behavior on its own.
 *
 * (Lives in a dedicated file rather than per-agent-hook-filter.test.ts because
 * that file is already near the `max-lines` cap.)
 * @module tests/unit/scripts/build-cursor-hooks-json
 */
import { describe, expect, it } from "vitest";
import { buildCursorHooksJson } from "../../../scripts/lib/per-agent-hook-filter.mjs";

const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}/hooks/";
const BLOCK_NO_VERIFY = "block-no-verify.sh";
const INSTALL_PKGS = "install-pkgs.sh";
const INJECT_RULES = "inject-rules.sh";
// Expected Cursor plugin-root command paths (post toCursorCommandPath rewrite —
// plugin hooks run with the project root as cwd, so the ${CURSOR_PLUGIN_ROOT}
// token is required; a bare ./ would not resolve / could be shadowed).
const BLOCK_CMD = "${CURSOR_PLUGIN_ROOT}/hooks/block-no-verify.sh";
const INSTALL_CMD = "${CURSOR_PLUGIN_ROOT}/hooks/install-pkgs.sh";

/**
 *
 */
type HookBlock = Parameters<typeof buildCursorHooksJson>[0];

// A Claude-format matcher-group: { matcher?, hooks: [{ type, command }] }.
const group = (matcher: string | undefined, ...scripts: readonly string[]) => ({
  ...(matcher === undefined ? {} : { matcher }),
  hooks: scripts.map(s => ({ type: "command", command: `${PLUGIN_ROOT}${s}` })),
});

describe("buildCursorHooksJson", () => {
  it("returns undefined for non-object input", () => {
    for (const bad of [null, undefined, "nope", 42]) {
      expect(buildCursorHooksJson(bad as unknown as HookBlock)).toBeUndefined();
    }
  });

  it("wraps surviving hooks as {version:1, hooks:{…}} with camelCase event keys", () => {
    const out = buildCursorHooksJson({
      PreToolUse: [group("Bash", BLOCK_NO_VERIFY)],
    });
    expect(out).toEqual({
      version: 1,
      hooks: {
        preToolUse: [{ command: BLOCK_CMD, matcher: "Bash" }],
      },
    });
  });

  it("translates PreCompact → preCompact", () => {
    const out = buildCursorHooksJson({
      PreCompact: [group("", BLOCK_NO_VERIFY)],
    });
    expect(out).toBeDefined();
    expect(Object.keys((out as { hooks: object }).hooks)).toContain(
      "preCompact"
    );
  });

  it("includes matcher only when present; omits the key when matcher is empty/absent", () => {
    const out = buildCursorHooksJson({
      PreToolUse: [group("Bash", BLOCK_NO_VERIFY)], // truthy matcher → kept
      SessionStart: [group(undefined, INSTALL_PKGS)], // no matcher → omitted
      PostToolUse: [group("", BLOCK_NO_VERIFY)], // empty-string matcher → omitted
    }) as { hooks: Record<string, Array<Record<string, unknown>>> };
    expect(out.hooks.preToolUse[0]).toEqual({
      command: BLOCK_CMD,
      matcher: "Bash",
    });
    expect(out.hooks.sessionStart[0]).toEqual({ command: INSTALL_CMD });
    expect("matcher" in out.hooks.sessionStart[0]).toBe(false);
    expect("matcher" in out.hooks.postToolUse[0]).toBe(false);
  });

  it("drops an event that is empty after cursor filtering (inject-rules stripped)", () => {
    const out = buildCursorHooksJson({
      SessionStart: [group("", INJECT_RULES)], // stripped on cursor → event empties
      PreToolUse: [group("Bash", BLOCK_NO_VERIFY)],
    }) as { hooks: Record<string, unknown> };
    expect("sessionStart" in out.hooks).toBe(false);
    expect("preToolUse" in out.hooks).toBe(true);
  });

  it("returns undefined when ALL events are empty after filtering", () => {
    expect(
      buildCursorHooksJson({ SessionStart: [group("", INJECT_RULES)] })
    ).toBeUndefined();
  });

  it("rewrites the ${CLAUDE_PLUGIN_ROOT}/ prefix to ${CURSOR_PLUGIN_ROOT}/ (toCursorCommandPath)", () => {
    const out = buildCursorHooksJson({
      PreToolUse: [group("Bash", BLOCK_NO_VERIFY)],
    }) as { hooks: Record<string, Array<{ command: string }>> };
    expect(out.hooks.preToolUse[0].command).toBe(BLOCK_CMD);
    expect(out.hooks.preToolUse[0].command).not.toContain("CLAUDE_PLUGIN_ROOT");
    expect(out.hooks.preToolUse[0].command).toContain("${CURSOR_PLUGIN_ROOT}/");
  });
});
