/* eslint-disable max-lines -- hook catalog coverage shares fixture setup */
/**
 * Unit tests for the hooks installer (script copy + rules mirror + tagged
 * merge of hooks.json).
 */
import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EDIT_PATHS_LIB,
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
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Hook id reused across multiple test cases */
const INJECT_RULES_ID = "inject-rules";
/** Filename of the inject-rules hook script */
const INJECT_RULES_SH = `${INJECT_RULES_ID}.sh`;
/** Rule .md file shipped from the lisa-plugin */
const BASE_RULES_MD = "base-rules.md";
/** Second rule .md file shipped from the lisa-plugin */
const CODING_PHILOSOPHY_MD = "coding-philosophy.md";
/** Hook id for the format-on-edit hook (TypeScript stack) */
const FORMAT_ON_EDIT_ID = "format-on-edit";
/** Hook id for the Rails-stack rubocop-on-edit hook */
const RUBOCOP_ON_EDIT_ID = "rubocop-on-edit";
/** Hook id for the NestJS-stack migration-block hook */
const BLOCK_MIGRATION_EDITS_ID = "block-migration-edits";
/** Hook id for the TypeScript-stack suppression-directive block hook */
const BLOCK_SUPPRESS_DIRECTIVES_ID = "block-suppress-directives";
/** Universal Bash policy hook id */
const BLOCK_NO_VERIFY_ID = "block-no-verify";
/** Universal non-blocking shell write visibility hook id */
const SHELL_WRITE_NUDGE_ID = "shell-write-nudge";
/** Universal dependency bootstrap hook id */
const INSTALL_PKGS_ID = "install-pkgs";
/** Universal Jira configuration hook id */
const SETUP_JIRA_CLI_ID = "setup-jira-cli";
/** Filename of the rubocop-on-edit hook script */
const RUBOCOP_ON_EDIT_SH = `${RUBOCOP_ON_EDIT_ID}.sh`;
/** Harper/Fabric hook IDs that must remain project-local. */
const HARPER_HOOK_IDS = [
  "block-generated-artifact-edits",
  "enforce-config-extensions",
] as const;

describe("codex/hooks-installer", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(destDir);

    // Seed Lisa rules directory with the eager/reference split layout
    // (current shape since the rules-eager-reference-split refactor).
    const rulesDir = path.join(lisaDir, "plugins", "lisa", "rules");
    const eagerDir = path.join(rulesDir, "eager");
    const referenceDir = path.join(rulesDir, "reference");
    await fs.ensureDir(eagerDir);
    await fs.ensureDir(referenceDir);
    await fs.writeFile(
      path.join(eagerDir, BASE_RULES_MD),
      "# Base Rules (load-bearing)\n\nFollow these.\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(referenceDir, BASE_RULES_MD),
      "# Base Rules — full reference\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(eagerDir, CODING_PHILOSOPHY_MD),
      "# Coding Philosophy (load-bearing)\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(referenceDir, CODING_PHILOSOPHY_MD),
      "# Coding Philosophy — full reference\n",
      "utf8"
    );
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
    expect(hookIds).toEqual(expect.arrayContaining(HARPER_HOOK_IDS));
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
    const blockResult = spawnSync(blockHook, [], {
      cwd: destDir,
      encoding: "utf8",
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
    expect(parsed.hooks?.SessionStart).toHaveLength(3);
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
    expect(parsed.hooks?.SessionStart).toHaveLength(3);
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
    // Universal hooks: inject-rules + install-pkgs + setup-jira-cli +
    // block-no-verify + shell-write-nudge = 5 entries
    expect(result.hookEntries).toBe(5);
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

  describe("stack-aware filtering", () => {
    it("ships universal hooks for an empty type set", async () => {
      const result = await installHooks(lisaDir, destDir, []);
      const ids = await readLisaHookIds(destDir);
      expect(ids).toContain(INJECT_RULES_ID);
      expect(ids).toContain(INSTALL_PKGS_ID);
      expect(ids).toContain(SETUP_JIRA_CLI_ID);
      expect(ids).toContain(BLOCK_NO_VERIFY_ID);
      expect(ids).toContain(SHELL_WRITE_NUDGE_ID);
      expect(ids).not.toContain(FORMAT_ON_EDIT_ID);
      expect(ids).not.toContain(RUBOCOP_ON_EDIT_ID);
      expect(ids).not.toContain(BLOCK_MIGRATION_EDITS_ID);
      expect(ids).not.toContain(BLOCK_SUPPRESS_DIRECTIVES_ID);
      expect(result.hookEntries).toBe(5);
    });

    it("ships TypeScript hooks when typescript is detected", async () => {
      const result = await installHooks(lisaDir, destDir, ["typescript"]);
      const ids = await readLisaHookIds(destDir);
      expect(ids).toContain(FORMAT_ON_EDIT_ID);
      expect(ids).toContain("lint-on-edit");
      expect(ids).toContain("sg-scan-on-edit");
      expect(ids).toContain(BLOCK_SUPPRESS_DIRECTIVES_ID);
      // Plus universal
      expect(ids).toContain(INJECT_RULES_ID);
      // NOT rails or nestjs
      expect(ids).not.toContain(RUBOCOP_ON_EDIT_ID);
      expect(ids).not.toContain(BLOCK_MIGRATION_EDITS_ID);
      expect(result.hookEntries).toBe(9);
    });

    it("ships Rails hooks when rails is detected", async () => {
      const result = await installHooks(lisaDir, destDir, ["rails"]);
      const ids = await readLisaHookIds(destDir);
      expect(ids).toContain(RUBOCOP_ON_EDIT_ID);
      // ast-grep scanning applies to Rails too (Ruby files)
      expect(ids).toContain("sg-scan-on-edit");
      expect(ids).not.toContain(FORMAT_ON_EDIT_ID);
      // rubocop + sg-scan + 5 universal
      expect(result.hookEntries).toBe(7);
    });

    it("ships NestJS migration block when nestjs is detected", async () => {
      // NestJS includes typescript via Lisa's hierarchy, but caller passes
      // both explicitly per Lisa's expansion behavior
      const result = await installHooks(lisaDir, destDir, [
        "typescript",
        "nestjs",
      ]);
      const ids = await readLisaHookIds(destDir);
      expect(ids).toContain(BLOCK_MIGRATION_EDITS_ID);
      expect(ids).toContain(FORMAT_ON_EDIT_ID);
      // typescript also brings the suppression-directive block
      expect(ids).toContain(BLOCK_SUPPRESS_DIRECTIVES_ID);
      expect(result.hookEntries).toBe(10);
    });

    it("copies only the script files for applicable hooks", async () => {
      await installHooks(lisaDir, destDir, ["rails"]);
      const hooksDir = path.join(destDir, ".codex", LISA_HOOKS_SUBDIR);
      const scriptFiles = [...(await fs.readdir(hooksDir))].sort((a, b) =>
        a.localeCompare(b)
      );
      // Rails ships rubocop + sg-scan edit hooks, so the shared apply_patch
      // path helper is copied alongside the universal scripts.
      const expected = [
        EDIT_PATHS_LIB,
        "block-no-verify.sh",
        INJECT_RULES_SH,
        "install-pkgs.sh",
        RUBOCOP_ON_EDIT_SH,
        "setup-jira-cli.sh",
        "shell-write-nudge.sh",
        "sg-scan-on-edit.sh",
      ].sort((a, b) => a.localeCompare(b));
      expect(scriptFiles).toEqual(expected);
    });
  });
});

/**
 * Read the Lisa-managed hook ids out of the written hooks.json.
 * @param destDir - Absolute path to the host project root
 * @returns The `_lisaId` of every Lisa-marked handler across every event
 */
async function readLisaHookIds(destDir: string): Promise<readonly string[]> {
  const raw = await fs.readFile(
    path.join(destDir, ".codex", HOOKS_FILENAME),
    "utf8"
  );
  const parsed = parseHooksFile(raw);
  const events = Object.keys(parsed.hooks ?? {});
  return events.flatMap(event => {
    const groups =
      parsed.hooks?.[event as keyof NonNullable<typeof parsed.hooks>] ?? [];
    return groups.flatMap(group =>
      group.hooks
        .filter(handler => handler[LISA_MANAGED_MARKER] === true)
        .map(handler => handler[LISA_ID_MARKER])
        .filter((id): id is string => Boolean(id))
    );
  });
}
/* eslint-enable max-lines -- restore the repository default */
