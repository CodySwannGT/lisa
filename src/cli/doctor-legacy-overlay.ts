import { existsSync, lstatSync, readFileSync } from "node:fs";
import * as path from "node:path";
import {
  LISA_HOOKS_SUBDIR,
  LISA_RULES_SUBDIR,
} from "../codex/hooks-installer.js";
import { LISA_MANAGED_MANIFEST_FILENAME } from "../codex/manifest.js";
import { parseHooksFile } from "../codex/hooks-merger.js";
import { LISA_SKILLS_SUBDIR } from "../codex/skills-installer.js";
import type { DoctorCheck } from "./doctor.js";

const LEGACY_CODEX_OVERLAY_CHECK_NAME = "Codex overlay current?";

/**
 * Detect the retired pre-2.198 project-level Codex overlay. Lisa now delivers
 * Codex hooks and skills through the repository plugin marketplace
 * (`.agents/plugins/marketplace.json` → `node_modules`), and postinstall
 * applies deliberately skip agent emits — so a committed legacy overlay is
 * never cleaned up automatically. Fresh clones/worktrees then load stale
 * hooks/skills from it, and a later explicit apply retires them out from
 * under whatever session is running (exit-127 hooks, vanished skills — the
 * incident behind CodySwannGT/lisa#1632).
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export function checkLegacyCodexOverlay(targetPath: string): DoctorCheck {
  const codexDir = path.join(targetPath, ".codex");
  if (!existsSync(codexDir)) {
    return {
      name: LEGACY_CODEX_OVERLAY_CHECK_NAME,
      status: "ok",
      detail: "No .codex directory present",
    };
  }

  const compatibility = hasManagedCompatibility(codexDir);
  const legacyPaths = [
    LISA_HOOKS_SUBDIR,
    LISA_RULES_SUBDIR,
    LISA_SKILLS_SUBDIR,
  ].filter(
    subdir =>
      existsSync(path.join(codexDir, subdir)) &&
      !(compatibility && subdir !== LISA_SKILLS_SUBDIR)
  );

  if (legacyPaths.length === 0) {
    return {
      name: LEGACY_CODEX_OVERLAY_CHECK_NAME,
      status: "ok",
      detail: compatibility
        ? "Managed compatibility copies retained for active sessions; fresh sessions use the current enforcement fallback"
        : "No legacy project-level Codex overlay present",
    };
  }

  const listed = legacyPaths
    .map(subdir => path.join(".codex", subdir))
    .join(", ");
  return {
    name: LEGACY_CODEX_OVERLAY_CHECK_NAME,
    status: "warn",
    detail:
      `Legacy pre-2.198 Codex overlay present (${listed}). ` +
      "Run `lisa apply` in the primary checkout to migrate the configuration and retain functional copies for active sessions — " +
      "fresh clones/worktrees otherwise load stale hooks/skills that a later " +
      "apply must keep executable mid-session (CodySwannGT/lisa#1632)",
  };
}

/**
 * Distinguish intentional copied compatibility from an unmigrated overlay.
 * @param codexDir Host Codex directory.
 * @returns Whether every recorded compatibility path remains a regular file.
 */
function hasManagedCompatibility(codexDir: string): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(codexDir, LISA_MANAGED_MANIFEST_FILENAME), "utf8")
    ) as { files?: string[]; hookCompatibilityFiles?: string[] };
    const compatibility = manifest.hookCompatibilityFiles;
    if (
      !Array.isArray(compatibility) ||
      compatibility.length === 0 ||
      !compatibility.every(
        file =>
          typeof file === "string" &&
          manifest.files?.includes(file) &&
          (file.startsWith(`${LISA_HOOKS_SUBDIR}${path.sep}`) ||
            file.startsWith(`${LISA_RULES_SUBDIR}${path.sep}`)) &&
          !file.split(path.sep).includes("..") &&
          lstatSync(path.join(codexDir, file)).isFile()
      )
    )
      return false;
    const hooks = parseHooksFile(
      readFileSync(path.join(codexDir, "hooks.json"), "utf8")
    );
    const managed = Object.values(hooks.hooks ?? {}).flatMap(groups =>
      groups.flatMap(group =>
        group.hooks.filter(hook => hook._lisaManaged === true)
      )
    );
    return (
      managed.length === 1 && managed[0]?._lisaId === "enforcement-fallback"
    );
  } catch {
    return false;
  }
}
