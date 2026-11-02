/**
 * Vitest globalSetup for the `history-scanner` project.
 *
 * Runs once per invocation, before any of that project's suites, and only when
 * the run contains one of them: Vitest initialises a project's global setup
 * only for projects with files to run (`vitest.config.local.ts`). It performs
 * the invocation's one genuine cold acquisition of the pinned scanner
 * (`tests/helpers/history-scanner-preparation.ts`) and provides the result to
 * that project's suites, which take it through
 * `tests/helpers/history-scanner-handoff.ts`.
 *
 * A failed acquisition is provided too, rather than thrown. Throwing here
 * would abort every project's suites in the same run; providing the failure
 * fails exactly the suites that need a scanner, with the acquisition's own
 * truthful reason, while the rest of the run still reports.
 *
 * One `HISTORY_SCANNER_COLD_PREPARATION` line on stderr records the command,
 * outcome, elapsed time, deadline, archive and executable digests and version.
 * Machine-local paths are replaced so the line can be quoted as evidence.
 * @module tests/helpers/history-scanner-global-setup
 */
import { dirname } from "node:path";

import type { TestProject } from "vitest/node";

import {
  PREPARATION_KEY,
  PROVISION_CLI,
  prepareHistoryScanner,
  type HistoryScannerPreparation,
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
 * Acquire once, provide the result, and hand back the cleanup.
 * @param project - The history-scanner project this setup belongs to
 * @returns Teardown that removes the owned preparation scope
 */
export async function setup(project: TestProject): Promise<() => void> {
  const { preparation, dispose } = await prepareHistoryScanner();
  process.stderr.write(evidenceLine(preparation));
  project.provide(PREPARATION_KEY, preparation);
  return dispose;
}
