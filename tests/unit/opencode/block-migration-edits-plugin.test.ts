/**
 * OpenCode's migration adapter WARNS and permits (operator decision,
 * 2026-11-08). `tool.execute.before` can only cancel a call, so the adapter
 * moved to `tool.execute.after` and appends the warning to the tool output the
 * agent reads. These cases execute the template under Bun, the runtime
 * OpenCode loads it in.
 * @module tests/unit/opencode/block-migration-edits-plugin
 */
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const PLUGIN_PATH = path.resolve(
  "src/opencode/plugin-templates/lisa-block-migration-edits.ts"
);
const TOOL_OUTPUT = "Edit applied.";
const BUN_PATH = boundedSpawnSync({
  label: "which bun",
  command: "/usr/bin/which",
  args: ["bun"],
}).stdout.trim();

/**
 * Runs both plugin hooks for one tool call and reports what the agent sees.
 * @param tool - The OpenCode tool name.
 * @param filePath - The file the tool wrote.
 * @returns JSON with the hook keys and the tool output after the hook ran.
 */
const invoke = (
  tool: string,
  filePath: string
): { keys: string[]; output: string } => {
  const program = `
    const imported = await import("file://" + process.env.PLUGIN_PATH);
    const plugin = await imported.LisaBlockMigrationEdits();
    const output = { output: process.env.TOOL_OUTPUT };
    await plugin["tool.execute.after"](
      { tool: process.env.TEST_TOOL, args: { filePath: process.env.TEST_FILE } },
      output
    );
    console.log(JSON.stringify({ keys: Object.keys(plugin), output: output.output }));
  `;
  const result = boundedSpawnSync({
    label: "bun invoking the block-migration-edits plugin",
    command: BUN_PATH,
    args: ["-e", program],
    baseMs: 30_000,
    env: {
      ...process.env,
      PLUGIN_PATH,
      TEST_TOOL: tool,
      TEST_FILE: filePath,
      TOOL_OUTPUT,
    },
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim()) as { keys: string[]; output: string };
};

describe("OpenCode block-migration-edits plugin", () => {
  const MIGRATION = "/p/src/database/migrations/1700000000000-CreateUsers.ts";

  it("never registers a before-hook, so it cannot cancel the edit", () => {
    expect(invoke("edit", MIGRATION).keys).toEqual(["tool.execute.after"]);
  });

  it.each(["edit", "write"])(
    "appends the entity-first warning after a %s to a migration",
    tool => {
      const { output } = invoke(tool, MIGRATION);
      expect(output.startsWith(TOOL_OUTPUT)).toBe(true);
      expect(output).toContain(MIGRATION);
      expect(output).toContain("source of truth");
      expect(output).toContain("bun run migration:generate --name=<Name>");
      expect(output).toContain("writing the migration directly is fine");
      expect(output).toContain("class comment");
    }
  );

  it("leaves the output alone for a non-migration file", () => {
    expect(invoke("edit", "/p/src/users.entity.ts").output).toBe(TOOL_OUTPUT);
  });

  it("leaves the output alone for a tool that is not edit or write", () => {
    expect(invoke("read", MIGRATION).output).toBe(TOOL_OUTPUT);
  });
});
