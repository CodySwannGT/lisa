/**
 * Vitest globalSetup for the `history-scanner` project.
 *
 * Runs once per invocation, before any of that project's suites, and only when
 * the run's selected files include one of them: Vitest initialises a project's
 * global setup only for projects with files to run (`vitest.config.local.ts`).
 * It performs the invocation's one genuine cold acquisition of the pinned
 * scanner (`tests/helpers/history-scanner-preparation.ts`) and provides the
 * result to that project's suites, which take it through
 * `tests/helpers/history-scanner-handoff.ts`.
 *
 * ## The temporary root is checked first
 *
 * Vitest initialises the root project's global setup after this one, so this
 * setup runs the root's TMPDIR trust check itself, before it writes or executes
 * anything there. The check is read-only, so running it again in the root's
 * setup costs nothing.
 *
 * Fleet admission is left to the root. It bounds worker-pool demand, and the
 * root's admission still runs before any worker starts. A download is not pool
 * demand, and a second call here would give an over-capacity run a second full
 * admission deadline.
 *
 * ## Where the scope lives
 *
 * In a run supervised by `lisa-test-run`, the scope sits in a worker-style
 * scope inside the run's leased suite root. The supervisor reaps that root even
 * after SIGKILL, and it adds no second run root for sibling runs to count. In
 * an unsupervised run, it sits in an owned run root of this process, as each
 * unsupervised worker's does, which the next run's sweep reclaims after a kill.
 *
 * Teardown, a failed acquisition and process exit release it directly. Vitest
 * also turns SIGINT and SIGTERM into a process exit. The exit release is armed
 * before the download starts.
 *
 * ## A failure fails only the suites that need a scanner
 *
 * A failed acquisition is provided rather than thrown, and so is any
 * unexpected error here. Throwing would abort every project's suites in the
 * same run; providing the failure fails exactly the suites that need a
 * scanner, with its truthful reason, while the rest of the run still reports.
 *
 * One `HISTORY_SCANNER_COLD_PREPARATION` line on stderr records the command,
 * outcome, elapsed time, deadline, enforced archive pin, measured executable
 * digest and version. Machine-local paths are replaced so the line can be
 * quoted as evidence.
 * @module tests/helpers/history-scanner-global-setup
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { TestProject } from "vitest/node";

import {
  PREPARATION_KEY,
  PROVISION_CLI,
  prepareHistoryScanner,
  type ColdProvisionOptions,
  type HistoryScannerPreparation,
  type PreparedScope,
} from "./history-scanner-preparation.js";
import { errorMessage, writeStderrSync } from "./stderr-sync.js";

/** A reclaimable directory for the scope, and how to remove it. */
interface ReclaimableDirectory {
  readonly path: string;
  readonly remove: () => void;
}

/** A reclaimable directory for the scope, and its exit-armed release. */
interface OwnedParent {
  readonly path: string;
  readonly release: () => void;
}

/**
 * The evidence line, without machine-local paths.
 * @param preparation - The invocation's preparation
 * @returns One line safe to quote
 */
function evidenceLine(preparation: HistoryScannerPreparation): string {
  const { evidence } = preparation;
  const destination = evidence?.argv.at(-1);
  const record = {
    ok: preparation.ok,
    ...(preparation.ok ? {} : { reason: preparation.reason }),
    ...(evidence === null
      ? {}
      : {
          ...evidence,
          argv: ["node", PROVISION_CLI, ...evidence.argv.slice(2)],
        }),
  };
  const text = JSON.stringify(record);
  return `HISTORY_SCANNER_COLD_PREPARATION ${
    destination === undefined
      ? text
      : text.replaceAll(dirname(destination), "<owned-scope>")
  }\n`;
}

/**
 * A failure that happened before any provision child ran.
 * @param reason - Why the preparation could not run
 * @returns The failed preparation and a dispose with nothing to release
 */
function refused(reason: string): PreparedScope {
  return {
    preparation: { ok: false, reason, evidence: null },
    dispose: () => undefined,
  };
}

/**
 * Create the reclaimable parent directory for the scope.
 *
 * Exported so a unit test pins where the scope lives
 * (`tests/unit/helpers/history-scanner-global-setup.test.ts`).
 * @returns Its path and a remover for it
 */
export function reclaimableDirectory(): ReclaimableDirectory {
  const root = mkdtempSync(join(tmpdir(), "lisa-history-scanner-"));
  return {
    path: root,
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Create the parent and arm its release on process exit before anything runs.
 *
 * The release never throws: a failure is reported on stderr instead, because
 * an exception thrown from an exit listener would crash the process. The
 * report is written synchronously, since an asynchronous write to a piped
 * stderr is abandoned at exit (`tests/helpers/stderr-sync.ts`). The next run's
 * start-of-run cleanup sweep reclaims whatever a failed release leaves behind.
 *
 * The scope's own exit listener is prepended
 * (`tests/helpers/history-scanner-preparation.ts`), so at exit it stops the
 * provision child and removes the scope before this release runs, in the same
 * order as the normal teardown.
 * @param directory - The parent to own. Only a unit test passes one, to make
 *   its removal fail; the setup takes the default.
 * @returns The parent and its idempotent, exit-armed release
 */
export function ownedParent(
  directory: ReclaimableDirectory = reclaimableDirectory()
): OwnedParent {
  const release = (): void => {
    process.off("exit", release);
    try {
      directory.remove();
    } catch (error) {
      writeStderrSync(
        `history-scanner preparation: its temp directory could not be released (${errorMessage(error)}); the next run's cleanup sweep reclaims it.\n`
      );
    }
  };
  process.once("exit", release);
  return { path: directory.path, release };
}

/**
 * Check the temporary root, then run the one cold acquisition in an owned parent.
 * @param options - Test-only seam: a stub provision child's argv. The setup
 *   passes nothing, so the genuine acquisition still takes no options.
 * @returns The preparation and the dispose that releases everything it made
 */
export async function prepareInOwnedParent(
  options: Pick<ColdProvisionOptions, "argv"> = {}
): Promise<PreparedScope> {
  const parent = ownedParent();
  const prepared = await prepareHistoryScanner({
    ...options,
    parent: parent.path,
  }).catch((error: unknown) => {
    parent.release();
    throw error;
  });
  return {
    preparation: prepared.preparation,
    dispose: () => {
      prepared.dispose();
      parent.release();
    },
  };
}

/**
 * Acquire once, provide the result, and hand back the cleanup.
 * @param project - The history-scanner project this setup belongs to
 * @returns Teardown that removes the owned preparation scope and its parent
 */
export async function setup(project: TestProject): Promise<() => void> {
  const { preparation, dispose } = await prepareInOwnedParent().catch(
    (error: unknown) =>
      refused(
        `The cold scanner preparation failed unexpectedly: ${errorMessage(error)}`
      )
  );
  process.stderr.write(evidenceLine(preparation));
  project.provide(PREPARATION_KEY, preparation);
  return dispose;
}
