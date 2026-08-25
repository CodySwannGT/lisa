/**
 * Runtime contract tests for OpenCode's parity-safety-net adapter. The fixture
 * copies the adapter and canonical policy files exactly as installHooks does,
 * then invokes the OpenCode before-hook under Bun.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const TEMPLATE_DIR = path.join(
  process.cwd(),
  "src",
  "opencode",
  "plugin-templates"
);
const HOOK_DIR = path.join(process.cwd(), "plugins", "src", "base", "hooks");
const BUN_PATH = boundedSpawnSync({
  label: "which bun",
  command: "/usr/bin/which",
  args: ["bun"],
}).stdout.trim();

describe("OpenCode parity-safety-net plugin", () => {
  let tempDir: string;
  let pluginPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    pluginPath = path.join(tempDir, "lisa-parity-safety-net.ts");
    await fs.copy(
      path.join(TEMPLATE_DIR, "lisa-parity-safety-net.ts"),
      pluginPath
    );
    for (const filename of [
      "parity-safety-net.sh",
      "parity-safety-net-heredoc.py",
    ]) {
      await fs.copy(
        path.join(HOOK_DIR, filename),
        path.join(tempDir, filename)
      );
    }
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  const invoke = (command: string): string => {
    const program = `
      const imported = await import(${JSON.stringify("file://PLACEHOLDER")}.replace("PLACEHOLDER", process.env.PLUGIN_PATH));
      const plugin = await imported.LisaParitySafetyNet();
      try {
        await plugin["tool.execute.before"](
          { tool: "bash" },
          { args: { command: process.env.TEST_COMMAND } }
        );
        console.log("allow");
      } catch (error) {
        console.log("deny:" + String(error?.message ?? error));
      }
    `;
    const result = boundedSpawnSync({
      label: "bun invoking the parity-safety-net plugin",
      command: BUN_PATH,
      args: ["-e", program],
      baseMs: 30_000,
      cwd: tempDir,
      env: { ...process.env, PLUGIN_PATH: pluginPath, TEST_COMMAND: command },
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };

  it("throws to block destructive bash calls", () => {
    expect(invoke("rm -rf /")).toContain("deny:Blocked by safety-net");
  });

  it("allows ordinary bash calls", () => {
    expect(invoke("git status --short")).toBe("allow");
  });

  it("preserves the safe GitHub heredoc exemption", () => {
    expect(
      invoke(
        "gh issue comment 1594 --body-file - <<'EOF'\nrm -rf / is prose\nEOF"
      )
    ).toBe("allow");
  });
});
