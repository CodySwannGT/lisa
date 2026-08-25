/**
 * Doctor check: a project that carries a wiki carries the contract files that
 * make it readable.
 *
 * Extracted from `cli/doctor` rather than written there, which is where every
 * other check in that report already lives — the entry point composes checks
 * and owns none of them.
 * @module cli/doctor-wiki
 */
import { existsSync } from "node:fs";
import * as path from "node:path";

import type { DoctorCheck } from "./doctor.js";

/**
 * Check basic wiki contract files when a wiki exists.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export function checkWiki(targetPath: string): DoctorCheck {
  const wikiPath = path.join(targetPath, "wiki");
  if (!existsSync(wikiPath)) {
    return {
      name: "Wiki health",
      status: "ok",
      detail: "No wiki directory present",
    };
  }

  const required = [
    "lisa-wiki.config.json",
    "schema/llm-wiki-contract.md",
    "index.md",
  ];
  const missing = required.filter(fileName => {
    return !existsSync(path.join(wikiPath, fileName));
  });

  return {
    name: "Wiki health",
    status: missing.length === 0 ? "ok" : "fail",
    detail:
      missing.length === 0
        ? "Required wiki files are present"
        : `Missing ${missing.join(", ")}`,
  };
}
