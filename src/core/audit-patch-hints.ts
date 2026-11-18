import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { headerPairs, readAdvisoryPatches } from "./audit-patches.js";
import type { AuditFinding } from "./audit-types.js";

/** Where Lisa ships its advisory patches into every TypeScript project. */
const SHIPPED_PATCHES = ".lisa/patches";

/** An advisory patch file and the advisories its header names. */
interface KnownPatch {
  readonly file: string;
  readonly advisories: readonly string[];
}

/**
 * Every advisory patch the project carries: the ones Lisa ships under
 * `.lisa/patches/` and any the project declares in `patchedDependencies`.
 * @param root - Project root
 * @returns Each patch file with the advisories it names
 */
function knownPatches(root: string): readonly KnownPatch[] {
  const dir = join(root, SHIPPED_PATCHES);
  const shipped = existsSync(dir)
    ? readdirSync(dir)
        .filter(file => file.endsWith(".patch"))
        .map(file => ({
          file: `${SHIPPED_PATCHES}/${file}`,
          advisories: headerPairs(readFileSync(join(dir, file), "utf8"))
            .filter(([key]) => key === "Advisory")
            .map(([, value]) => value),
        }))
    : [];
  const declared = existsSync(join(root, "package.json"))
    ? readAdvisoryPatches(root)
    : [];
  const all = [...shipped, ...declared];
  return all.filter(
    (patch, index) =>
      all.findIndex(other => other.file === patch.file) === index
  );
}

/**
 * Why a patch gets no credit on this manager, and the fix.
 * @param manager - Package manager the project uses
 * @returns The explanation shared by every hint
 */
function noCredit(manager: string): string {
  const native =
    manager === "pnpm"
      ? "pnpm can apply patches itself, but Lisa's audit does not run for pnpm"
      : `${manager} ignores Bun's patchedDependencies, so the patch was never applied`;
  return `${native}, and Lisa credits an advisory patch only when Bun applied it. Fix: switch this project to Bun (Lisa then declares the patch in patchedDependencies), or upgrade once a fixed release exists`;
}

/**
 * Name the fix for a finding that an advisory patch covers but this project's
 * package manager cannot apply, so the audit gives the patch no credit.
 * @param root - Project root
 * @param manager - Package manager the audit ran for
 * @param findings - Findings no patch or exclusion resolved
 * @returns One actionable message per covered finding
 */
export function unappliedPatchHints(
  root: string,
  manager: string,
  findings: readonly AuditFinding[]
): readonly string[] {
  if (manager === "bun") return [];
  const patches = knownPatches(root);
  return findings.flatMap(finding => {
    const files = patches
      .filter(patch => patch.advisories.some(id => finding.ids.includes(id)))
      .map(patch => patch.file);
    return files.length
      ? [
          `${finding.ids[0]}: the advisory patch for ${finding.name} (${files.join(", ")}) gets no credit: ${noCredit(manager)}.`,
        ]
      : [];
  });
}

/**
 * The same explanation for a manager the audit cannot run for at all, added
 * to that refusal when the project carries advisory patches.
 * @param root - Project root
 * @param manager - Package manager the project uses
 * @returns The note, or an empty string when there are no advisory patches
 */
export function unsupportedManagerPatchNote(
  root: string,
  manager: string
): string {
  const files = knownPatches(root).map(patch => patch.file);
  return files.length
    ? ` Its advisory patches (${files.join(", ")}) get no credit: ${noCredit(manager)}.`
    : "";
}
