/**
 * `lisa controls attest [path] [--workspace <folder>] [--json] [--check]
 * [--pull-request-canaries] [--acknowledge-external-effects]
 * [--before-enforce]`: run the
 * paired proof of every control in the register, say which ones work, and
 * write down what was found.
 *
 * A control works when its check turns away a change that breaks its rule
 * and lets a clean change through. This command plants both changes, one at
 * a time, runs the check on each, and prints one result per register entry:
 * `passed`, `failed` (naming the half), `unproved` or `unknown`. It is code
 * from end to end: no model is asked anything, so the same repository always
 * gets the same results.
 *
 * It exits 0 only when there is at least one entry and every entry passed.
 * It exits 1 when the proofs ran and some entry did not pass, or when the
 * register has no entries to prove. It exits 2 when there are no results at
 * all: the path is not a folder, the gates declaration is refused, there is
 * no disposable copy to work in, or the run could not finish.
 *
 * The changes are planted in a disposable copy of the repository and never
 * in the repository itself. With no `--workspace`, the command makes that
 * copy in a temporary folder, proves each check through a real commit or
 * push there, and removes the folder on every way out; see
 * `./attest-workspace.ts`.
 *
 * When the proofs have run, three files are written in the repository, in
 * this order: the evidence, the control register, and the verdict with a
 * digest of the other two; see `../attest-record.ts`. When no proof was run
 * (exit 2), nothing is written.
 *
 * With `--workspace <folder>` the command is a report and writes nothing. It
 * starts each check's own command in the folder named
 * (`../proof-workspace.ts`) and makes no commit or push, which shows that a
 * check works and not that anything runs it. It prints the same results and
 * one line that says nothing was written; see `./attest-report-only.ts`.
 *
 * With `--check` it runs no proof and writes nothing: it computes the
 * verdict again from the committed register and evidence and exits non-zero
 * when the committed verdict differs, or when what defines the checks is no
 * longer what the proofs ran against; see `../attest-check.ts`. That is
 * asked of content, so no order of committing is required of the operator.
 *
 * Whether a pull request is stopped is the hosting platform's to say. By
 * default the command only reads the platform's merge-protection settings
 * and records each pull-request entry at the `observed` rung; it creates
 * nothing there. With `--pull-request-canaries` it opens real pull requests
 * under the reserved branch prefix `lisa-attest/`, reads whether the
 * platform would let each through, and removes them. It never merges one.
 * See `../pull-request-settle.ts`. What the platform said is written to the
 * evidence file with everything else; see `../pull-request-evidence.ts`.
 * Whatever such a run could not remove is named on standard error, one line
 * each, in both output modes, and on every way out once the proofs are in:
 * also when the results could not be written down, and when the run's own
 * copy could not be removed. A canary the platform says was merged, or a
 * protected branch that moved with a canary unaccounted for, exits 1
 * whatever the proofs showed; see `../pull-request-notices.ts`.
 *
 * A proof that declares an effect outside the repository is run only with
 * `--acknowledge-external-effects`. Without it the entry is `unknown` and
 * the declared effect is quoted.
 *
 * With `--before-enforce` it asks a different question, before anything is
 * installed: which checks exist and are not enforced? It installs no
 * carrier, writes none of the three files, and has its own result words and
 * exit codes; see `./attest-before-enforce.ts`.
 *
 * It works in a repository where Lisa was never applied. The requirements,
 * the gate registry and the gate runner come from the Lisa package the
 * command runs from; nothing is read from the host but `.lisa.config.json`,
 * `package.json` when there is one, and the patch files under
 * `.lisa/controls/proofs/`.
 * @module controls/commands/attest
 */
import path from "node:path";

import type { Command } from "commander";

import { runAttestCheck } from "../attest-check.js";
import { recordAttestation } from "../attest-record.js";
import { GATES_DECLARATION_PATH } from "../gates-declaration.js";
import { proofSummary, renderProofTable } from "../proof-report.js";
import type { ProofRun } from "../proof-types.js";
import { reportCanaryNotices } from "../pull-request-notices.js";
import {
  attempt,
  refusedPair,
  toRecord,
  type Attempt,
} from "./attest-attempt.js";
import {
  BEFORE_ENFORCE_FLAG,
  runAttestBeforeEnforce,
} from "./attest-before-enforce.js";
import { runAttestHostProof } from "./attest-host-proof.js";
import {
  ATTEST_COMMAND,
  ATTEST_EXIT,
  type AttestDependencies,
  type AttestOptions,
} from "./attest-options.js";
import {
  printReportOnly,
  type ReportOnlyOutput,
} from "./attest-report-only.js";

export {
  ATTEST_COMMAND,
  ATTEST_EXIT,
  type AttestDependencies,
  type AttestOptions,
} from "./attest-options.js";

/**
 * Tell whether the operator asked for one of the two modes that prove no
 * control and write nothing.
 * @param options - What the operator asked for
 * @returns Whether it is `--before-enforce` or `--check`
 */
function asksOther(options: AttestOptions): boolean {
  return options.beforeEnforce === true || options.check === true;
}

/**
 * Run the mode the operator asked for in place of the proofs. Each has its
 * own exit codes.
 * @param targetPath - The repository; the working directory when left out
 * @param options - What the operator asked for
 * @param dependencies - Replaceable collaborators
 * @returns The mode's exit code
 */
function otherMode(
  targetPath: string | undefined,
  options: AttestOptions,
  dependencies: AttestDependencies
): Promise<number> {
  // Before anything is installed: which checks exist and are not enforced?
  // Asked together with --check, it refuses the pair itself.
  return options.beforeEnforce === true
    ? runAttestBeforeEnforce(targetPath, options, dependencies)
    : runAttestCheck(targetPath, dependencies);
}

/**
 * Decide whether to import hosted evidence instead of running local controls.
 * @param targetPath - Operator's checkout argument
 * @param options - The selected mode and paths
 * @param dependencies - Output, clock and working directory
 * @returns The import's exit code, or null when neither import flag was used
 */
function importMode(
  targetPath: string | undefined,
  options: AttestOptions,
  dependencies: Required<
    Pick<AttestDependencies, "stdout" | "stderr" | "cwd">
  > &
    Pick<AttestDependencies, "clock">
): Promise<number> | null {
  const { importHostProof, hostProofSigningKey } = options;
  if (importHostProof === undefined && hostProofSigningKey === undefined)
    return null;
  const { cwd, stdout, stderr } = dependencies;
  if (importHostProof === undefined || hostProofSigningKey === undefined) {
    stderr(
      "attest: FAIL. Give both --import-host-proof and --host-proof-signing-key."
    );
    return Promise.resolve(ATTEST_EXIT.NOT_RUN);
  }
  if (
    asksOther(options) ||
    options.workspace !== undefined ||
    options.pullRequestCanaries === true
  ) {
    stderr("attest: FAIL. Run the host proof import on its own.");
    return Promise.resolve(ATTEST_EXIT.NOT_RUN);
  }
  return runAttestHostProof({
    directory: path.resolve(cwd, targetPath ?? "."),
    bundle: path.resolve(cwd, importHostProof),
    signingKey: path.resolve(cwd, hostProofSigningKey),
    now: (dependencies.clock ?? (() => new Date()))(),
    json: options.json === true,
    stdout,
    stderr,
  }).catch(() => {
    stderr(
      "attest: FAIL. Could not finish validating the host proof and its receipt."
    );
    return ATTEST_EXIT.NOT_RUN;
  });
}

/**
 * Print the results of a run in a folder the operator named, which records
 * nothing, and give its exit code.
 * @param run - The results
 * @param json - Whether to print one JSON document instead of a table
 * @param output - Where the lines go
 * @returns The exit code: what the checks did, as without the option
 */
function reportedOnly(
  run: ProofRun,
  json: boolean,
  output: ReportOnlyOutput
): number {
  printReportOnly(run, json, output, ATTEST_COMMAND);
  return run.passed ? ATTEST_EXIT.PASSED : ATTEST_EXIT.NOT_PASSED;
}

/**
 * The line that says a run's proofs did not all pass.
 * @param run - The results
 * @returns The line
 */
function notPassedLine(run: ProofRun): string {
  return run.entries.length === 0
    ? `${ATTEST_COMMAND}: FAIL. The control register has no entries, so there is nothing to prove. Declare the controls in the gates block of ${GATES_DECLARATION_PATH} first`
    : `${ATTEST_COMMAND}: FAIL. ${proofSummary(run)}. Every entry has to pass`;
}

/**
 * Run the paired proof of every control of one repository and print the
 * results.
 * @param targetPath - The repository; the working directory when left out
 * @param options - The disposable copy, and whether to print JSON
 * @param dependencies - Replaceable collaborators
 * @returns The exit code; see {@link ATTEST_EXIT}
 */
export async function runAttest(
  targetPath: string | undefined,
  options: AttestOptions = {},
  dependencies: AttestDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const cwd = dependencies.cwd ?? process.cwd();
  const importing = importMode(targetPath, options, {
    ...dependencies,
    cwd,
    stdout,
    stderr,
  });
  if (importing !== null) return importing;
  if (asksOther(options)) return otherMode(targetPath, options, dependencies);
  const attempted = await (
    refusedPair(options) ??
    attempt(
      path.resolve(cwd, targetPath ?? "."),
      options.workspace === undefined
        ? undefined
        : path.resolve(cwd, options.workspace),
      dependencies,
      options
    )
  ).catch(
    (error: unknown): Attempt => ({
      problems: [error instanceof Error ? error.message : String(error)],
      summary: "The proofs did not finish, so there are no results",
    })
  );
  if (attempted.problems !== null) {
    // The proofs can be in before a run fails. A run that opened canary
    // pull requests says what it left behind however it ends.
    if (attempted.run !== undefined) reportCanaryNotices(attempted.run, stderr);
    attempted.problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(`${ATTEST_COMMAND}: FAIL. ${attempted.summary}`);
    return ATTEST_EXIT.NOT_RUN;
  }
  // In a folder the operator named, each check's own command was started
  // and no commit or push was made. That is a report and not a proof:
  // nothing is written; see ./attest-report-only.ts.
  if (options.workspace !== undefined) {
    return reportedOnly(attempted.run, options.json === true, {
      stdout,
      stderr,
    });
  }
  return writtenDown(
    path.resolve(cwd, targetPath ?? "."),
    attempted,
    options.json === true,
    { ...dependencies, stdout, stderr }
  );
}

/**
 * Write down what a run found, print it, and say how the run ended.
 *
 * Whatever a canary run could not undo on the hosting platform is put on
 * standard error on both ways out: with the results, and when the results
 * could not be written down.
 * @param named - Absolute path of the repository the operator named
 * @param attempted - The run's results, and what they are bound to
 * @param json - Whether to print one JSON document instead of a table
 * @param dependencies - Replaceable collaborators, and where lines go
 * @returns The exit code; see {@link ATTEST_EXIT}
 */
async function writtenDown(
  named: string,
  attempted: Extract<Attempt, { readonly problems: null }>,
  json: boolean,
  dependencies: AttestDependencies & {
    readonly stdout: (line: string) => void;
    readonly stderr: (line: string) => void;
  }
): Promise<number> {
  const { stdout, stderr } = dependencies;
  const { run } = attempted;
  const now = (dependencies.clock ?? (() => new Date()))();
  const recorded = await toRecord(named, attempted, now)
    .then(found => recordAttestation(found, dependencies))
    .catch((error: unknown) => ({
      problems: [error instanceof Error ? error.message : String(error)],
    }));
  if (recorded.problems !== null) {
    reportCanaryNotices(run, stderr);
    recorded.problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(
      `${ATTEST_COMMAND}: FAIL. The proofs ran, but what they found could not be written down, so there is no verdict`
    );
    return ATTEST_EXIT.NOT_RUN;
  }
  const lines = json
    ? [JSON.stringify(run, null, 2)]
    : [
        ...renderProofTable(run),
        ...recorded.lines.map(line => `${ATTEST_COMMAND}: ${line}`),
      ];
  lines.forEach(line => {
    stdout(line);
  });
  // Said in both output modes: what an earlier run recorded and this one
  // dropped, and any file that is not here as it was where the proofs ran.
  recorded.warnings.forEach(line => {
    stderr(`${ATTEST_COMMAND}: note. ${line}`);
  });
  return conclude(run, json, { stdout, stderr });
}

/**
 * Say how a run whose results were printed ended, and give its exit code.
 *
 * Before the verdict, in either output mode, whatever a canary run could
 * not undo on the hosting platform is put on standard error, and that can
 * fail the run by itself; see `../pull-request-notices.ts`.
 * @param run - The finished run
 * @param json - Whether the results were printed as one JSON document
 * @param io - Where a line for a person goes
 * @param io.stdout - Prints one line on standard output
 * @param io.stderr - Prints one line on standard error
 * @returns The exit code; see {@link ATTEST_EXIT}
 */
function conclude(
  run: ProofRun,
  json: boolean,
  io: {
    readonly stdout: (line: string) => void;
    readonly stderr: (line: string) => void;
  }
): number {
  if (reportCanaryNotices(run, io.stderr)) return ATTEST_EXIT.NOT_PASSED;
  if (run.passed) {
    if (!json) io.stdout(`${ATTEST_COMMAND}: PASS. ${proofSummary(run)}`);
    return ATTEST_EXIT.PASSED;
  }
  io.stderr(notPassedLine(run));
  return ATTEST_EXIT.NOT_PASSED;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface AttestCommandDependencies {
  readonly runAttest: (
    targetPath: string | undefined,
    options: AttestOptions
  ) => Promise<number>;
}

/**
 * Register `attest` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerAttest(
  group: Command,
  dependencies: AttestCommandDependencies = {
    runAttest: (targetPath, options) => runAttest(targetPath, options),
  }
): void {
  group
    .command(ATTEST_COMMAND)
    .description(
      "Run the paired proof of every control: a change that breaks its rule must be rejected and a clean change accepted"
    )
    .argument("[path]", "Project path (default: current directory)")
    .option(
      "--workspace <folder>",
      "Report only: start each check's own command in a copy of the repository you made, print the results, and write nothing. No commit or push is made there, so this shows whether a check works and not whether anything runs it, and it never counts as a proof. Without this option the command makes its own temporary copy, proves each check through a real commit or push there, removes the copy, and writes the results to three files under .lisa/controls/: evidence.json, register.json and verdict.json. Either way the proofs change nothing else in the repository itself"
    )
    .option(
      "--json",
      "Print the results as one JSON document instead of a table"
    )
    .option(
      "--check",
      "Run no proof and write nothing: fail when the committed verdict differs from what the committed register and evidence give, or when a file that defines the checks no longer holds what the proofs ran against. Reads the files and no version history, so it answers the same in any clone"
    )
    .option(
      "--pull-request-canaries",
      "Exercise pull-request controls with real pull requests on the hosting platform: each is opened from a branch under lisa-attest/, read, closed and removed, and is never merged. Without this option the platform's merge-protection settings are only read and nothing is created"
    )
    .option(
      "--import-host-proof <file>",
      "Verify an independently signed pull-request proof and record it through attest"
    )
    .option(
      "--host-proof-signing-key <file>",
      "Protected private key outside the checkout for signing an imported proof receipt"
    )
    .option(
      "--acknowledge-external-effects",
      "Run proofs that declare an effect outside the repository. Without this option such an entry is unknown and its declared effect is quoted"
    )
    .option(
      BEFORE_ENFORCE_FLAG,
      "Before anything is installed: commit or push each check's violating change for real in a fresh clone with no hook installed, and run the check's own command on it. A change that goes through is a check that exists and is not enforced. Writes nothing: no evidence, register or verdict. Exit 0 every entry was answered, 1 an entry gave no answer, 2 nothing was tried"
    )
    .action(async (targetPath: string | undefined, options: AttestOptions) => {
      const code = await dependencies.runAttest(targetPath, {
        ...(options.beforeEnforce === true ? { beforeEnforce: true } : {}),
        ...(typeof options.workspace === "string"
          ? { workspace: options.workspace }
          : {}),
        json: options.json === true,
        ...(options.check === true ? { check: true } : {}),
        ...(options.pullRequestCanaries === true
          ? { pullRequestCanaries: true }
          : {}),
        ...(options.importHostProof === undefined
          ? {}
          : { importHostProof: options.importHostProof }),
        ...(options.hostProofSigningKey === undefined
          ? {}
          : { hostProofSigningKey: options.hostProofSigningKey }),
        ...(options.acknowledgeExternalEffects === true
          ? { acknowledgeExternalEffects: true }
          : {}),
      });
      if (code !== 0) process.exitCode = code;
    });
}
