/**
 * What `lisa controls attest --workspace <folder>` prints, and why it writes
 * nothing.
 *
 * A control is proved when the moment it is enforced at is triggered for
 * real: a commit or a push is made, and what answers is git's hook, the
 * carrier, the gate runner and then the check. That is what the command does
 * in the copy it makes for itself.
 *
 * In a folder the operator named it does something weaker. It starts each
 * check's own command there and makes no commit and no push
 * (`../proof-workspace.ts`). A check that turns the violating change away
 * that way works. Nothing has shown that anything runs it: a repository with
 * no hook installed at all gets the same answer. Written down as evidence,
 * that answer would read as an exercised proof at the commit moment and make
 * a requirement conforming, which is a different proof under the same name.
 *
 * So a run with `--workspace` is a report. It prints the same results, says
 * once that nothing was written, and writes no evidence, no register and no
 * verdict. It cannot raise the rung of any requirement, and it leaves what an
 * earlier run recorded exactly as it was.
 * @module controls/commands/attest-report-only
 */
import { renderProofTable } from "../proof-report.js";
import type { ProofRun } from "../proof-types.js";

/** Where a report's lines go. */
export interface ReportOnlyOutput {
  /** Where the results go, one line per call. */
  readonly stdout: (line: string) => void;
  /** Where the line that says nothing was written goes. */
  readonly stderr: (line: string) => void;
}

/**
 * The one line that says a run recorded nothing, and what to run instead.
 * @param run - The results
 * @returns The line, without the command's name in front
 */
export function reportOnlyLine(run: ProofRun): string {
  const { passed, failed, unproved, unknown } = run.counts;
  return `REPORT ONLY. ${String(passed)} passed, ${String(failed)} failed, ${String(unproved)} unproved, ${String(unknown)} unknown. With --workspace each check's own command is started in the folder you named and no commit or push is made, so this shows whether a check works and not whether anything runs it. Nothing was written: no evidence, no register and no verdict, and no requirement counts as proved. Run "lisa controls attest" without --workspace to prove the controls.`;
}

/**
 * Print the results of a run that records nothing.
 *
 * The results go to standard output, as a table or as one JSON document.
 * The line that says nothing was written goes to standard error, so that
 * standard output holds the results and nothing else either way.
 * @param run - The results
 * @param json - Whether to print one JSON document instead of a table
 * @param output - Where the lines go
 * @param name - The command's name, which starts the line
 */
export function printReportOnly(
  run: ProofRun,
  json: boolean,
  output: ReportOnlyOutput,
  name: string
): void {
  const lines = json ? [JSON.stringify(run, null, 2)] : renderProofTable(run);
  lines.forEach(line => {
    output.stdout(line);
  });
  output.stderr(`${name}: ${reportOnlyLine(run)}`);
}
