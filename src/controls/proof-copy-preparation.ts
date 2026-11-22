/** Run a repository's committed setup before checking controls in its clone. */
import path from "node:path";

import { currentEnvironment } from "../utils/process-environment.js";
import { canonicalText } from "./canonical-json.js";
import { outputWithoutSecretValues } from "./evidence-redact.js";
import { checkFilesOf } from "./proof-change-rule.js";
import { carryFiles } from "./proof-copy-files.js";
import { copyGit } from "./proof-copy-git.js";
import { snapshotPreparedCopy } from "./proof-copy-prepared-state.js";
import type { ProofCopy, ProofCopyBuild } from "./proof-copy.js";
import { REPOSITORY_VARIABLES } from "./proof-patch.js";
import { loadProofTools, type ProofTools } from "./proof-tools.js";
import { readProofPreparation } from "./proof-preparation-declaration.js";

const PREPARE_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Run every command once in the clone. Failed setup never becomes a result
 * for a control, and the command's output is redacted before it is surfaced.
 * @param clone - The disposable working directory
 * @param commands - Configured argument lists, in order
 * @param notice - Where the pre-execution warning is displayed
 * @returns A preparation failure, or null after all commands complete
 */
async function runProofPreparation(
  clone: string,
  commands: readonly (readonly string[])[],
  notice: (line: string) => void
): Promise<string | null> {
  const inheritedGit = new Set<string>(REPOSITORY_VARIABLES);
  const env = Object.fromEntries(
    Object.entries(currentEnvironment()).filter(
      ([key]) => !inheritedGit.has(key)
    )
  );
  notice(
    `Running ${commands.length} configured preparation command(s) in the temporary proof copy. They can use this machine's network and credentials.`
  );
  try {
    const tools = await loadProofTools();
    for (const [index, argv] of commands.entries()) {
      const result = tools.start(argv, {
        cwd: clone,
        timeoutMs: PREPARE_TIMEOUT_MS,
        env,
      });
      const failure = preparationFailure(index, result);
      if (failure !== null) return failure;
    }
    return null;
  } catch (error) {
    return outputWithoutSecretValues(
      `Could not start proof copy preparation. No control proof was run. ${String(error)}`
    );
  }
}

/**
 * Report a failed command without exposing credential-shaped data.
 * @param index - The command's position in the preparation
 * @param result - The gate runner's observed process result
 * @returns A safe diagnostic, or null when the command completed successfully
 */
function preparationFailure(
  index: number,
  result: ReturnType<ProofTools["start"]>
): string | null {
  if (result.code === 0 && result.notStarted === undefined) return null;
  const status =
    result.timedOut === true
      ? "five-minute time limit exceeded"
      : (result.notStarted ??
        (result.code === null
          ? "the command did not finish"
          : `exit ${result.code}`));
  const output = result.output === null ? "" : `\n${result.output}`;
  return outputWithoutSecretValues(
    `Proof copy preparation command ${index + 1} failed (${status}). No control proof was run.${output}`
  );
}

/**
 * Carry the working check files and bind their setup to the committed recipe.
 * @param root - The operator's repository
 * @param clone - The clone of the last commit
 * @param paths - Files the proof normally carries from the working copy
 * @returns The carried file names and commands, or why the copy cannot run
 */
export async function carryProofInputs(
  root: string,
  clone: string,
  paths: readonly string[]
): Promise<
  | {
      readonly problem: null;
      readonly commands: readonly (readonly string[])[];
      readonly carried: readonly string[];
    }
  | { readonly problem: string }
> {
  const committed = readProofPreparation(clone);
  if (committed.problem !== null) return committed;
  const carried = await carryFiles(root, clone, paths);
  if (carried.problem !== null) return carried;
  const working = readProofPreparation(clone);
  if (working.problem !== null) return working;
  if (canonicalText(working.commands) !== canonicalText(committed.commands)) {
    return {
      problem:
        "Commit changes to controls.proof_copy.prepare before running control proofs.",
    };
  }
  return { ...carried, commands: committed.commands };
}

/** A carrier check or the reason it could not run. */
type Wiring =
  | { readonly problem: null; readonly unwired: ProofCopy["unwired"] }
  | { readonly problem: string };

/**
 * Keep later patch commits and pushes on the disposable repository.
 * @param copy - The verified copy before preparation
 * @returns A problem, or null after restoring the index
 */
function resetPreparationIndex(copy: ProofCopy): string | null {
  const git = copyGit(copy.clone);
  const local = [
    {
      argv: ["rev-parse", "--absolute-git-dir"],
      expected: path.join(copy.clone, ".git"),
    },
    { argv: ["rev-parse", "--show-toplevel"], expected: copy.clone },
    { argv: ["rev-parse", "HEAD"], expected: copy.base },
    { argv: ["remote", "get-url", "--all", "origin"], expected: copy.remote },
    {
      argv: ["remote", "get-url", "--all", "--push", "origin"],
      expected: copy.remote,
    },
  ].every(({ argv, expected }) => {
    const result = git(argv);
    return result.code === 0 && result.stdout === expected;
  });
  if (!local) {
    return "Proof copy preparation changed the temporary Git repository, starting commit, or stand-in remote. No control proof was run.";
  }
  const staged = git(["reset", "--quiet", "--mixed", copy.base]);
  return staged.code === 0
    ? null
    : "Could not reset the index after proof copy preparation. No control proof was run.";
}

/**
 * Keep setup changes in the disposable working tree and recheck its hooks.
 * @param copy - The copy and its Git baseline
 * @param commands - The committed preparation commands
 * @param notify - Where to announce the declared setup
 * @param recheck - Reconcile Lisa carriers when this proof installs them
 * @returns The prepared copy or why no proof can be run
 */
export async function prepareProofCopy(
  copy: ProofCopy,
  commands: readonly (readonly string[])[],
  notify: ((line: string) => void) | undefined,
  recheck: () => Promise<Wiring>
): Promise<ProofCopyBuild> {
  const notice = notify ?? (line => process.stderr.write(`${line}\n`));
  const problem = await runProofPreparation(copy.clone, commands, notice);
  if (problem !== null) return { problem };
  const prepared = readProofPreparation(copy.clone);
  if (prepared.problem !== null) return prepared;
  if (canonicalText(prepared.commands) !== canonicalText(commands)) {
    return {
      problem:
        "Proof copy preparation changed its declaration. No control proof was run.",
    };
  }
  const reset = resetPreparationIndex(copy);
  if (reset !== null) return { problem: reset };
  // A manager can now own the hooks. Let the normal installer fill in any
  // carriers it could not add before the manager was switched on.
  const rechecked = await recheck();
  if (rechecked.problem !== null) return rechecked;
  const snapshot = snapshotPreparedCopy(
    copy.clone,
    path.join(copy.folder, "prepared"),
    copy.base
  );
  if (snapshot.problem !== null) return snapshot;
  return {
    problem: null,
    copy: {
      ...copy,
      checkFiles: await checkFilesOf(copy.clone),
      preparation: snapshot.preparation,
      unwired: rechecked.unwired,
    },
  };
}
