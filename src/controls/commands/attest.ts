/**
 * `lisa controls attest [path] [--workspace <folder>] [--json] [--check]`:
 * run the paired proof of every control in the register, say which ones
 * work, and write down what was found.
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
 * The changes are planted in a disposable copy of the repository and taken
 * back out, never in the repository itself; see `../proof-workspace.ts`.
 *
 * When the proofs have run, three files are written in the repository, in
 * this order: the evidence, the control register, and the verdict with a
 * digest of the other two; see `../attest-record.ts`. When no proof was run
 * (exit 2), nothing is written.
 *
 * With `--check` it runs no proof and writes nothing: it computes the
 * verdict again from the committed register and evidence and exits non-zero
 * when the committed verdict differs; see `../attest-check.ts`.
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
import { resolveRepositoryRoot } from "../audit-report-file.js";
import { GATES_DECLARATION_PATH } from "../gates-declaration.js";
import { proofSummary, renderProofTable } from "../proof-report.js";
import { proofRunOf, runPairedProofs } from "../proof-runner.js";
import { loadProofTools, type ProofTools } from "../proof-tools.js";
import type { ProofRun } from "../proof-types.js";
import {
  openDirectProofWorkspace,
  type OpenProofWorkspace,
} from "../proof-workspace.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "../register.js";

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
  /** A disposable copy of the repository to plant the changes in. */
  readonly workspace?: string;
  /** Print the results as one JSON document instead of a table. */
  readonly json?: boolean;
  /** Run no proof: check the committed verdict against what produces it. */
  readonly check?: boolean;
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
}

/** The proofs' results, or one line per reason none was run. */
type Attempt =
  | { readonly problems: null; readonly run: ProofRun }
  | { readonly problems: readonly string[]; readonly summary: string };

/**
 * Run every proof of one repository, without printing anything.
 * @param named - Absolute path of the repository the operator named
 * @param workspace - Absolute path of the disposable copy, when one was named
 * @param dependencies - Replaceable collaborators
 * @returns The results, or why no proof was run
 */
async function attempt(
  named: string,
  workspace: string | undefined,
  dependencies: AttestDependencies
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
  const opening = await (
    dependencies.openWorkspace ?? openDirectProofWorkspace
  )({ root, named: workspace, tools });
  if (opening.problem !== null) {
    return {
      problems: [opening.problem],
      summary: "No disposable copy of the repository to run the proofs in",
    };
  }
  try {
    return {
      problems: null,
      run: await runPairedProofs({
        register,
        root,
        workspace: opening.workspace,
        judge: tools.judge,
        ...(dependencies.clock === undefined
          ? {}
          : { clock: dependencies.clock }),
      }),
    };
  } finally {
    await opening.close();
  }
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
  if (options.check === true) return runAttestCheck(targetPath, dependencies);
  const attempted = await attempt(
    path.resolve(cwd, targetPath ?? "."),
    options.workspace === undefined
      ? undefined
      : path.resolve(cwd, options.workspace),
    dependencies
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
  const recorded = await recordAttestation(
    {
      named: path.resolve(cwd, targetPath ?? "."),
      run,
      now: (dependencies.clock ?? (() => new Date()))(),
    },
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
  stderr(
    run.entries.length === 0
      ? `${ATTEST_COMMAND}: FAIL. The control register has no entries, so there is nothing to prove. Declare the controls in the gates block of ${GATES_DECLARATION_PATH} first`
      : `${ATTEST_COMMAND}: FAIL. ${proofSummary(run)}. Every entry has to pass`
  );
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
      "A disposable copy of the repository to plant the proof changes in; nothing is planted in the repository itself"
    )
    .option(
      "--json",
      "Print the results as one JSON document instead of a table"
    )
    .option(
      "--check",
      "Run no proof and write nothing: fail when the committed verdict differs from what the committed register and evidence give"
    )
    .action(async (targetPath: string | undefined, options: AttestOptions) => {
      const code = await dependencies.runAttest(targetPath, {
        ...(typeof options.workspace === "string"
          ? { workspace: options.workspace }
          : {}),
        json: options.json === true,
        ...(options.check === true ? { check: true } : {}),
      });
      if (code !== 0) process.exitCode = code;
    });
}
