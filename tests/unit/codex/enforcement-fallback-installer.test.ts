/** Regression coverage for repository-scoped Codex enforcement delivery. */
import * as fs from "fs-extra";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODEX_ENFORCEMENT_FALLBACK_ID,
  installCodexEnforcementFallback,
} from "../../../src/codex/enforcement-fallback-installer.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOKS_PATH = path.join(".codex", "hooks.json");
const DISPATCHER_COMMAND =
  '/bin/bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/lisa-enforcement-fallback.sh"';
const TOOL_MATCHER = "Bash|Edit|Write|apply_patch";

describe("codex/enforcement-fallback-installer", () => {
  let destDir: string;

  beforeEach(async () => {
    destDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(destDir));

  it("installs one tagged fallback while preserving host hooks", async () => {
    await fs.outputJson(path.join(destDir, HOOKS_PATH), {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "host-check" }],
          },
        ],
      },
    });

    const result = await installCodexEnforcementFallback(destDir);
    const written = await fs.readJson(path.join(destDir, HOOKS_PATH));

    expect(result).toEqual({
      managedFiles: ["hooks.json"],
      hookEntries: 1,
    });
    expect(written).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "host-check" }],
          },
          {
            matcher: TOOL_MATCHER,
            hooks: [
              {
                type: "command",
                command: DISPATCHER_COMMAND,
                _lisaManaged: true,
                _lisaId: CODEX_ENFORCEMENT_FALLBACK_ID,
                timeout: 30,
                statusMessage: "Checking Lisa enforcement policy",
              },
            ],
          },
        ],
      },
    });
  });

  it("is idempotent", async () => {
    await installCodexEnforcementFallback(destDir);
    const first = await fs.readFile(path.join(destDir, HOOKS_PATH), "utf8");

    await installCodexEnforcementFallback(destDir);
    const second = await fs.readFile(path.join(destDir, HOOKS_PATH), "utf8");

    expect(second).toBe(first);
  });

  it.each([
    ["git push --no-verify", 2],
    ["git status --short", 0],
  ])(
    "drives %s to status %i through the installed handler",
    async (command, status) => {
      await installHostScripts(destDir);
      await installCodexEnforcementFallback(destDir);
      const hooks = await fs.readJson(path.join(destDir, HOOKS_PATH));
      const handler = hooks.hooks.PreToolUse.find(
        (entry: { matcher?: string }) => entry.matcher === TOOL_MATCHER
      ).hooks[0] as { command: string };

      const run = boundedSpawnSync({
        label: "installed Codex enforcement fallback",
        command: "/bin/bash",
        args: ["-c", handler.command],
        cwd: destDir,
        input: JSON.stringify({
          tool_name: "Bash",
          tool_input: { command },
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: "" },
      });

      expect(run.status).toBe(status);
    }
  );
});

/**
 * Give the generated hook the same repository layout `lisa apply` produces.
 * @param destDir Temporary host repository root.
 */
async function installHostScripts(destDir: string): Promise<void> {
  await fs.copy(
    path.join(REPO_ROOT, "all", "copy-overwrite", "scripts"),
    path.join(destDir, "scripts")
  );
  const init = boundedSpawnSync({
    label: "temporary host git init",
    command: "git",
    args: ["init", "--quiet"],
    cwd: destDir,
  });
  expect(init.status).toBe(0);
  expect(
    readFileSync(
      path.join(destDir, "scripts", "lisa-enforcement-fallback.sh"),
      "utf8"
    )
  ).toContain("block-no-verify");
}
