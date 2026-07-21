import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  LISA_HOOKS_SUBDIR,
  LISA_RULES_SUBDIR,
} from "../codex/hooks-installer.js";
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

  const legacyPaths = [
    LISA_HOOKS_SUBDIR,
    LISA_RULES_SUBDIR,
    LISA_SKILLS_SUBDIR,
  ].filter(subdir => existsSync(path.join(codexDir, subdir)));

  if (legacyPaths.length === 0) {
    return {
      name: LEGACY_CODEX_OVERLAY_CHECK_NAME,
      status: "ok",
      detail: "No legacy project-level Codex overlay present",
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
      "Run `lisa apply` in the primary checkout and commit the removals — " +
      "fresh clones/worktrees otherwise load stale hooks/skills that a later " +
      "apply deletes mid-session (CodySwannGT/lisa#1632)",
  };
}
