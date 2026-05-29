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
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCodexHooksDocument,
  componentPointers,
  emitCodexHooks,
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
const BLOCK_NO_VERIFY = "block-no-verify.sh";
const HOOKS_JSON = "hooks.json";
const CODEX_PLUGIN_DIR = ".codex-plugin";
const HOOKS_DIR = "hooks";

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

  it("rewrites ${CLAUDE_PLUGIN_ROOT}/hooks/ to Codex's ${PLUGIN_ROOT}/hooks/ form", () => {
    const out = filterCodexHooks(
      blockWith("PreToolUse", "Bash", PLUGIN_ROOT_CMD(BLOCK_NO_VERIFY))
    ) as Record<string, { hooks: { command: string }[] }[]>;
    expect(out["PreToolUse"][0].hooks[0].command).toBe(
      "${PLUGIN_ROOT}/hooks/block-no-verify.sh"
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
              command: PLUGIN_ROOT_CMD(BLOCK_NO_VERIFY),
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

describe("generate-codex-plugin-artifacts: emitCodexHooks placement (issue #1058)", () => {
  let pluginDir: string;

  const hooksSubdirJson = (): string =>
    path.join(pluginDir, HOOKS_DIR, HOOKS_JSON);
  const codexJson = (): string =>
    path.join(pluginDir, CODEX_PLUGIN_DIR, HOOKS_JSON);

  beforeEach(async () => {
    pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-hooks-"));
    await fs.ensureDir(path.join(pluginDir, ".claude-plugin"));
    await fs.ensureDir(path.join(pluginDir, HOOKS_DIR));
  });

  afterEach(async () => {
    await fs.remove(pluginDir);
  });

  const manifestWithHooks = {
    hooks: blockWith("PreToolUse", "Bash", PLUGIN_ROOT_CMD(BLOCK_NO_VERIFY)),
  };

  it("writes the Codex hooks.json under .codex-plugin/, NOT hooks/hooks.json", () => {
    emitCodexHooks(pluginDir, manifestWithHooks);
    // hooks/hooks.json is Claude Code's auto-discovery path; a ${PLUGIN_ROOT}
    // file there breaks Claude startup (the #1058 regression).
    expect(fs.existsSync(hooksSubdirJson())).toBe(false);
    expect(fs.existsSync(codexJson())).toBe(true);
    // The file at the new path must be the real, correctly-shaped document:
    // events nested under a top-level `hooks` key with the command rewritten to
    // the ${PLUGIN_ROOT} form — not an empty/malformed file at the right path.
    const doc = fs.readJsonSync(codexJson()) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    expect(doc.hooks.PreToolUse[0].hooks[0].command).toBe(
      `\${PLUGIN_ROOT}/hooks/${BLOCK_NO_VERIFY}`
    );
  });

  it("purges a stale hooks/hooks.json left by an older build", () => {
    fs.writeJsonSync(hooksSubdirJson(), { hooks: {} });
    emitCodexHooks(pluginDir, manifestWithHooks);
    expect(fs.existsSync(hooksSubdirJson())).toBe(false);
  });

  it("points the manifest hooks field at the plugin-root-relative .codex-plugin path", () => {
    emitCodexHooks(pluginDir, manifestWithHooks);
    expect(componentPointers(pluginDir).hooks).toBe(
      "./.codex-plugin/hooks.json"
    );
  });

  it("omits the hooks pointer when no hooks survive the filter", () => {
    emitCodexHooks(pluginDir, {
      hooks: blockWith("SessionEnd", "", ENTIRE_CMD),
    });
    expect(fs.existsSync(codexJson())).toBe(false);
    expect("hooks" in componentPointers(pluginDir)).toBe(false);
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
