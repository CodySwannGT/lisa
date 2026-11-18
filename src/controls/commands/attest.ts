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
 * when the committed verdict differs; see `../attest-check.ts`.
 *
 * Whether a pull request is stopped is the hosting platform's to say. By
 * default the command only reads the platform's merge-protection settings
 * and records each pull-request entry at the `observed` rung; it creates
 * nothing there. With `--pull-request-canaries` it opens real pull requests
 * under the reserved branch prefix `lisa-attest/`, reads whether the
 * platform would let each through, and removes them. It never merges one.
 * See `../pull-request-settle.ts`. What the platform said is written to the
 * evidence file with everything else; see `../pull-request-evidence.ts`.
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
import {
  recordAttestation,
  type AttestationToRecord,
} from "../attest-record.js";
import { resolveRepositoryRoot } from "../audit-report-file.js";
import { GATES_DECLARATION_PATH } from "../gates-declaration.js";
import { proofSummary, renderProofTable } from "../proof-report.js";
import { proofRunOf, runPairedProofs } from "../proof-runner.js";
import { loadProofTools, type ProofTools } from "../proof-tools.js";
import type { ProofRun } from "../proof-types.js";
import type { OpenProofWorkspace } from "../proof-workspace.js";
import { pullRequestBatches } from "../pull-request-evidence.js";
import {
  settlePullRequests,
  type PullRequestDependencies,
} from "../pull-request-settle.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "../register.js";
import {
  BEFORE_ENFORCE_FLAG,
  runAttestBeforeEnforce,
} from "./attest-before-enforce.js";
import {
  printReportOnly,
  type ReportOnlyOutput,
} from "./attest-report-only.js";
import { openAttestWorkspace } from "./attest-workspace.js";

/** The subcommand's name under `lisa controls`. */
export const ATTEST_COMMAND = "attest";

/** What the command's exit code says. */
export const ATTEST_EXIT = {
  /** There is at least one entry and every entry passed. */
  PASSED: 0,
  /** The proofs ran and some entry did not pass, or there are no entries. */
  NOT_PASSED: 1,
  /** There are no results: no proof was run, or the run could not finish. */
  NOT_RUN: 2,
} as const;

/** The command's options. */
export interface AttestOptions {
  /**
   * A copy of the repository the operator made, to start each check's own
   * command in. Naming one makes the run a report: nothing is written.
   */
  readonly workspace?: string;
  /** Print the results as one JSON document instead of a table. */
  readonly json?: boolean;
  /** Run no proof: check the committed verdict against what produces it. */
  readonly check?: boolean;
  /**
   * Open canary pull requests on the hosting platform to exercise the
   * pull-request moment. Off by default: the platform is only read.
   */
  readonly pullRequestCanaries?: boolean;
  /** Let a proof that says it reaches outside the repository run. */
  readonly acknowledgeExternalEffects?: boolean;
  /**
   * Install nothing and write nothing: find the checks that exist and that
   * nothing enforces yet. See `./attest-before-enforce.ts`.
   */
  readonly beforeEnforce?: boolean;
}

/** What the command needs from outside, each replaceable in a test. */
export interface AttestDependencies {
  /** The directory the path arguments are resolved from. */
  readonly cwd?: string;
  /** Where the results go, one line per call. */
  readonly stdout?: (line: string) => void;
  /** Where problems and a failing summary go, one line per call. */
  readonly stderr?: (line: string) => void;
  /** The clock every time in the results is read from. */
  readonly clock?: () => Date;
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Loads the gate runner's own parts. */
  readonly loadTools?: () => Promise<ProofTools>;
  /** Opens the workspace the changes are planted in. */
  readonly openWorkspace?: OpenProofWorkspace;
  /** What settling the pull-request moment needs from outside. */
  readonly pullRequests?: PullRequestDependencies;
}

/** The proofs' results, or one line per reason none was run. */
type Attempt =
  | {
      readonly problems: null;
      readonly run: ProofRun;
      /**
       * The commit the proofs were run against: the one the run's copy was
       * made from. Left out when no copy was made.
       */
      readonly commit?: string;
    }
  | { readonly problems: readonly string[]; readonly summary: string };

/**
 * Run every proof of one repository, without printing anything.
 * @param named - Absolute path of the repository the operator named
 * @param workspace - Absolute path of the disposable copy, when one was named
 * @param dependencies - Replaceable collaborators
 * @param options - What the operator asked for
 * @returns The results, or why no proof was run
 */
async function attempt(
  named: string,
  workspace: string | undefined,
  dependencies: AttestDependencies,
  options: AttestOptions = {}
): Promise<Attempt> {
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return {
      problems: [`${named} is not a folder.`],
      summary: "Give the path of the repository whose controls to prove",
    };
  }
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) {
    return {
      problems: generated.problems,
      summary: `The gates declaration in ${GATES_DECLARATION_PATH} was refused, so no proof was run. Fix the declaration, then run this again`,
    };
  }
  const { register } = generated;
  // Nothing to prove needs nowhere to prove it.
  if (register.entries.length === 0) {
    return { problems: null, run: proofRunOf([]) };
  }
  const tools = await (dependencies.loadTools ?? loadProofTools)();
  // With no folder named, this makes the run's own disposable copy and
  // removes it on every way out, a signal included; see ./attest-workspace.ts.
  const opening = await openAttestWorkspace(
    { root, named: workspace, tools },
    { open: dependencies.openWorkspace, notice: dependencies.stderr }
  );
  if (opening.problem !== null) {
    return {
      problems: [opening.problem],
      summary: "No disposable copy of the repository to run the proofs in",
    };
  }
  const asked = {
    acknowledgeExternalEffects: options.acknowledgeExternalEffects === true,
    ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
  };
  try {
    return {
      problems: null,
      ...(opening.commit === undefined ? {} : { commit: opening.commit }),
      // Commit and push are exercised here; the pull-request moment is the
      // hosting platform's to answer (`../pull-request-settle.ts`).
      run: await settlePullRequests(
        await runPairedProofs({
          register,
          root,
          workspace: opening.workspace,
          judge: tools.judge,
          ...asked,
        }),
        {
          root,
          register,
          canaries: options.pullRequestCanaries === true,
          ...asked,
        },
        dependencies.pullRequests
      ),
    };
  } finally {
    await opening.close();
  }
}

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
 * What a run that proved the controls hands over to be written down.
 * @param named - Absolute path of the repository the operator named
 * @param attempted - The run's results, and the commit they are about
 * @param now - The current time
 * @returns What the writer takes
 */
function toRecord(
  named: string,
  attempted: Extract<Attempt, { readonly problems: null }>,
  now: Date
): AttestationToRecord {
  const { run, commit } = attempted;
  return {
    named,
    run,
    now,
    // The commit that was cloned, not the one the repository is at now.
    ...(commit === undefined ? {} : { commit }),
    // What the hosting platform said about the pull-request moment; none
    // when the register has no pull-request entry.
    batches: pullRequestBatches(run, { root: named, now }),
  };
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
  if (asksOther(options)) return otherMode(targetPath, options, dependencies);
  const attempted = await attempt(
    path.resolve(cwd, targetPath ?? "."),
    options.workspace === undefined
      ? undefined
      : path.resolve(cwd, options.workspace),
    dependencies,
    options
  ).catch(
    (error: unknown): Attempt => ({
      problems: [error instanceof Error ? error.message : String(error)],
      summary: "The proofs did not finish, so there are no results",
    })
  );
  if (attempted.problems !== null) {
    attempted.problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(`${ATTEST_COMMAND}: FAIL. ${attempted.summary}`);
    return ATTEST_EXIT.NOT_RUN;
  }
  const { run } = attempted;
  // In a folder the operator named, each check's own command was started
  // and no commit or push was made. That is a report and not a proof:
  // nothing is written; see ./attest-report-only.ts.
  if (options.workspace !== undefined) {
    return reportedOnly(run, options.json === true, { stdout, stderr });
  }
  const named = path.resolve(cwd, targetPath ?? ".");
  const now = (dependencies.clock ?? (() => new Date()))();
  const recorded = await recordAttestation(
    toRecord(named, attempted, now),
    dependencies
  );
  if (recorded.problems !== null) {
    recorded.problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(
      `${ATTEST_COMMAND}: FAIL. The proofs ran, but what they found could not be written down, so there is no verdict`
    );
    return ATTEST_EXIT.NOT_RUN;
  }
  const lines =
    options.json === true
      ? [JSON.stringify(run, null, 2)]
      : [
          ...renderProofTable(run),
          ...recorded.lines.map(line => `${ATTEST_COMMAND}: ${line}`),
        ];
  lines.forEach(line => {
    stdout(line);
  });
  if (run.passed) {
    if (options.json !== true) {
      stdout(`${ATTEST_COMMAND}: PASS. ${proofSummary(run)}`);
    }
    return ATTEST_EXIT.PASSED;
  }
  stderr(notPassedLine(run));
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
      "Run no proof and write nothing: fail when the committed verdict differs from what the committed register and evidence give"
    )
    .option(
      "--pull-request-canaries",
      "Exercise pull-request controls with real pull requests on the hosting platform: each is opened from a branch under lisa-attest/, read, closed and removed, and is never merged. Without this option the platform's merge-protection settings are only read and nothing is created"
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
        ...(options.acknowledgeExternalEffects === true
          ? { acknowledgeExternalEffects: true }
          : {}),
      });
      if (code !== 0) process.exitCode = code;
    });
}
