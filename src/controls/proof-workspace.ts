/**
 * Where a proof's changes are planted: the workspaces this step provides.
 *
 * A proof changes files. It must never change the operator's own: a planted
 * violation left behind by an interrupted run would be a real defect in a
 * real working copy. So the paired-proof runner never touches a folder
 * itself. It is handed a {@link ProofWorkspace} and asks that to plant a
 * change, trigger the moment, and put things back.
 *
 * ## The workspace this step ships
 *
 * {@link directProofWorkspace} is the simplest honest one. It works in a
 * folder the caller names, which must be a copy of the repository. It plants
 * a change with `git apply`, starts the entry's own command in the entry's
 * own folder — exactly what the entry's gate starts — and takes the change
 * back out with the reverse of the same patch. It installs nothing and makes
 * no commit, so it needs no carrier and works in a copy with no `.git`.
 *
 * It does not make the copy. The workspace that makes its own disposable
 * copy, runs commit and push proofs through the installed carriers and
 * removes the copy on every way out is `./proof-copy-workspace.ts`; the
 * command uses that one when no folder is named. This one is for a copy the
 * operator made, and {@link disposableFolder} refuses the repository itself,
 * any folder that holds it and any folder inside it.
 * @module controls/proof-workspace
 */
import path from "node:path";

import { resolveRepositoryRoot } from "./audit-report-file.js";
import { applyProofPatch } from "./proof-patch.js";
import type { ProofTools } from "./proof-tools.js";
import type { ProofWorkspace } from "./proof-types.js";

/** A workspace ready to use, or the one-line reason there is none. */
export type ProofWorkspaceOpening =
  | {
      readonly problem: null;
      readonly workspace: ProofWorkspace;
      /** Remove whatever opening it created. Called once, on every way out. */
      readonly close: () => void | Promise<void>;
      /**
       * The commit the workspace is a copy of, when it is a copy of one. It
       * is what the run's evidence records name: the commit the proofs were
       * run against, whatever the repository has moved to by the time the
       * results are written down.
       */
      readonly commit?: string;
    }
  | { readonly problem: string };

/** What opening a workspace is given. */
export interface ProofWorkspaceRequest {
  /** Real path of the repository whose controls are being proved. */
  readonly root: string;
  /** The folder the operator named as disposable, already made absolute. */
  readonly named: string | undefined;
  readonly tools: ProofTools;
}

/** Opens the workspace a run plants its changes in. */
export type OpenProofWorkspace = (
  request: ProofWorkspaceRequest
) => Promise<ProofWorkspaceOpening>;

/**
 * A workspace that plants changes in a folder the caller supplies and starts
 * each entry's own command there.
 * @param directory - Real path of a disposable copy of the repository
 * @param tools - The gate runner's own parts
 * @returns The workspace
 */
export function directProofWorkspace(
  directory: string,
  tools: ProofTools
): ProofWorkspace {
  return {
    root: directory,
    apply: patch => applyProofPatch(directory, patch),
    trigger: ({ entry, mechanism, timeoutMs }) => {
      const command = [...mechanism.argv];
      const start = tools.folder(directory, entry.scope);
      return "problem" in start
        ? {
            command,
            cwd: directory,
            code: null,
            output: null,
            notStarted: start.problem,
          }
        : {
            ...tools.start(command, { cwd: start.directory, timeoutMs }),
            command,
            cwd: start.directory,
          };
    },
    restore: patch => applyProofPatch(directory, patch, { reverse: true }),
  };
}

/**
 * Tell whether one folder is another, or holds it.
 * @param outer - Real path of the folder that may hold the other
 * @param inner - Real path of the folder that may be held
 * @returns Whether `inner` is `outer` or is somewhere inside it
 */
function holds(outer: string, inner: string): boolean {
  const relative = path.relative(outer, inner);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

/**
 * Resolve the folder an operator named as disposable, refusing one a proof
 * could damage the repository through.
 * @param root - Real path of the repository
 * @param named - The folder the operator named, already made absolute
 * @returns The folder's real path, or the one-line reason it is refused
 */
export async function disposableFolder(
  root: string,
  named: string
): Promise<
  | { readonly problem: null; readonly directory: string }
  | { readonly problem: string }
> {
  const directory = await resolveRepositoryRoot(named);
  if (directory === null) {
    return {
      problem: `The workspace ${named} is not a folder. Name a folder that holds a disposable copy of the repository.`,
    };
  }
  if (directory === root) {
    return {
      problem: `The workspace ${named} is the repository itself. A proof plants a change that breaks a rule, so it only runs in a disposable copy. Copy the repository to another folder and name that.`,
    };
  }
  if (holds(directory, root)) {
    return {
      problem: `The workspace ${named} holds the repository, so a change planted there could land in it. Name a folder that holds only a disposable copy of the repository.`,
    };
  }
  // A folder of the repository is part of the operator's working tree, and
  // so is everything planted in it.
  return holds(root, directory)
    ? {
        problem: `The workspace ${named} is inside the repository, so a change planted there would land in your own working tree. Copy the repository to a folder outside it and name that.`,
      }
    : { problem: null, directory };
}

/**
 * Open the workspace this step ships: the folder the operator named, or
 * nothing at all.
 * @param request - The repository, the folder named and the gate runner
 * @returns The workspace, or why no proof will be run
 */
export const openDirectProofWorkspace: OpenProofWorkspace = async request => {
  if (request.named === undefined) {
    return {
      problem:
        "No proof was run. A proof plants a change that breaks a rule and then runs the check, and it never does that in your own working copy. Name a disposable copy of the repository with --workspace <folder> (for example one made with: git clone . ../proof-copy).",
    };
  }
  const folder = await disposableFolder(request.root, request.named);
  return folder.problem === null
    ? {
        problem: null,
        workspace: directProofWorkspace(folder.directory, request.tools),
        close: () => undefined,
      }
    : folder;
};
