/**
 * `lisa controls attest --before-enforce [path] [--json]
 * [--acknowledge-external-effects]`: before anything is installed, find the
 * checks that exist and that nothing enforces.
 *
 * On an existing codebase this is the finding that matters most: a tool is
 * there, and a change that breaks its rule still goes through.
 *
 * ## How it differs from a plain `attest`
 *
 * A plain run installs Lisa's commit and push carriers in its disposable
 * copy, so it proves the chain Lisa would install. This run installs
 * nothing. Its copy is a fresh clone of the last commit, wired exactly as a
 * fresh clone is, which in practice means not at all: git copies commits
 * into a clone and never the hook settings of the checkout it came from. For
 * each entry that has both proof patches and is checked at commit or push,
 * it really commits or pushes the violating change there, then runs the
 * entry's own command on the same change. See `../before-enforce-run.ts`.
 *
 * ## What it writes
 *
 * Nothing. No evidence, no register, no verdict: it is a diagnosis made
 * before anything is installed, so it cannot be mistaken for a Level 1
 * result and cannot set or clear an entry's `unproved` mark. It prints a
 * table, or with `--json` one document (`../before-enforce-types.ts`). The
 * findings it offers the audit report are in that document, already in the
 * report's shape; the attest skill puts them in the report.
 *
 * It sends nothing anywhere: the hosting platform is not read, and no pull
 * request is opened.
 *
 * ## Exit codes
 *
 * - 0: there is a result and every entry was answered. A finding is
 *   something to look at, not a failure.
 * - 1: there is a result, complete for everything else, and at least one
 *   entry was tried and gave no answer that can be relied on.
 * - 2: there is no result: the path is not a folder, the gates declaration
 *   is refused, the fresh clone could not be made, the run could not
 *   finish, or the option was combined with one it cannot be combined with.
 * @module controls/commands/attest-before-enforce
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepositoryRoot } from "../audit-report-file.js";
import { beforeEnforceFindings } from "../before-enforce-findings.js";
import {
  beforeEnforceRunOf,
  renderBeforeEnforceTable,
} from "../before-enforce-report.js";
import {
  planBeforeEnforce,
  type BeforeEnforcePlan,
} from "../before-enforce-plan.js";
import { runBeforeEnforce } from "../before-enforce-run.js";
import type {
  BeforeEnforceCopy,
  BeforeEnforceEntry,
  BeforeEnforceRun,
} from "../before-enforce-types.js";
import {
  beforeEnforceWorkspace,
  cloneWiring,
} from "../before-enforce-workspace.js";
import {
  beforeEnforceNotes,
  freshCloneNote,
} from "../before-enforce-wording.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
  type InScopeCriterion,
} from "../catalogue.js";
import { GATES_DECLARATION_PATH } from "../gates-declaration.js";
import { buildProofCopy } from "../proof-copy.js";
import { loadProofTools, type ProofTools } from "../proof-tools.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "../register.js";
import type { ControlRegister } from "../register-types.js";
import { openProofCopy, type ProofCopyChoice } from "./attest-workspace.js";

/** The option that asks for this run. */
export const BEFORE_ENFORCE_FLAG = "--before-enforce";

/** The name the run's summary lines carry. */
export const BEFORE_ENFORCE_NAME = `attest ${BEFORE_ENFORCE_FLAG}`;

/** What the run's exit code says. */
export const BEFORE_ENFORCE_EXIT = {
  /** There is a result and every entry was answered. */
  ANSWERED: 0,
  /** There is a result, and at least one entry gave no answer. */
  INCOMPLETE: 1,
  /** There is no result: nothing was tried. */
  NOT_RUN: 2,
} as const;

/** The options this run reads; the others only to refuse them. */
export interface BeforeEnforceOptions {
  /** Print the result as one JSON document instead of a table. */
  readonly json?: boolean;
  /** Let an entry whose proof says it reaches outside the repository run. */
  readonly acknowledgeExternalEffects?: boolean;
  readonly workspace?: string;
  readonly check?: boolean;
  readonly pullRequestCanaries?: boolean;
}

/** What the run needs from outside, each replaceable in a test. */
export interface BeforeEnforceDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** Where the result goes, one line per call. */
  readonly stdout?: (line: string) => void;
  /** Where notes and problems go, one line per call. */
  readonly stderr?: (line: string) => void;
  /** The clock every time in the result is read from. */
  readonly clock?: () => Date;
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Loads the gate runner's own parts. */
  readonly loadTools?: () => Promise<ProofTools>;
  /** The in-scope requirements, in catalogue order. */
  readonly criteria?: () => readonly InScopeCriterion[];
  /** How the fresh clone is made and removed. */
  readonly copy?: Pick<ProofCopyChoice, "signals" | "scratch" | "build">;
}

/** The options this run cannot be combined with, and why not. */
const REFUSED_WITH: readonly {
  readonly given: (options: BeforeEnforceOptions) => boolean;
  readonly because: string;
}[] = [
  {
    given: options => options.check === true,
    because: `${BEFORE_ENFORCE_FLAG} cannot be combined with --check: one tries changes before anything is installed, the other checks a verdict that was already written.`,
  },
  {
    given: options => options.workspace !== undefined,
    because: `${BEFORE_ENFORCE_FLAG} cannot be combined with --workspace: it makes its own fresh clone, because what a fresh clone does is the question.`,
  },
  {
    given: options => options.pullRequestCanaries === true,
    because: `${BEFORE_ENFORCE_FLAG} cannot be combined with --pull-request-canaries: it tries commit and push only and sends nothing to the hosting platform.`,
  },
];

/** A result, or one line per reason there is none. */
type Attempt =
  | { readonly problems: null; readonly run: BeforeEnforceRun }
  | { readonly problems: readonly string[]; readonly summary: string };

/** What exercising the planned entries gave. */
type Exercise =
  | {
      readonly problem: null;
      readonly entries: readonly BeforeEnforceEntry[];
      readonly copy: BeforeEnforceCopy | null;
    }
  | { readonly problem: string };

/**
 * Read a file's text.
 * @param file - The file
 * @returns The text, or `null` when it cannot be read
 */
async function textOf(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Make the fresh clone, exercise the planned entries in it, and remove it.
 *
 * No clone is made when nothing can be exercised: there is nothing to try in
 * one.
 * @param root - Real path of the repository
 * @param plans - One plan per register entry
 * @param dependencies - Replaceable collaborators
 * @returns Every entry's result and what the clone was, or why there is no
 *   clone
 */
async function exerciseIn(
  root: string,
  plans: readonly BeforeEnforcePlan[],
  dependencies: BeforeEnforceDependencies
): Promise<Exercise> {
  const settled = plans.flatMap(plan => (plan.exercise ? [] : [plan.entry]));
  if (settled.length === plans.length) {
    return { problem: null, entries: settled, copy: null };
  }
  const tools = await (dependencies.loadTools ?? loadProofTools)();
  const build = dependencies.copy?.build ?? buildProofCopy;
  const opened = await openProofCopy(root, {
    ...dependencies.copy,
    // The whole point of this run: nothing of Lisa's is installed in the
    // clone, so it is wired exactly as a fresh clone of the repository is.
    build: (repository, folder) =>
      build(repository, folder, { carriers: "none" }),
    notes: copy => beforeEnforceNotes(cloneWiring(copy)),
    notice: dependencies.stderr,
  });
  if (opened.problem !== null) return opened;
  try {
    return {
      problem: null,
      copy: cloneWiring(opened.copy),
      entries: await runBeforeEnforce(plans, {
        clock: dependencies.clock ?? (() => new Date()),
        judge: tools.judge,
        workspace: beforeEnforceWorkspace(opened.copy, tools),
      }),
    };
  } finally {
    await opened.close();
  }
}

/**
 * Put a run together from the entries' results.
 * @param root - Real path of the repository
 * @param register - The control register
 * @param exercised - Every entry's result and what the clone was
 * @param dependencies - Replaceable collaborators
 * @returns The run
 */
async function resultOf(
  root: string,
  register: ControlRegister,
  exercised: Extract<Exercise, { problem: null }>,
  dependencies: BeforeEnforceDependencies
): Promise<BeforeEnforceRun> {
  return beforeEnforceRunOf({
    copy: exercised.copy,
    entries: exercised.entries,
    findings: beforeEnforceFindings({
      criteria: (
        dependencies.criteria ??
        (() => inScopeCriteria(loadCriterionCatalogue()))
      )(),
      declaration: await textOf(path.join(root, GATES_DECLARATION_PATH)),
      entries: exercised.entries,
      register,
    }),
  });
}

/**
 * Run the whole diagnosis of one repository, without printing anything.
 * @param named - Absolute path of the repository the operator named
 * @param options - What the operator asked for
 * @param dependencies - Replaceable collaborators
 * @returns The result, or why there is none
 */
async function attempt(
  named: string,
  options: BeforeEnforceOptions,
  dependencies: BeforeEnforceDependencies
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
      summary: `The gates declaration in ${GATES_DECLARATION_PATH} was refused, so nothing was tried. Fix the declaration, then run this again`,
    };
  }
  const { register } = generated;
  const plans = await planBeforeEnforce(register, {
    acknowledgeExternalEffects: options.acknowledgeExternalEffects === true,
    root,
  });
  const exercised = await exerciseIn(root, plans, dependencies);
  return exercised.problem === null
    ? {
        problems: null,
        run: await resultOf(root, register, exercised, dependencies),
      }
    : {
        problems: [exercised.problem],
        summary:
          "No fresh clone of the repository to try the changes in, so nothing was tried",
      };
}

/**
 * The lines a person reads about a run, after the table.
 * @param run - The run
 * @returns The lines, the summary last
 */
function linesFor(run: BeforeEnforceRun): readonly string[] {
  const word = run.outcome.toUpperCase().replaceAll("-", " ");
  return [
    ...(run.copy === null ? [] : [`note. ${freshCloneNote(run.copy)}`]),
    "wrote nothing. No evidence, register or verdict was written or changed: this is a diagnosis made before anything is installed, not a Level 1 result.",
    ...(run.audit_findings.length === 0
      ? []
      : [
          `${String(run.audit_findings.length)} ${run.audit_findings.length === 1 ? "finding is" : "findings are"} offered to the audit report in state exists-not-enforced. Run this again with --json to get ${run.audit_findings.length === 1 ? "it" : "them"} under "audit_findings", and the record of each accepted change under "entries[].canary".`,
        ]),
    `${word}. ${run.reason}`,
  ].map(line => `${BEFORE_ENFORCE_NAME}: ${line}`);
}

/**
 * Look, before anything is installed, for the checks of one repository that
 * exist and that nothing enforces, and print what was found.
 * @param targetPath - The repository; the working directory when left out
 * @param options - Whether to print JSON, and whether outside effects may run
 * @param dependencies - Replaceable collaborators
 * @returns The exit code; see {@link BEFORE_ENFORCE_EXIT}
 */
export async function runAttestBeforeEnforce(
  targetPath: string | undefined,
  options: BeforeEnforceOptions = {},
  dependencies: BeforeEnforceDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (problems: readonly string[], summary: string): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(`${BEFORE_ENFORCE_NAME}: FAIL. ${summary}`);
    return BEFORE_ENFORCE_EXIT.NOT_RUN;
  };
  const refused = REFUSED_WITH.filter(({ given }) => given(options)).map(
    ({ because }) => because
  );
  if (refused.length > 0) {
    return fail(refused, "Nothing was tried. Run it on its own");
  }
  const attempted = await attempt(
    path.resolve(dependencies.cwd ?? process.cwd(), targetPath ?? "."),
    options,
    { ...dependencies, stderr }
  ).catch(
    (error: unknown): Attempt => ({
      problems: [error instanceof Error ? error.message : String(error)],
      summary: "The run did not finish, so there is no result",
    })
  );
  if (attempted.problems !== null) {
    return fail(attempted.problems, attempted.summary);
  }
  const { run } = attempted;
  const lines = linesFor(run);
  const incomplete = run.outcome === "incomplete";
  if (options.json === true) {
    stdout(JSON.stringify(run, null, 2));
    stderr(lines.at(-1) ?? "");
  } else {
    [...renderBeforeEnforceTable(run), ...lines.slice(0, -1)].forEach(line => {
      stdout(line);
    });
    (incomplete ? stderr : stdout)(lines.at(-1) ?? "");
  }
  return incomplete
    ? BEFORE_ENFORCE_EXIT.INCOMPLETE
    : BEFORE_ENFORCE_EXIT.ANSWERED;
}
