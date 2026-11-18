/**
 * Where `lisa controls proof-check` tries a pair of changes: a fresh clone
 * of the last commit with nothing installed in it.
 *
 * It is the workspace the before-enforce run uses
 * (`./before-enforce-workspace.ts`), so a change is planted and staged,
 * the part's own command is started in the part's own folder, and the clone
 * is put back to its starting commit, by the same code. One question is
 * added: once a change is staged, which paths does it touch, and would a
 * commit or push of it start this part's check at all?
 *
 * ## Why the second question is not answered here
 *
 * At commit and at push the gate runner starts a part only when the change
 * touches the part's folder, and it runs every part when the change edits
 * the file that declares them. Those rules are the runner's
 * (`all/copy-overwrite/scripts/lib/changed-paths.mjs`). This module imports
 * them from the running Lisa package, the way `./proof-tools.ts` imports the
 * runner, and asks git for the staged names with the same options the runner
 * uses. So what is called "inside the folder" here is exactly what starts
 * the check there.
 * @module controls/proof-check-workspace
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveGateRegistryPath } from "../cli/gate-registry-source.js";
import {
  beforeEnforceWorkspace,
  type BeforeEnforceWorkspace,
} from "./before-enforce-workspace.js";
import { copyGit, gitSaid } from "./proof-copy-git.js";
import type { ProofCopy } from "./proof-copy.js";
import type { ProofTools } from "./proof-tools.js";
import { WHOLE_REPOSITORY_SCOPE } from "./register-types.js";

/** The runner's module that says what a change touches. */
const CHANGED_PATHS_FILE = path.join("lib", "changed-paths.mjs");

/**
 * How the gate runner asks git for the names a commit changes: one name per
 * NUL, a rename as a removal and an arrival, and a moved nested repository
 * reported whatever the project configured.
 */
const STAGED_NAMES = [
  "diff",
  "--cached",
  "--name-only",
  "-z",
  "--no-renames",
  "--ignore-submodules=none",
  "--no-ext-diff",
  "--",
] as const;

/** The gate runner's own rules about what a change touches. */
export interface ChangeRules {
  /** Whether any changed path is inside one of a folder's spellings. */
  readonly touches: (
    paths: readonly string[],
    folders: readonly string[]
  ) => boolean;
  /** The file that declares the gates, from the repository root. */
  readonly declarationFile: string;
}

/** What a planted change is, as a commit or push hook would see it. */
export interface PlantedChange {
  /** The paths it touches, from the repository root, in git's order. */
  readonly paths: readonly string[];
  /** Whether it edits the file that declares the checks. */
  readonly editsDeclaration: boolean;
  /** Whether a commit or push of it would start the part's check. */
  readonly startsCheck: boolean;
}

/** Where a pair of changes is tried, and what can be asked about each. */
export interface ProofCheckWorkspace extends BeforeEnforceWorkspace {
  /**
   * Describe the change that is planted right now.
   * @param scope - The folder of the part the change belongs to
   * @throws {Error} When git cannot list what is staged in the clone
   */
  readonly planted: (scope: string) => PlantedChange;
}

/** The slice of the runner's changed-paths module this module calls. */
interface ChangedPathsModule {
  readonly DECLARATION_FILE: string;
  readonly touchesFolder: (
    paths: readonly string[],
    folders: readonly string[]
  ) => boolean;
}

/**
 * Import the gate runner's rules about what a change touches from the
 * running Lisa package.
 * @returns The rules
 * @throws {Error} When this copy of Lisa does not hold the module
 */
export async function loadChangeRules(): Promise<ChangeRules> {
  const registry = resolveGateRegistryPath();
  if (registry === null) {
    throw new Error(
      "The gate runner is missing from this copy of Lisa (expected all/copy-overwrite/scripts/lib/changed-paths.mjs). Reinstall Lisa."
    );
  }
  const rules = (await import(
    pathToFileURL(path.join(path.dirname(registry), CHANGED_PATHS_FILE)).href
  )) as ChangedPathsModule;
  return {
    declarationFile: rules.DECLARATION_FILE,
    touches: (paths, folders) => rules.touchesFolder([...paths], [...folders]),
  };
}

/**
 * Every way a part's folder is written from the root of the clone.
 * @param clone - Real path of the clone
 * @param scope - The part's folder, as declared
 * @param tools - The gate runner's own parts
 * @returns The declared name and the name it resolves to on disk; `null`
 *   for a part that covers the whole repository, which every change starts
 */
function folderSpellings(
  clone: string,
  scope: string,
  tools: ProofTools
): readonly string[] | null {
  if (scope === WHOLE_REPOSITORY_SCOPE) return null;
  const start = tools.folder(clone, scope);
  // A folder that is not there yet is matched by its declared name alone:
  // the change itself may be what creates it.
  if ("problem" in start) return [scope];
  const resolved = path
    .relative(clone, start.directory)
    .split(path.sep)
    .join("/");
  return resolved === "" ? null : [scope, resolved];
}

/**
 * Open a disposable copy as the place a pair of changes is tried.
 * @param copy - A disposable copy built with no carriers
 * @param tools - The gate runner's own parts
 * @param rules - The gate runner's rules about what a change touches
 * @returns The workspace
 */
export function proofCheckWorkspace(
  copy: ProofCopy,
  tools: ProofTools,
  rules: ChangeRules
): ProofCheckWorkspace {
  const inClone = copyGit(copy.clone);
  return {
    ...beforeEnforceWorkspace(copy, tools),
    planted: scope => {
      const listed = inClone(STAGED_NAMES);
      if (listed.code !== 0) {
        throw new Error(
          `The temporary copy could not say what a change touches, so nothing more was checked: ${gitSaid(listed)}`
        );
      }
      const paths = listed.stdout.split("\0").filter(name => name !== "");
      const folders = folderSpellings(copy.clone, scope, tools);
      return {
        paths,
        editsDeclaration: rules.touches(paths, [rules.declarationFile]),
        startsCheck: folders === null || rules.touches(paths, folders),
      };
    },
  };
}
