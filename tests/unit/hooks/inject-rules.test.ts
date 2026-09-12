import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const BASH = "/bin/bash";
const BASE_INJECT_RULES_HOOK = "plugins/src/base/hooks/inject-rules.sh";
const RULE_SENTINEL = "EAGER-RULE-REACHED-SESSION";
/** The only tier an injector reads since #3993 retired the flat fallback. */
const EAGER_TIER = "rules/eager";
/** An unsplit tree: what the retired fallback used to absorb in silence. */
const FLAT_ROOT = "rules";

/** Parsed JSON emitted by Claude context-injection hooks. */
type HookOutput = {
  additionalContext?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
  };
};

const runHookRaw = (
  hookPath: string,
  pluginRoot: string,
  input?: Record<string, unknown>
): string => {
  const result = boundedSpawnSync({
    label: `inject-rules hook ${hookPath}`,
    command: BASH,
    args: [path.resolve(hookPath)],
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    input: input ? JSON.stringify(input) : undefined,
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
};

const runHook = (
  hookPath: string,
  pluginRoot: string,
  input?: Record<string, unknown>
): HookOutput =>
  JSON.parse(runHookRaw(hookPath, pluginRoot, input)) as HookOutput;

const createPluginRoot = (
  rulesSubdir: typeof EAGER_TIER | typeof FLAT_ROOT
): string => {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-inject-rules-"));
  const rulesDir = path.join(root, rulesSubdir);
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(
    path.join(rulesDir, "delivery.md"),
    `${RULE_SENTINEL}\n`,
    "utf8"
  );
  return root;
};

const expectClaudeContextEnvelope = (
  output: HookOutput,
  eventName = "SessionStart"
): void => {
  expect(output.additionalContext).toBeUndefined();
  expect(output.hookSpecificOutput?.hookEventName).toBe(eventName);
  expect(output.hookSpecificOutput?.additionalContext).toContain(RULE_SENTINEL);
};

describe("Claude inject-rules hooks", () => {
  it("emits the Claude-recognized context envelope for base eager rules", () => {
    const output = runHook(
      BASE_INJECT_RULES_HOOK,
      createPluginRoot(EAGER_TIER)
    );

    expectClaudeContextEnvelope(output);
  });

  it("injects nothing from a flat rules/ directory — the fallback is retired", () => {
    // #3993 removed the flat fallback deliberately. It was there for an "older
    // Lisa install", but a plugin's rules and this script ship in one directory
    // and install as one unit, so that skew cannot arise. What it actually did
    // was absorb plugins that never adopted the split — lisa-phaser shipped a
    // flat 11,007-byte rule two weeks AFTER the split commit and no surface
    // reported it. Silence is now impossible: an unsplit tree injects nothing.
    const stdout = runHookRaw(
      BASE_INJECT_RULES_HOOK,
      createPluginRoot(FLAT_ROOT)
    );

    expect(stdout).toBe("");
  });

  it("preserves the SubagentStart event name for base rule injection", () => {
    const output = runHook(
      BASE_INJECT_RULES_HOOK,
      createPluginRoot(EAGER_TIER),
      { hook_event_name: "SubagentStart" }
    );

    expectClaudeContextEnvelope(output, "SubagentStart");
  });

  it("emits the Claude-recognized context envelope for Rails rules", () => {
    const output = runHook(
      "plugins/src/rails/hooks/inject-rules.sh",
      createPluginRoot(EAGER_TIER)
    );

    expectClaudeContextEnvelope(output);
  });

  // Phaser and Harper/Fabric wrap each rule in a named tag on stdout instead of
  // emitting the JSON envelope. That shape is unchanged by #3993; what changed
  // is the tier they read.
  it.each([
    { plugin: "phaser", tag: "lisa-phaser-rule" },
    { plugin: "harper-fabric", tag: "lisa-harper-fabric-rule" },
  ])("injects $plugin's eager tier and nothing else", ({ plugin, tag }) => {
    const hook = `plugins/src/${plugin}/hooks/inject-rules.sh`;

    const eager = runHookRaw(hook, createPluginRoot(EAGER_TIER));
    expect(eager).toContain(RULE_SENTINEL);
    expect(eager).toContain(`<${tag} path=`);

    expect(runHookRaw(hook, createPluginRoot(FLAT_ROOT))).toBe("");
  });
});
