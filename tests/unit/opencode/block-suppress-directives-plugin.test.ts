/**
 * Growth semantics for OpenCode's `block-suppress-directives` port
 * (CodySwannGT/lisa#4492), driven through the same case table as the Claude
 * and Codex shell hooks so the three copies agree on what "growth" is.
 *
 * OpenCode has `edit` (oldString/newString) and `write` (content) but no
 * MultiEdit, so the MultiEdit cases have no equivalent here. The template runs
 * under Bun, the runtime OpenCode loads it in.
 * @module tests/unit/opencode/block-suppress-directives-plugin
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import {
  GROWTH_CASES,
  prepareDisk,
  RUNS_AS_ROOT,
} from "../../helpers/suppress-directive-growth-cases.js";
import type { Call } from "../../helpers/suppress-directive-growth-cases.js";

useIoLatencyBudget();

const PLUGIN_PATH = path.resolve(
  "src/opencode/plugin-templates/lisa-block-suppress-directives.ts"
);
const BUN_PATH = boundedSpawnSync({
  label: "which bun",
  command: "/usr/bin/which",
  args: ["bun"],
}).stdout.trim();

/**
 * The OpenCode tool name and args for a shell-hook case's call.
 * @param filePath The path the tool targets.
 * @param call The case's tool call; MultiEdit has no OpenCode equivalent.
 * @returns The tool and its args.
 */
const toOpenCode = (
  filePath: string,
  call: Exclude<Call, { tool: "MultiEdit" }>
): { tool: string; args: Record<string, string> } =>
  call.tool === "Write"
    ? { tool: "write", args: { filePath, content: call.content } }
    : {
        tool: "edit",
        args: {
          filePath,
          newString: call.edit.newText,
          ...(call.edit.oldText === undefined
            ? {}
            : { oldString: call.edit.oldText }),
        },
      };

/**
 * Runs the plugin's before-hook once and reports whether it cancelled the call.
 * @param directory The OpenCode project directory the plugin is created with.
 * @param invocation The tool and args.
 * @param invocation.tool The OpenCode tool name.
 * @param invocation.args The tool args.
 * @returns Whether the hook threw (refused) and its message.
 */
const invoke = (
  directory: string,
  invocation: { tool: string; args: Record<string, string> }
): { refused: boolean; message: string } => {
  const program = `
    const imported = await import("file://" + process.env.PLUGIN_PATH);
    const plugin = await imported.LisaBlockSuppressDirectives({ directory: process.env.PROJECT_DIR });
    const call = JSON.parse(process.env.CALL);
    try {
      await plugin["tool.execute.before"]({ tool: call.tool }, { args: call.args });
      console.log(JSON.stringify({ refused: false, message: "" }));
    } catch (error) {
      console.log(JSON.stringify({ refused: true, message: String(error.message) }));
    }
  `;
  const result = boundedSpawnSync({
    label: "bun invoking the block-suppress-directives plugin",
    command: BUN_PATH,
    args: ["-e", program],
    baseMs: 30_000,
    env: {
      ...process.env,
      PLUGIN_PATH,
      PROJECT_DIR: directory,
      CALL: JSON.stringify(invocation),
    },
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim()) as {
    refused: boolean;
    message: string;
  };
};

describe("OpenCode block-suppress-directives plugin growth", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "lisa-opencode-suppress-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const cases = GROWTH_CASES.filter(
    (
      growthCase
    ): growthCase is typeof growthCase & {
      call: Exclude<Call, { tool: "MultiEdit" }>;
    } => growthCase.call.tool !== "MultiEdit"
  );

  it.each(cases)("$name", growthCase => {
    if (growthCase.disk.kind === "unreadable" && RUNS_AS_ROOT) return;
    const target = prepareDisk(dir, growthCase.disk);
    const { refused, message } = invoke(
      dir,
      toOpenCode(target, growthCase.call)
    );
    expect(refused).toBe(growthCase.refused);
    if (refused) expect(message).toContain("block-suppress-directives");
  });

  it("reads a relative write path against the project directory", () => {
    const [keeps] = cases;
    if (keeps?.call.tool !== "Write") throw new Error("case 0 is a Write");
    prepareDisk(dir, keeps.disk);
    expect(invoke(dir, toOpenCode("target.ts", keeps.call)).refused).toBe(
      false
    );
  });
});
