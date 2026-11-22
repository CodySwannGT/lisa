/**
 * `lisa controls proof-check [path] [--acknowledge-external-effects]`: say,
 * for each declared part, whether its pair of test changes is one the attest
 * step can use, and what to change when it is not.
 *
 * ## Who it is for
 *
 * A paired proof is two patch files: a change that breaks a check's rule and
 * a change that does not. Writing them takes knowledge of the tool, so the
 * agent configuring a repository writes them. This command is how that agent
 * finds out whether what it wrote works, before anything is installed: it
 * runs the part's own command on each change and reads the answer the way
 * the attest step does.
 *
 * ## What it does
 *
 * For every part that names a patch file it asks, in order, and stops at the
 * first problem: are both patch files there and different; is failure text
 * declared; does each change apply to the last commit; does each touch a
 * file inside the part's own folder; and does the part's command fail on the
 * violating change with the declared failure text and pass on the clean one.
 * See `../proof-check-plan.ts` and `../proof-check-run.ts`.
 *
 * The changes are tried in a fresh clone of the last commit in a temporary
 * folder, built with no carriers (`../proof-copy.ts`), so it works before
 * any hook exists and with uncommitted work in the tree. The declaration and
 * the patch files are taken from the working copy as they are, committed or
 * not.
 *
 * ## What it writes
 *
 * Nothing. No file in the repository is created or changed, and nothing is
 * staged or committed there. It prints one JSON document on standard output
 * (`../proof-check-types.ts`) and one line per part on standard error.
 * Whatever a tool printed is passed through the same preparation an evidence
 * record gets, and the whole document is scanned once more before it is
 * printed, so a token a tool echoes is not shown.
 *
 * A `ready` is not a proof of a control. Only `lisa controls attest` says a
 * control works.
 *
 * ## Exit codes
 *
 * - 0: every part that declares a proof is ready, or no part declares one.
 * - 1: at least one part's proof is not ready. The document is complete.
 * - 2: nothing could be checked: the path is not a folder, the gates
 *   declaration is refused, the temporary copy could not be made, or the run
 *   could not finish. Nothing is printed on standard output.
 * @module controls/commands/proof-check
 */
import path from "node:path";

import type { Command } from "commander";

import { resolveRepositoryRoot } from "../audit-report-file.js";
import { GATES_DECLARATION_PATH } from "../gates-declaration.js";
import {
  isDeclaredPart,
  planProofCheck,
  type ProofCheckPlan,
} from "../proof-check-plan.js";
import {
  PROOF_CHECK_NAME,
  proofCheckLines,
  proofCheckRunOf,
} from "../proof-check-report.js";
import { runProofCheckPlans } from "../proof-check-run.js";
import type {
  ProofCheckCopy,
  ProofCheckPart,
  ProofCheckRun,
} from "../proof-check-types.js";
import { ACKNOWLEDGE_FLAG } from "../proof-check-wording.js";
import {
  loadChangeRules,
  proofCheckWorkspace,
  type ChangeRules,
} from "../proof-check-workspace.js";
import { buildProofCopy } from "../proof-copy.js";
import { loadProofTools, type ProofTools } from "../proof-tools.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "../register.js";
import { redactJsonCredentials } from "../secret-scan-json.js";
import { redactCredentials } from "../secret-scan.js";
import { openProofCopy, type ProofCopyChoice } from "./attest-workspace.js";

/** The subcommand's name under `lisa controls`. */
export const PROOF_CHECK_COMMAND = PROOF_CHECK_NAME;

/** What the command's exit code says. */
export const PROOF_CHECK_EXIT = {
  /** Every part that declares a proof is ready, or none declares one. */
  READY: 0,
  /** At least one part's proof is not ready. */
  NOT_READY: 1,
  /** Nothing could be checked. */
  NOT_CHECKED: 2,
} as const;

/** What `--help` says after the options. */
export const PROOF_CHECK_HELP_AFTER = `
Says, for each check declared as a part of a gate, whether its pair of test
changes is one "lisa controls attest" can use. A pair is two patch files
under .lisa/controls/proofs/, named in the part's proof: a change that breaks
the check's rule (proof.violation) and one that does not (proof.clean).

For each part that names a patch file it asks, in order, and stops at the
first problem:

  1  Are both patch files there, and do they hold different changes?
  2  Is failure text declared (proof.failure_shape)?
  3  Does each change apply to the last commit?
  4  Does each change touch a file inside the part's own folder?
  5  Does the part's command fail on the violating change and print the
     declared failure text, and pass on the clean change?

The changes are tried in a temporary copy of the last commit, which is
removed afterwards. It works before any hook is installed.

  It never  writes, stages or commits anything in the repository.

Prints one JSON document on standard output and one line per part on
standard error. Each part reads "ready", "not-ready" with one sentence saying
what to change, or "no-proof". Exit codes:
  0  every part that declares a proof is ready, or none declares one
  1  at least one part's proof is not ready
  2  nothing could be checked`;

/** The options the command reads. */
export interface ProofCheckOptions {
  /** Let a proof that says it reaches outside the repository run. */
  readonly acknowledgeExternalEffects?: boolean;
}

/** What the command needs from outside, each replaceable in a test. */
export interface ProofCheckDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** Where the JSON document goes. */
  readonly stdout?: (text: string) => void;
  /** Where the lines for a person go, one per call. */
  readonly stderr?: (line: string) => void;
  /** The clock every time in the result is read from. */
  readonly clock?: () => Date;
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Loads the gate runner's own parts. */
  readonly loadTools?: () => Promise<ProofTools>;
  /** Loads the gate runner's rules about what a change touches. */
  readonly loadRules?: () => Promise<ChangeRules>;
  /** How the temporary copy is made and removed. */
  readonly copy?: Pick<ProofCopyChoice, "signals" | "scratch" | "build">;
}

/** A result, or one line per reason there is none. */
type Attempt =
  | { readonly problems: null; readonly run: ProofCheckRun }
  | { readonly problems: readonly string[]; readonly summary: string };

/** What trying the planned parts gave. */
type Tried =
  | {
      readonly problem: null;
      readonly parts: readonly ProofCheckPart[];
      readonly copy: ProofCheckCopy | null;
    }
  | { readonly problem: string };

/**
 * Make the temporary copy, try the planned parts in it, and remove it.
 *
 * No copy is made when no part's pair has to be tried: there is nothing to
 * do in one.
 * @param root - Real path of the repository
 * @param plans - One plan per declared part
 * @param dependencies - Replaceable collaborators
 * @returns Every part's result and what the copy was, or why there is no
 *   copy
 */
async function tryIn(
  root: string,
  plans: readonly ProofCheckPlan[],
  dependencies: ProofCheckDependencies
): Promise<Tried> {
  const settled = plans.flatMap(plan => (plan.check ? [] : [plan.part]));
  if (settled.length === plans.length) {
    return { problem: null, parts: settled, copy: null };
  }
  const [tools, rules] = await Promise.all([
    (dependencies.loadTools ?? loadProofTools)(),
    (dependencies.loadRules ?? loadChangeRules)(),
  ]);
  const build = dependencies.copy?.build ?? buildProofCopy;
  const opened = await openProofCopy(root, {
    ...dependencies.copy,
    // Nothing of Lisa's is installed in the copy: the part's own command is
    // started directly, so this works before any hook exists.
    build: (repository, folder, options) =>
      build(repository, folder, { ...options, carriers: "none" }),
    // What the copy was is said with the results, under this command's name.
    notes: () => [],
  });
  if (opened.problem !== null) return opened;
  try {
    const { source, carried } = opened.copy;
    return {
      problem: null,
      copy: {
        commit: source.commit,
        uncommitted_work: source.dirty,
        carried,
      },
      parts: await runProofCheckPlans(plans, {
        clock: dependencies.clock ?? (() => new Date()),
        judge: tools.judge,
        workspace: proofCheckWorkspace(opened.copy, tools, rules),
      }),
    };
  } finally {
    await opened.close();
  }
}

/**
 * Check the pairs of one repository, without printing anything.
 * @param named - Absolute path of the repository the operator named
 * @param options - What the operator asked for
 * @param dependencies - Replaceable collaborators
 * @returns The result, or why there is none
 */
async function attempt(
  named: string,
  options: ProofCheckOptions,
  dependencies: ProofCheckDependencies
): Promise<Attempt> {
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return {
      problems: [`${named} is not a folder.`],
      summary: "Give the path of the repository to look at",
    };
  }
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) {
    return {
      problems: generated.problems,
      summary: `The gates declaration in ${GATES_DECLARATION_PATH} was refused, so nothing was checked. Fix the declaration, then run this again`,
    };
  }
  const { entries } = generated.register;
  const plans = await planProofCheck(generated.register, {
    acknowledgeExternalEffects: options.acknowledgeExternalEffects === true,
    root,
  });
  const tried = await tryIn(root, plans, dependencies);
  return tried.problem === null
    ? {
        problems: null,
        run: proofCheckRunOf({
          copy: tried.copy,
          parts: tried.parts,
          shipped: entries.filter(entry => !isDeclaredPart(entry)).length,
        }),
      }
    : {
        problems: [tried.problem],
        summary:
          "No temporary copy of the repository to try the changes in, so nothing was checked",
      };
}

/**
 * Check each declared part's pair of test changes in one repository and
 * print what was found.
 * @param targetPath - The repository; the working directory when left out
 * @param options - Whether proofs that reach outside the repository may run
 * @param dependencies - Replaceable collaborators
 * @returns The exit code; see {@link PROOF_CHECK_EXIT}
 */
export async function runProofCheck(
  targetPath: string | undefined,
  options: ProofCheckOptions = {},
  dependencies: ProofCheckDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const say = (line: string): void => {
    stderr(redactCredentials(line.replaceAll(/\s+/gu, " ")).text);
  };
  const attempted = await attempt(
    path.resolve(dependencies.cwd ?? process.cwd(), targetPath ?? "."),
    options,
    dependencies
  ).catch(
    (error: unknown): Attempt => ({
      problems: [error instanceof Error ? error.message : String(error)],
      summary: "The run did not finish, so there is no result",
    })
  );
  if (attempted.problems !== null) {
    attempted.problems.forEach(say);
    say(`${PROOF_CHECK_NAME}: FAIL. ${attempted.summary}`);
    return PROOF_CHECK_EXIT.NOT_CHECKED;
  }
  // Scanned whole, last: what a tool printed reaches this document in more
  // places than its excerpt (the lines that matched, a reason it gave).
  const run = redactJsonCredentials(attempted.run);
  stdout(JSON.stringify(run, null, 2));
  proofCheckLines(run).forEach(say);
  return run.outcome === "not-ready"
    ? PROOF_CHECK_EXIT.NOT_READY
    : PROOF_CHECK_EXIT.READY;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface ProofCheckCommandDependencies {
  readonly runProofCheck: (
    targetPath: string | undefined,
    options: ProofCheckOptions
  ) => Promise<number>;
}

/**
 * Register `proof-check` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerProofCheck(
  group: Command,
  dependencies: ProofCheckCommandDependencies = {
    runProofCheck: (targetPath, options) => runProofCheck(targetPath, options),
  }
): void {
  group
    .command(PROOF_CHECK_COMMAND)
    .description(
      "Say whether each declared check's pair of test changes is ready for the attest step: its own command must fail on the violating change with the declared failure text and pass on the clean one. Changes nothing"
    )
    .argument("[path]", "Project path (default: current directory)")
    .option(
      ACKNOWLEDGE_FLAG,
      "Also run a proof that says it does something outside the repository. Without it such a proof is not run and reads not-ready"
    )
    .addHelpText("after", PROOF_CHECK_HELP_AFTER)
    .action(
      async (
        targetPath: string | undefined,
        options: { readonly acknowledgeExternalEffects?: boolean }
      ) => {
        const code = await dependencies.runProofCheck(targetPath, {
          acknowledgeExternalEffects:
            options.acknowledgeExternalEffects === true,
        });
        if (code !== 0) process.exitCode = code;
      }
    );
}
