import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { headerPairs } from "./audit-patches.js";
import type { AuditFinding, AuditManager } from "./audit-types.js";

/** Where Lisa ships its advisory patches into every TypeScript project. */
const SHIPPED_PATCHES = ".lisa/patches";

/**
 * Name the fix for a finding that a shipped advisory patch covers but this
 * project's package manager cannot apply natively (npm, Yarn classic).
 * @param root - Project root
 * @param manager - Package manager the audit ran for
 * @param findings - Findings no patch or exclusion resolved
 * @returns One actionable message per covered finding
 */
export function unappliedPatchHints(
  root: string,
  manager: AuditManager,
  findings: readonly AuditFinding[]
): readonly string[] {
  const dir = join(root, SHIPPED_PATCHES);
  if (manager === "bun" || !existsSync(dir)) return [];
  const shipped = readdirSync(dir)
    .filter(file => file.endsWith(".patch"))
    .map(file => {
      const pairs = headerPairs(readFileSync(join(dir, file), "utf8"));
      return {
        file: `${SHIPPED_PATCHES}/${file}`,
        advisories: pairs
          .filter(([key]) => key === "Advisory")
          .map(([, value]) => value),
      };
    });
  return findings.flatMap(finding => {
    const files = shipped
      .filter(patch => patch.advisories.some(id => finding.ids.includes(id)))
      .map(patch => patch.file);
    return files.length
      ? [
          `${finding.ids[0]}: Lisa ships a verified patch for ${finding.name} (${files.join(", ")}), but ${manager} has no native patch mechanism, so the audit cannot credit it. Fix: switch this project to Bun (Lisa then declares the patch in patchedDependencies), or upgrade ${finding.name} once a fixed release exists.`,
        ]
      : [];
  });
}
