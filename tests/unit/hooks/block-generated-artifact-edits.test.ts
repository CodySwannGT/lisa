/**
 * Tests for block-generated-artifact-edits.sh - the Harper/Fabric PreToolUse
 * hook that refuses direct edits to generated deploy artifacts.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PLUGIN_ROOT = path.resolve("plugins/src/harper-fabric");
const SCRIPT_PATH = path.join(
  PLUGIN_ROOT,
  "hooks/block-generated-artifact-edits.sh"
);
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const envelope = (toolName: string, filePath: string): string =>
  JSON.stringify({
    tool_name: toolName,
    tool_input: { file_path: filePath },
  });

const runHook = (
  toolName: string,
  filePath: string
): { status: number | null; stderr: string } => {
  const result = spawnSync(BASH_PATH, [SCRIPT_PATH], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    input: envelope(toolName, filePath),
    encoding: "utf-8",
  });
  return { status: result.status, stderr: result.stderr };
};

describe("block-generated-artifact-edits.sh", () => {
  it("blocks edits to harper-app/resources.js", () => {
    const { status, stderr } = runHook("Edit", "harper-app/resources.js");

    expect(status).toBe(EXIT_BLOCKED);
    expect(stderr).toContain("TypeScript under src/");
  });

  it("blocks writes to generated web output", () => {
    const { status, stderr } = runHook("Write", "harper-app/web/app.js");

    expect(status).toBe(EXIT_BLOCKED);
    expect(stderr).toContain("harper-app/web/**");
  });

  it("blocks nested generated library output", () => {
    const { status } = runHook(
      "MultiEdit",
      "/repo/harper-app/lib/shared/util.js"
    );

    expect(status).toBe(EXIT_BLOCKED);
  });

  it("allows source edits", () => {
    const { status } = runHook("Edit", "src/harper/resources.ts");

    expect(status).toBe(EXIT_ALLOWED);
  });

  it("allows unrelated Harper deploy source files", () => {
    const { status } = runHook("Edit", "harper-app/config.yaml");

    expect(status).toBe(EXIT_ALLOWED);
  });
});
