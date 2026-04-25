/**
 * Unit tests for the hooks installer (script copy + rules mirror + tagged
 * merge of hooks.json).
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
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Hook id reused across multiple test cases */
const INJECT_RULES_ID = "inject-rules";
/** Filename of the inject-rules hook script */
const INJECT_RULES_SH = `${INJECT_RULES_ID}.sh`;
/** Rule .md file shipped from the lisa-plugin */
const BASE_RULES_MD = "base-rules.md";
/** Second rule .md file shipped from the lisa-plugin */
const CODING_PHILOSOPHY_MD = "coding-philosophy.md";
/** Hook id for the universal Stop-event ntfy notifier */
const NOTIFY_NTFY_ID = "notify-ntfy";
/** Hook id for the format-on-edit hook (TypeScript stack) */
const FORMAT_ON_EDIT_ID = "format-on-edit";
/** Hook id for the Rails-stack rubocop-on-edit hook */
const RUBOCOP_ON_EDIT_ID = "rubocop-on-edit";
/** Hook id for the NestJS-stack migration-block hook */
const BLOCK_MIGRATION_EDITS_ID = "block-migration-edits";
/** Filename of the notify-ntfy hook script */
const NOTIFY_NTFY_SH = `${NOTIFY_NTFY_ID}.sh`;
/** Filename of the rubocop-on-edit hook script */
const RUBOCOP_ON_EDIT_SH = `${RUBOCOP_ON_EDIT_ID}.sh`;

describe("codex/hooks-installer", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(destDir);

    // Seed Lisa rules directory
    const rulesDir = path.join(lisaDir, "plugins", "lisa", "rules");
    await fs.ensureDir(rulesDir);
    await fs.writeFile(
      path.join(rulesDir, BASE_RULES_MD),
      "# Base Rules\n\nFollow these.\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(rulesDir, CODING_PHILOSOPHY_MD),
      "# Coding Philosophy\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("copies the inject-rules.sh script to .codex/hooks/lisa/", async () => {
    await installHooks(lisaDir, destDir, []);
    const scriptPath = path.join(
      destDir,
      ".codex",
      LISA_HOOKS_SUBDIR,
      INJECT_RULES_SH
    );
    expect(await fs.pathExists(scriptPath)).toBe(true);
    const content = await fs.readFile(scriptPath, "utf8");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain("lisa-rules");
    // Sanity: it's the Codex variant, not the Claude variant
    expect(content).not.toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("makes the script executable", async () => {
    await installHooks(lisaDir, destDir, []);
    const scriptPath = path.join(
      destDir,
      ".codex",
      LISA_HOOKS_SUBDIR,
      INJECT_RULES_SH
    );
    const stat = await fs.stat(scriptPath);
    // Owner execute bit set

    expect(stat.mode & 0o100).toBe(0o100);
  });

  it("mirrors Lisa rules into .codex/lisa-rules/", async () => {
    await installHooks(lisaDir, destDir, []);
    const rulesDir = path.join(destDir, ".codex", LISA_RULES_SUBDIR);
    expect(await fs.pathExists(path.join(rulesDir, BASE_RULES_MD))).toBe(true);
    expect(await fs.pathExists(path.join(rulesDir, CODING_PHILOSOPHY_MD))).toBe(
      true
    );
    const baseRules = await fs.readFile(
      path.join(rulesDir, BASE_RULES_MD),
      "utf8"
    );
    expect(baseRules).toContain("# Base Rules");
  });

  it("creates .codex/hooks.json with one Lisa SessionStart entry", async () => {
    await installHooks(lisaDir, destDir, []);
    const hooksFilePath = path.join(destDir, ".codex", HOOKS_FILENAME);
    expect(await fs.pathExists(hooksFilePath)).toBe(true);
    const parsed = parseHooksFile(await fs.readFile(hooksFilePath, "utf8"));
    expect(parsed.hooks?.SessionStart).toHaveLength(1);
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
    expect(parsed.hooks?.PostToolUse).toHaveLength(1);
    expect(parsed.hooks?.PostToolUse?.[0]?.hooks[0]?.command).toBe(
      "./scripts/host-edit-hook.sh"
    );
    // Lisa's SessionStart entry was added alongside
    expect(parsed.hooks?.SessionStart).toHaveLength(1);
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
    // Universal hooks: inject-rules + notify-ntfy = 2 entries
    expect(result.hookEntries).toBe(2);
    const sortedFiles = [...result.managedFiles].sort((a, b) =>
      a.localeCompare(b)
    );
    expect(sortedFiles).toContain(
      path.join(LISA_HOOKS_SUBDIR, INJECT_RULES_SH)
    );
    expect(sortedFiles).toContain(path.join(LISA_HOOKS_SUBDIR, NOTIFY_NTFY_SH));
    expect(sortedFiles).toContain(path.join(LISA_RULES_SUBDIR, BASE_RULES_MD));
    expect(sortedFiles).toContain(
      path.join(LISA_RULES_SUBDIR, CODING_PHILOSOPHY_MD)
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
      expect(ids).toContain(NOTIFY_NTFY_ID);
      expect(ids).not.toContain(FORMAT_ON_EDIT_ID);
      expect(ids).not.toContain(RUBOCOP_ON_EDIT_ID);
      expect(ids).not.toContain(BLOCK_MIGRATION_EDITS_ID);
      expect(result.hookEntries).toBe(2);
    });

    it("ships TypeScript hooks when typescript is detected", async () => {
      const result = await installHooks(lisaDir, destDir, ["typescript"]);
      const ids = await readLisaHookIds(destDir);
      expect(ids).toContain(FORMAT_ON_EDIT_ID);
      expect(ids).toContain("lint-on-edit");
      expect(ids).toContain("sg-scan-on-edit");
      // Plus universal
      expect(ids).toContain(INJECT_RULES_ID);
      expect(ids).toContain(NOTIFY_NTFY_ID);
      // NOT rails or nestjs
      expect(ids).not.toContain(RUBOCOP_ON_EDIT_ID);
      expect(ids).not.toContain(BLOCK_MIGRATION_EDITS_ID);
      expect(result.hookEntries).toBe(5);
    });

    it("ships Rails hooks when rails is detected", async () => {
      const result = await installHooks(lisaDir, destDir, ["rails"]);
      const ids = await readLisaHookIds(destDir);
      expect(ids).toContain(RUBOCOP_ON_EDIT_ID);
      expect(ids).not.toContain(FORMAT_ON_EDIT_ID);
      expect(result.hookEntries).toBe(3);
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
      expect(result.hookEntries).toBe(6);
    });

    it("copies only the script files for applicable hooks", async () => {
      await installHooks(lisaDir, destDir, ["rails"]);
      const hooksDir = path.join(destDir, ".codex", LISA_HOOKS_SUBDIR);
      const scriptFiles = [...(await fs.readdir(hooksDir))].sort((a, b) =>
        a.localeCompare(b)
      );
      expect(scriptFiles).toEqual([
        INJECT_RULES_SH,
        NOTIFY_NTFY_SH,
        RUBOCOP_ON_EDIT_SH,
      ]);
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
