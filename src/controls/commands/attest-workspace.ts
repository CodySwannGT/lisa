/**
 * Choosing where `lisa controls attest` plants its changes.
 *
 * Three cases, in this order:
 *
 * 1. A caller handed in its own way to open a workspace. It is used as it
 *    is. Tests do this.
 * 2. The operator named a folder with `--workspace`. That folder is used,
 *    and each check's own command is started there, as before.
 * 3. Neither. The command makes a disposable copy of the repository in a
 *    temporary folder of its own, installs the commit and push carriers
 *    there, and proves each check through a real commit or a real push. See
 *    `../proof-copy.ts` for what the copy is.
 *
 * ## What happens to the temporary folder
 *
 * It is removed on every way out, and this module is the only place that
 * removes it:
 *
 * - the run finishes: `close()` removes it;
 * - anything throws: the command calls `close()` in a `finally`;
 * - the copy cannot be built: it is removed before the reason is returned;
 * - the process is told to stop: the signal handler removes it. The handler
 *   is listening before the folder is created, so there is no moment at
 *   which a folder exists that nothing will remove.
 *
 * `close()` may be called any number of times. It also stops listening for
 * signals, so nothing of the run is left in the process afterwards.
 * @module controls/commands/attest-workspace
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildProofCopy } from "../proof-copy.js";
import { proofCopyWorkspace } from "../proof-copy-workspace.js";
import { uncommittedNotes } from "../proof-copy-wording.js";
import {
  openDirectProofWorkspace,
  type OpenProofWorkspace,
  type ProofWorkspaceOpening,
  type ProofWorkspaceRequest,
} from "../proof-workspace.js";
import {
  removeOnTermination,
  type SignalSource,
} from "./attest-interruption.js";

/** The start of the name of every run's temporary folder. */
export const PROOF_SCRATCH_PREFIX = "lisa-attest-";

/** How often removing the folder is tried again when it is busy. */
const REMOVE_RETRIES = 5;

/** How long to wait between tries, in milliseconds. */
const REMOVE_RETRY_DELAY_MS = 100;

/** What choosing a workspace takes from the command, each replaceable. */
export interface AttestWorkspaceChoice {
  /** A caller's own way to open a workspace; used as it is when given. */
  readonly open?: OpenProofWorkspace | undefined;
  /** Tells the operator one line that is not a result. */
  readonly notice?: ((line: string) => void) | undefined;
  /** Where signals come from; this process's own when left out. */
  readonly signals?: SignalSource;
  /** Names the run's temporary folder, which must not exist yet. */
  readonly scratch?: () => string;
  /** Builds the disposable copy. */
  readonly build?: typeof buildProofCopy;
}

/**
 * Name a temporary folder for one run. Nothing is created.
 * @returns A path in the machine's temporary folder that no other run uses
 */
export function proofScratchFolder(): string {
  return path.join(tmpdir(), `${PROOF_SCRATCH_PREFIX}${randomUUID()}`);
}

/**
 * Open a disposable copy of the repository, made for this run and removed
 * with it.
 * @param request - The repository and the gate runner
 * @param choice - Replaceable collaborators
 * @returns The workspace, or why no proof will be run
 */
async function openDisposableCopy(
  request: ProofWorkspaceRequest,
  choice: AttestWorkspaceChoice
): Promise<ProofWorkspaceOpening> {
  const folder = (choice.scratch ?? proofScratchFolder)();
  const notice = choice.notice ?? (line => process.stderr.write(`${line}\n`));
  // Listening before the folder exists: a signal that arrives while the copy
  // is being made finds a handler that removes whatever is there so far.
  const watch = removeOnTermination(
    folder,
    choice.signals === undefined ? {} : { signals: choice.signals }
  );
  const close = async (): Promise<void> => {
    try {
      await rm(folder, {
        force: true,
        maxRetries: REMOVE_RETRIES,
        recursive: true,
        retryDelay: REMOVE_RETRY_DELAY_MS,
      });
    } catch (error) {
      throw new Error(
        `The temporary copy the proofs ran in could not be removed (${error instanceof Error ? error.message : String(error)}). Your repository was not changed. Remove this folder by hand: ${folder}`,
        { cause: error }
      );
    } finally {
      watch.release();
    }
  };
  try {
    const built = await (choice.build ?? buildProofCopy)(request.root, folder);
    if (built.problem !== null) {
      await close();
      return built;
    }
    const { copy } = built;
    if (copy.source.dirty) {
      uncommittedNotes(copy.source.commit, copy.carried).forEach(line => {
        notice(`attest: note. ${line}`);
      });
    }
    return {
      problem: null,
      workspace: proofCopyWorkspace(copy, request.tools),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * Open the workspace a run plants its changes in.
 * @param request - The repository, the folder the operator named if any, and
 *   the gate runner
 * @param choice - A caller's own opener, and where notes go
 * @returns The workspace, or why no proof will be run
 */
export async function openAttestWorkspace(
  request: ProofWorkspaceRequest,
  choice: AttestWorkspaceChoice = {}
): Promise<ProofWorkspaceOpening> {
  if (choice.open !== undefined) return choice.open(request);
  return request.named === undefined
    ? openDisposableCopy(request, choice)
    : openDirectProofWorkspace(request);
}
