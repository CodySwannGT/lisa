/**
 * Where a before-enforce run tries its changes: a fresh clone with nothing
 * installed.
 *
 * Two things are done with each violating change, and this module is the
 * only place either is started:
 *
 * - **The attempt.** The change is staged and then really committed, or
 *   committed and really pushed to the stand-in remote, with whatever hook
 *   wiring the clone has. Git's exit status and what git did are the answer.
 *   This is `./proof-copy-workspace.ts` answered by git alone.
 * - **The measurement.** The entry's own command is started on the same
 *   change, in the entry's own folder, exactly as its gate would start it.
 *   That shows the tool is there. It is `./proof-workspace.ts`'s trigger.
 *
 * Between any two of them the clone is put back to its starting commit, with
 * everything a command left behind removed.
 *
 * ## What a fresh clone has
 *
 * Git copies commits into a clone and nothing else: not `core.hooksPath`,
 * not the files under `.git/hooks`, and nothing a hook manager wrote when
 * somebody ran an install step. {@link cloneWiring} reads what is actually
 * there, so the result says what was measured and not what is usually true.
 * @module controls/before-enforce-workspace
 */
import { readdirSync } from "node:fs";
import path from "node:path";

import { HOOKS_PATH_SETTING } from "./carrier-git.js";
import type { BeforeEnforceCopy } from "./before-enforce-types.js";
import { compareCodeUnits } from "./canonical-json.js";
import { copyGit } from "./proof-copy-git.js";
import { proofCopyWorkspace } from "./proof-copy-workspace.js";
import type { ProofCopy } from "./proof-copy.js";
import type { ProofTools } from "./proof-tools.js";
import type { PatchOutcome, ProofAnswer, ProofTrigger } from "./proof-types.js";
import { directProofWorkspace } from "./proof-workspace.js";

/** The ending git gives the example hooks it ships, which it never runs. */
const SAMPLE_SUFFIX = ".sample";

/** Where a before-enforce run plants a change and what it can do with it. */
export interface BeforeEnforceWorkspace {
  /** The folder the changes are planted in, with every link resolved. */
  readonly root: string;
  /** Plant one change and stage it. All of it or none of it. */
  readonly plant: (patch: string) => Promise<PatchOutcome>;
  /** Commit or push the planted change for real and say what git did. */
  readonly attempt: (request: ProofTrigger) => Promise<ProofAnswer>;
  /** Start the entry's own command on the planted change. */
  readonly measure: (request: ProofTrigger) => Promise<ProofAnswer>;
  /** Put the clone back to its starting commit. */
  readonly restore: () => Promise<PatchOutcome>;
}

/**
 * Open a fresh clone as the place a before-enforce run works in.
 * @param copy - A disposable copy built with no carriers
 * @param tools - The gate runner's own parts
 * @returns The workspace
 */
export function beforeEnforceWorkspace(
  copy: ProofCopy,
  tools: ProofTools
): BeforeEnforceWorkspace {
  const asCloned = proofCopyWorkspace(copy, tools, { answeredBy: "git" });
  const direct = directProofWorkspace(copy.clone, tools);
  return {
    root: copy.clone,
    plant: async patch => asCloned.apply(patch),
    attempt: async request => asCloned.trigger(request),
    measure: async request => direct.trigger(request),
    // The copy's own reset: the starting commit, with anything a command
    // left behind removed. It does not need the patch to undo it.
    restore: async () => asCloned.restore(""),
  };
}

/**
 * List the hook files in a folder, leaving out the examples git ships.
 * @param folder - The folder git reads hooks from
 * @returns Their names; none when the folder cannot be read
 */
function hookFiles(folder: string): readonly string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.name.endsWith(SAMPLE_SUFFIX))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

/**
 * Read what hook wiring the clone has.
 * @param copy - The disposable copy
 * @returns Its own hook-folder setting, and the hook files in the folder git
 *   reads, by file name
 */
function hooksOf(
  copy: ProofCopy
): Pick<BeforeEnforceCopy, "hooks_path" | "hooks"> {
  const inClone = copyGit(copy.clone);
  const setting = inClone(["config", "--get", HOOKS_PATH_SETTING]);
  const folder = inClone(["rev-parse", "--git-path", "hooks"]);
  const names =
    folder.code === 0 ? hookFiles(path.resolve(copy.clone, folder.stdout)) : [];
  return {
    hooks: [...names].sort(compareCodeUnits),
    hooks_path:
      setting.code === 0 && setting.stdout !== "" ? setting.stdout : null,
  };
}

/**
 * Describe the fresh clone a run worked in, from what is measured there.
 * @param copy - The disposable copy
 * @returns What the clone was
 */
export function cloneWiring(copy: ProofCopy): BeforeEnforceCopy {
  return {
    branch: copy.source.branch,
    carried: copy.carried,
    carriers_installed: false,
    commit: copy.source.commit,
    uncommitted_work: copy.source.dirty,
    ...hooksOf(copy),
  };
}
