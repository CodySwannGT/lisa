/**
 * Unit tests for the hooks installer: script links, rules mirror and the
 * tagged merge of hooks.json.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HOOKS_FILENAME,
  LISA_HOOKS_SUBDIR,
  LISA_RULES_SUBDIR,
  installHooks,
} from "../../../src/codex/hooks-installer.js";
import {
  LISA_ID_MARKER,
  LISA_MANAGED_MARKER,
  parseHooksFile,
} from "../../../src/codex/hooks-merger.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import {
  INJECT_RULES_ID,
  INJECT_RULES_SH,
  BASE_RULES_MD,
  CODING_PHILOSOPHY_MD,
  seedLisaTree,
  HARPER_HOOK_IDS,
} from "./hooks-installer-fixtures.js";

describe("codex/hooks-installer", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(destDir);
    await seedLisaTree(lisaDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("links the inject-rules.sh script into .codex/hooks/lisa/", async () => {
    await installHooks(lisaDir, destDir, []);
    const scriptPath = path.join(
      destDir,
      ".codex",
      LISA_HOOKS_SUBDIR,
      INJECT_RULES_SH
    );
    expect(await fs.pathExists(scriptPath)).toBe(true);
    expect((await fs.lstat(scriptPath)).isSymbolicLink()).toBe(true);
    const content = await fs.readFile(scriptPath, "utf8");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain("lisa-rules");
    // Sanity: it's the Codex variant, not the Claude variant
    expect(content).not.toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("keeps the linked script readable by the bash hook command", async () => {
    await installHooks(lisaDir, destDir, []);
    const scriptPath = path.join(
      destDir,
      ".codex",
      LISA_HOOKS_SUBDIR,
      INJECT_RULES_SH
    );
    expect(await fs.readFile(scriptPath, "utf8")).toContain(
      "#!/usr/bin/env bash"
    );
  });

  it("installs Harper enforcement hooks only for Harper projects", async () => {
    const sourceRoot = path.resolve("plugins", "src", "harper-fabric");
    const pluginRoot = path.join(lisaDir, "plugins", "lisa-harper-fabric");
    await fs.copy(
      path.join(sourceRoot, "hooks"),
      path.join(pluginRoot, "hooks")
    );
    await fs.copyFile(
      path.join(sourceRoot, "generated-artifact-globs.txt"),
      path.join(pluginRoot, "generated-artifact-globs.txt")
    );

    const baseResult = await installHooks(lisaDir, destDir, ["typescript"]);
    expect(baseResult.managedFiles).not.toContain(
      path.join(LISA_HOOKS_SUBDIR, "block-generated-artifact-edits.sh")
    );

    await installHooks(
      lisaDir,
      destDir,
      ["typescript", "harper-fabric"],
      baseResult.managedFiles
    );
    const hooks = parseHooksFile(
      await fs.readFile(path.join(destDir, ".codex", HOOKS_FILENAME), "utf8")
    );
    const hookIds = Object.values(hooks.hooks ?? {})
      .flat()
      .flatMap(group => group.hooks ?? [])
      .map(hook => hook[LISA_ID_MARKER]);
    expect(hookIds).toEqual(expect.arrayContaining([...HARPER_HOOK_IDS]));
    expect(
      await fs.pathExists(
        path.join(
          destDir,
          ".codex",
          LISA_HOOKS_SUBDIR,
          "enforce-config-extensions.mjs"
        )
      )
    ).toBe(true);

    const blockHook = path.join(
      destDir,
      ".codex",
      LISA_HOOKS_SUBDIR,
      "block-generated-artifact-edits.sh"
    );
    const blockResult = boundedSpawnSync({
      label: "the generated-artifact block hook",
      command: blockHook,
      args: [],
      cwd: destDir,
      input: JSON.stringify({
        tool_name: "apply_patch",
        tool_input: {
          command:
            "*** Begin Patch\n*** Update File: harper-app/resources.js\n@@\n-old\n+new\n*** End Patch",
        },
      }),
    });
    expect(blockResult.status).toBe(2);
    expect(blockResult.stderr).toContain("generated Harper/Fabric artifact");
  });

  // Rules-mirror tests (eager/reference split, stack plugins, legacy flat
  // fallback, path collisions) live in hooks-installer-rules-mirror.test.ts
  // to keep this file under the project's max-lines rule.

  it("creates .codex/hooks.json with Lisa SessionStart entries", async () => {
    await installHooks(lisaDir, destDir, []);
    const hooksFilePath = path.join(destDir, ".codex", HOOKS_FILENAME);
    expect(await fs.pathExists(hooksFilePath)).toBe(true);
    const parsed = parseHooksFile(await fs.readFile(hooksFilePath, "utf8"));
    expect(parsed.hooks?.SessionStart).toHaveLength(4);
    const handler = parsed.hooks?.SessionStart?.[0]?.hooks[0];
    expect(handler?.[LISA_MANAGED_MARKER]).toBe(true);
    expect(handler?.[LISA_ID_MARKER]).toBe(INJECT_RULES_ID);
    expect(handler?.command).toContain(INJECT_RULES_SH);
  });

  it("preserves a host-authored hooks.json entry when installing", async () => {
    const codexDir = path.join(destDir, ".codex");
    await fs.ensureDir(codexDir);
    await fs.writeFile(
      path.join(codexDir, HOOKS_FILENAME),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Edit",
              hooks: [
                { type: "command", command: "./scripts/host-edit-hook.sh" },
              ],
            },
          ],
        },
      }),
      "utf8"
    );

    await installHooks(lisaDir, destDir, []);

    const parsed = parseHooksFile(
      await fs.readFile(path.join(codexDir, HOOKS_FILENAME), "utf8")
    );
    expect(parsed.hooks?.PostToolUse).toHaveLength(2);
    expect(parsed.hooks?.PostToolUse?.[0]?.hooks[0]?.command).toBe(
      "./scripts/host-edit-hook.sh"
    );
    // Lisa's SessionStart entries were added alongside
    expect(parsed.hooks?.SessionStart).toHaveLength(4);
  });

  it("idempotent: running twice produces the same hooks.json", async () => {
    await installHooks(lisaDir, destDir, []);
    const first = await fs.readFile(
      path.join(destDir, ".codex", HOOKS_FILENAME),
      "utf8"
    );
    await installHooks(lisaDir, destDir, []);
    const second = await fs.readFile(
      path.join(destDir, ".codex", HOOKS_FILENAME),
      "utf8"
    );
    expect(second).toBe(first);
  });

  it("returns managedFiles list including script + rules + hooks.json", async () => {
    const result = await installHooks(lisaDir, destDir, []);
    // Four startup hooks and three universal shell-policy hooks.
    expect(result.hookEntries).toBe(7);
    const sortedFiles = [...result.managedFiles].sort((a, b) =>
      a.localeCompare(b)
    );
    expect(sortedFiles).toContain(
      path.join(LISA_HOOKS_SUBDIR, INJECT_RULES_SH)
    );
    expect(sortedFiles).toContain(
      path.join(LISA_HOOKS_SUBDIR, "shell-write-nudge.sh")
    );
    expect(sortedFiles).toContain(
      path.join(LISA_RULES_SUBDIR, "eager", BASE_RULES_MD)
    );
    expect(sortedFiles).toContain(
      path.join(LISA_RULES_SUBDIR, "reference", BASE_RULES_MD)
    );
    expect(sortedFiles).toContain(
      path.join(LISA_RULES_SUBDIR, "eager", CODING_PHILOSOPHY_MD)
    );
    expect(sortedFiles).toContain(HOOKS_FILENAME);
  });

  it("handles missing rules directory gracefully", async () => {
    // Remove the rules dir we set up in beforeEach
    await fs.remove(path.join(lisaDir, "plugins", "lisa", "rules"));
    const result = await installHooks(lisaDir, destDir, []);
    // Script + hooks.json still get installed, just no rule files
    expect(result.managedFiles).toContain(
      path.join(LISA_HOOKS_SUBDIR, INJECT_RULES_SH)
    );
    expect(result.managedFiles).toContain(HOOKS_FILENAME);
  });
});
