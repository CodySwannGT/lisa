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
 * ## The root's controls come first
 *
 * Vitest initialises the root project's global setup after this one, so this
 * setup runs the same two controls itself before it creates any demand. It
 * refuses an untrusted temporary root, as the root's scratch setup does,
 * before writing or executing anything there. It then waits for fleet
 * admission, as the root's admission setup does, before downloading. Both are
 * read-only and run again in the root's own setup, which is harmless.
 *
 * ## Where the scope lives
 *
 * The scope is created inside an owner-marked scratch run root of this
 * process, so a run killed outright (SIGKILL) leaves nothing the next run's
 * scratch sweep cannot reclaim. Teardown, a failed acquisition and process
 * exit (which Vitest also uses for SIGINT and SIGTERM) remove it directly.
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
import { dirname } from "node:path";

import type { TestProject } from "vitest/node";

import { awaitFleetAdmission } from "../../src/configs/vitest/fleet-admission-global-setup.js";
import {
  materializeOwnedScratchRunRoot,
  prepareOwnedScratchRunRoot,
  removeOwnedScratchRunRoot,
} from "../../src/configs/vitest/scratch-run-root-intent.js";
import { describeTmpdirTrustFailure } from "../../src/configs/vitest/scratch-tmpdir-trust.js";
import {
  PREPARATION_KEY,
  PROVISION_CLI,
  prepareHistoryScanner,
  type HistoryScannerPreparation,
  type PreparedScope,
} from "./history-scanner-preparation.js";

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
 * Run the root's controls, then the one cold acquisition inside an owned root.
 * @returns The preparation and the dispose that releases everything it made
 */
async function prepareInOwnedRoot(): Promise<PreparedScope> {
  const untrusted = describeTmpdirTrustFailure();
  if (untrusted !== undefined)
    return refused(
      `The temporary root is not trusted, so no scanner was acquired. ${untrusted}`
    );
  await awaitFleetAdmission();
  const root = materializeOwnedScratchRunRoot(prepareOwnedScratchRunRoot());
  const release = (): void => removeOwnedScratchRunRoot(root);
  const prepared = await prepareHistoryScanner({ parent: root.path }).catch(
    (error: unknown) => {
      release();
      throw error;
    }
  );
  const dispose = (): void => {
    process.off("exit", dispose);
    prepared.dispose();
    release();
  };
  process.once("exit", dispose);
  return { preparation: prepared.preparation, dispose };
}

/**
 * Acquire once, provide the result, and hand back the cleanup.
 * @param project - The history-scanner project this setup belongs to
 * @returns Teardown that removes the owned preparation scope and its root
 */
export async function setup(project: TestProject): Promise<() => void> {
  const { preparation, dispose } = await prepareInOwnedRoot().catch(
    (error: unknown) =>
      refused(
        `The cold scanner preparation failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`
      )
  );
  process.stderr.write(evidenceLine(preparation));
  project.provide(PREPARATION_KEY, preparation);
  return dispose;
}
