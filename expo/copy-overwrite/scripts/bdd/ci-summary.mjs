// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Publish the calculated aggregate from the same run that sets the CLI exit. */
import * as fs from "node:fs";

import { cell } from "./markdown-cell.mjs";
import { renderBurndown } from "./render.mjs";

/**
 * Append a native GitHub job summary without rerunning or weakening the gate.
 * Invalid input has no trustworthy totals, even if diagnostic data exists.
 * @param {object} gateRun - Actual report, final status and original defects.
 * @param {string|undefined} destination - Native GITHUB_STEP_SUMMARY path.
 * @returns {void}
 */
export function appendCiSummary(gateRun, destination) {
  if (!destination) return;
  const aggregate =
    gateRun.report && gateRun.status !== "invalid"
      ? renderBurndown(gateRun.report).trim()
      : "**Global totals unavailable:** the behavior contract could not be evaluated.";
  const findings = gateRun.defects.length
    ? [
        "| Finding | Detail |",
        "|---|---|",
        ...gateRun.defects.map(
          item => `| ${cell(item.code)} | ${cell(item.message)} |`
        ),
      ].join("\n")
    : "No findings.";
  fs.appendFileSync(
    destination,
    `\n### BDD aggregate result: ${cell(gateRun.status)}\n\n${aggregate}\n\n${findings}\n`,
    "utf8"
  );
}
