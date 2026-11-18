/**
 * Unit tests for the hooks installer: stack-aware hook filtering.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RAILS_HOOK_ENGINE_FILES } from "../../../scripts/lib/rails-hooks.mjs";
import {
  EDIT_GATE_LIB,
  EDIT_PATHS_LIB,
  LISA_HOOKS_SUBDIR,
  installHooks,
} from "../../../src/codex/hooks-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import {
  INJECT_RULES_ID,
  INJECT_RULES_SH,
  FORMAT_ON_EDIT_ID,
  RUBOCOP_ON_EDIT_ID,
  BLOCK_MIGRATION_EDITS_ID,
  BLOCK_SUPPRESS_DIRECTIVES_ID,
  BLOCK_NO_VERIFY_ID,
  SHELL_WRITE_NUDGE_ID,
  INSTALL_PKGS_ID,
  INSTALL_RAILS_HOOKS_ID,
  SETUP_JIRA_CLI_ID,
  RUBOCOP_ON_EDIT_SH,
  readLisaHookIds,
  seedLisaTree,
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
  describe("stack-aware filtering", () => {
    it("ships universal hooks for an empty type set", async () => {
      const result = await installHooks(lisaDir, destDir, []);
      const ids = await readLisaHookIds(destDir);
      expect(ids).toContain(INJECT_RULES_ID);
      expect(ids).toContain(INSTALL_PKGS_ID);
      expect(ids).toContain(INSTALL_RAILS_HOOKS_ID);
      expect(ids).toContain(SETUP_JIRA_CLI_ID);
      expect(ids).toContain(BLOCK_NO_VERIFY_ID);
      expect(ids).toContain(SHELL_WRITE_NUDGE_ID);
      expect(ids).not.toContain(FORMAT_ON_EDIT_ID);
      expect(ids).not.toContain(RUBOCOP_ON_EDIT_ID);
      expect(ids).not.toContain(BLOCK_MIGRATION_EDITS_ID);
      expect(ids).not.toContain(BLOCK_SUPPRESS_DIRECTIVES_ID);
      expect(result.hookEntries).toBe(7);
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
      expect(result.hookEntries).toBe(11);
    });

    it("ships Rails hooks when rails is detected", async () => {
      const result = await installHooks(lisaDir, destDir, ["rails"]);
      const ids = await readLisaHookIds(destDir);
      expect(ids).toContain(RUBOCOP_ON_EDIT_ID);
      // ast-grep scanning applies to Rails too (Ruby files)
      expect(ids).toContain("sg-scan-on-edit");
      expect(ids).not.toContain(FORMAT_ON_EDIT_ID);
      // rubocop + sg-scan + seven universal hooks
      expect(result.hookEntries).toBe(9);
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
      expect(result.hookEntries).toBe(12);
    });

    it("copies only the script files for applicable hooks", async () => {
      await installHooks(lisaDir, destDir, ["rails"]);
      const hooksDir = path.join(destDir, ".codex", LISA_HOOKS_SUBDIR);
      const scriptFiles = [...(await fs.readdir(hooksDir))].sort((a, b) =>
        a.localeCompare(b)
      );
      // Rails ships rubocop + sg-scan edit hooks, so the shared apply_patch
      // path helper AND the gate façade helper are copied alongside the
      // universal scripts. The façade helper was absent here until #3007 while
      // four scripts sourced it — see the dedicated case below.
      const expected = [
        EDIT_PATHS_LIB,
        EDIT_GATE_LIB,
        "block-no-verify.sh",
        INJECT_RULES_SH,
        "install-pkgs.sh",
        "install-rails-hooks.sh",
        "install-rails-hooks.mjs",
        ...RAILS_HOOK_ENGINE_FILES,
        RUBOCOP_ON_EDIT_SH,
        "setup-jira-cli.sh",
        "shell-write-nudge.sh",
        "sg-scan-on-edit.sh",
        "block-direct-issue-create.sh",
      ].sort((a, b) => a.localeCompare(b));
      expect(scriptFiles).toEqual(expected);
    });

    it("installs the gate façade helper every edit-time hook sources", async () => {
      // MEASURED GAP, not a hypothetical. Six scripts source
      // `${SCRIPT_DIR}/lisa-edit-gate.sh` and nothing here ever copied it. A
      // sourced file that is absent fails quietly under `set -uo pipefail` —
      // there is no `-e` — so `lisa_edit_gate_tasks` was simply not a command,
      // the `if` around it was false, and every hook fell through to its
      // built-in while the call site read as wired. On this surface a project
      // could declare a gate at either tool moment and nothing would see it.
      //
      // Asserted as CONTENT, not existence: an empty or truncated file exists
      // too, and sourcing it would fail exactly the same silent way.
      await installHooks(lisaDir, destDir, ["typescript"]);
      const installed = path.join(
        destDir,
        ".codex",
        LISA_HOOKS_SUBDIR,
        EDIT_GATE_LIB
      );

      expect(await fs.pathExists(installed)).toBe(true);
      expect(await fs.readFile(installed, "utf8")).toContain(
        "lisa_edit_gate_tasks()"
      );
    });

    it("does not install the gate helper for a stack with no edit-time hook", async () => {
      // NEGATIVE CONTROL. An installer that copied the helper unconditionally
      // would pass the case above while telling us nothing about the wiring,
      // and would leave an unreferenced file in projects that need none.
      await installHooks(lisaDir, destDir, []);
      const installed = path.join(
        destDir,
        ".codex",
        LISA_HOOKS_SUBDIR,
        EDIT_GATE_LIB
      );

      expect(await fs.pathExists(installed)).toBe(false);
    });
  });
});
