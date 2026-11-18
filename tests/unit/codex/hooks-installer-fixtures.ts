/**
 * Hook ids, rule files and the seeded Lisa tree shared by the Codex hooks installer suites.
 * @module tests/unit/codex/hooks-installer-fixtures
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { RAILS_HOOK_ENGINE_FILES } from "../../../scripts/lib/rails-hooks.mjs";
import { HOOKS_FILENAME } from "../../../src/codex/hooks-installer.js";
import {
  LISA_ID_MARKER,
  LISA_MANAGED_MARKER,
  parseHooksFile,
} from "../../../src/codex/hooks-merger.js";

/** Hook id reused across multiple test cases */
export const INJECT_RULES_ID = "inject-rules";
/** Filename of the inject-rules hook script */
export const INJECT_RULES_SH = `${INJECT_RULES_ID}.sh`;
/** Rule .md file shipped from the lisa-plugin */
export const BASE_RULES_MD = "base-rules.md";
/** Second rule .md file shipped from the lisa-plugin */
export const CODING_PHILOSOPHY_MD = "coding-philosophy.md";
/** Hook id for the format-on-edit hook (TypeScript stack) */
export const FORMAT_ON_EDIT_ID = "format-on-edit";
/** Hook id for the Rails-stack rubocop-on-edit hook */
export const RUBOCOP_ON_EDIT_ID = "rubocop-on-edit";
/** Hook id for the NestJS-stack migration-block hook */
export const BLOCK_MIGRATION_EDITS_ID = "block-migration-edits";
/** Hook id for the TypeScript-stack suppression-directive block hook */
export const BLOCK_SUPPRESS_DIRECTIVES_ID = "block-suppress-directives";
/** Universal Bash policy hook id */
export const BLOCK_NO_VERIFY_ID = "block-no-verify";
/** Universal non-blocking shell write visibility hook id */
export const SHELL_WRITE_NUDGE_ID = "shell-write-nudge";
/** Universal dependency bootstrap hook id */
export const INSTALL_PKGS_ID = "install-pkgs";
/** Shared Rails installation hook is always registered and self-gates. */
export const INSTALL_RAILS_HOOKS_ID = "install-rails-hooks";
/** Universal Jira configuration hook id */
export const SETUP_JIRA_CLI_ID = "setup-jira-cli";
/** Filename of the rubocop-on-edit hook script */
export const RUBOCOP_ON_EDIT_SH = `${RUBOCOP_ON_EDIT_ID}.sh`;
/** Harper/Fabric hook IDs that must remain project-local. */
export const HARPER_HOOK_IDS = [
  "block-generated-artifact-edits",
  "enforce-config-extensions",
] as const;

/**
 * Read the Lisa-managed hook ids out of the written hooks.json.
 * @param destDir - Absolute path to the host project root
 * @returns The `_lisaId` of every Lisa-marked handler across every event
 */
export async function readLisaHookIds(
  destDir: string
): Promise<readonly string[]> {
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

/**
 * Seed a disposable Lisa tree with the real Rails hook engine and the
 * eager/reference rules layout the installer mirrors.
 * @param lisaDir - Absolute path of the disposable Lisa checkout
 */
export async function seedLisaTree(lisaDir: string): Promise<void> {
  for (const filename of [
    "install-rails-hooks.sh",
    "install-rails-hooks.mjs",
  ]) {
    await fs.copy(
      path.join(process.cwd(), "plugins/lisa/hooks", filename),
      path.join(lisaDir, "plugins/lisa/hooks", filename)
    );
  }
  for (const filename of RAILS_HOOK_ENGINE_FILES) {
    await fs.copy(
      path.join(process.cwd(), "scripts/lib", filename),
      path.join(lisaDir, "scripts/lib", filename)
    );
  }

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
}
