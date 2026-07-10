/** Regression coverage for retiring duplicate project Codex hooks. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retireProjectHooks } from "../../../src/codex/project-hooks-cleanup.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CODEX_DIR = ".codex";
const LISA_RULES = "lisa-rules";

describe("codex/project-hooks-cleanup", () => {
  let destDir: string;

  beforeEach(async () => {
    destDir = await createTempDir();
  });

  afterEach(async () => cleanupTempDir(destDir));

  it("removes Lisa handlers and directories while preserving host hooks", async () => {
    const hooksPath = path.join(destDir, CODEX_DIR, "hooks.json");
    await fs.outputJson(hooksPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "host-check" },
              {
                type: "command",
                command: "lisa-check",
                _lisaManaged: true,
                _lisaId: "legacy",
              },
            ],
          },
        ],
      },
    });
    await fs.outputFile(
      path.join(destDir, CODEX_DIR, "hooks", "lisa", "legacy.sh"),
      "legacy\n"
    );
    await fs.outputFile(
      path.join(destDir, CODEX_DIR, LISA_RULES, "eager", "legacy.md"),
      "legacy\n"
    );

    const result = await retireProjectHooks(destDir, [
      path.join("hooks", "lisa", "legacy.sh"),
      path.join(LISA_RULES, "eager", "legacy.md"),
    ]);
    const written = await fs.readJson(hooksPath);
    expect(written.hooks.PreToolUse[0].hooks).toEqual([
      { type: "command", command: "host-check" },
    ]);
    expect(
      await fs.pathExists(path.join(destDir, CODEX_DIR, "hooks", "lisa"))
    ).toBe(false);
    expect(await fs.pathExists(path.join(destDir, CODEX_DIR, LISA_RULES))).toBe(
      false
    );
    expect(result.deleted).toHaveLength(2);
  });
});
