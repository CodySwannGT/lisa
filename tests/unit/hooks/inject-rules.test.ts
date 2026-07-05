import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const BASH = "/bin/bash";
const BASE_INJECT_RULES_HOOK = "plugins/src/base/hooks/inject-rules.sh";
const RULE_SENTINEL = "EAGER-RULE-REACHED-SESSION";

/** Parsed JSON emitted by Claude context-injection hooks. */
type HookOutput = {
  additionalContext?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
  };
};

const runHook = (
  hookPath: string,
  pluginRoot: string,
  input?: Record<string, unknown>
): HookOutput => {
  const result = spawnSync(BASH, [path.resolve(hookPath)], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    input: input ? JSON.stringify(input) : undefined,
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as HookOutput;
};

const createPluginRoot = (rulesSubdir: "rules" | "rules/eager"): string => {
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
      createPluginRoot("rules/eager")
    );

    expectClaudeContextEnvelope(output);
  });

  it("keeps base backward compatibility for flat rule directories", () => {
    const output = runHook(BASE_INJECT_RULES_HOOK, createPluginRoot("rules"));

    expectClaudeContextEnvelope(output);
  });

  it("preserves the SubagentStart event name for base rule injection", () => {
    const output = runHook(
      BASE_INJECT_RULES_HOOK,
      createPluginRoot("rules/eager"),
      { hook_event_name: "SubagentStart" }
    );

    expectClaudeContextEnvelope(output, "SubagentStart");
  });

  it("emits the Claude-recognized context envelope for Rails rules", () => {
    const output = runHook(
      "plugins/src/rails/hooks/inject-rules.sh",
      createPluginRoot("rules")
    );

    expectClaudeContextEnvelope(output);
  });
});
