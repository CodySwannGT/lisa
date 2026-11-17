/**
 * `lisa controls declaration-check [path]`: check that the audit report
 * supports every part the gates declaration declares.
 *
 * The configure step is carried out by an agent, and an agent can write down
 * a control nobody evidenced. This command is what stops that from reaching
 * the register unnoticed. It generates the register the declaration would
 * produce, reads the audit report, and refuses when a part names a place the
 * audit did not report, rests on a question nobody answered, or serves a
 * requirement the audit still asks about (`../declaration-evidence.ts`).
 *
 * A declaration with no parts passes without a report: every one of its
 * rules comes from the declarations Lisa ships for a supported project type,
 * so there is nothing for the audit to support. The command writes nothing.
 * @module controls/commands/declaration-check
 */
import path from "node:path";

import type { Command } from "commander";

import {
  loadAuditReport,
  resolveRepositoryRoot,
  type AuditReportLoad,
} from "../audit-report-file.js";
import { AUDIT_REPORT_JSON_PATH } from "../audit-report.js";
import {
  declarationEvidenceProblems,
  evidencedEntries,
} from "../declaration-evidence.js";
import { GATES_DECLARATION_PATH } from "../gates-declaration.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "../register.js";

/** The subcommand's name under `lisa controls`. */
export const DECLARATION_CHECK_COMMAND = "declaration-check";

/** What the command needs from outside, each replaceable in a test. */
export interface DeclarationCheckDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** The current time, used to judge whether evidence is still fresh. */
  readonly now?: Date;
  /** Where the pass line goes. */
  readonly stdout?: (line: string) => void;
  /** Where problems go, one per call. */
  readonly stderr?: (line: string) => void;
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Reads and validates the audit report of a repository. */
  readonly loadReport?: (root: string, now: Date) => Promise<AuditReportLoad>;
}

/**
 * Count things in words.
 * @param count - How many
 * @param noun - What they are, singular
 * @returns For example `1 part` or `3 parts`
 */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Check the declaration of one repository against its audit report.
 * @param targetPath - The repository; the working directory when left out
 * @param dependencies - Replaceable collaborators
 * @returns The exit code: 0 when every part is supported, 1 when the
 *   declaration or the report cannot be relied on, or a part is not supported
 */
export async function runDeclarationCheck(
  targetPath: string | undefined,
  dependencies: DeclarationCheckDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (problems: readonly string[], summary: string): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(`${DECLARATION_CHECK_COMMAND}: FAIL. ${summary}`);
    return 1;
  };

  const named = path.resolve(
    dependencies.cwd ?? process.cwd(),
    targetPath ?? "."
  );
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail(
      [`${targetPath ?? named} is not a folder.`],
      "Give the path of the repository whose declaration to check"
    );
  }
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) {
    return fail(
      generated.problems,
      `${counted(generated.problems.length, "problem")} with the gates declaration in ${GATES_DECLARATION_PATH}. Fix the declaration, then run this again`
    );
  }
  const parts = evidencedEntries(generated.register).length;
  if (parts === 0) {
    stdout(
      `${DECLARATION_CHECK_COMMAND}: PASS. No gate in ${GATES_DECLARATION_PATH} declares a part, so nothing in it needs the audit report's support`
    );
    return 0;
  }
  const loaded = await (dependencies.loadReport ?? loadAuditReport)(
    root,
    dependencies.now ?? new Date()
  );
  if (loaded.problems !== null) {
    return fail(
      loaded.problems,
      `${counted(parts, "part")} in ${GATES_DECLARATION_PATH} could not be checked, because ${AUDIT_REPORT_JSON_PATH} cannot be relied on. Run the audit, then run this again`
    );
  }
  const problems = declarationEvidenceProblems({
    register: generated.register,
    report: loaded.report,
    criteria: loaded.criteria,
    document: loaded.document,
  });
  if (problems.length > 0) {
    return fail(
      problems,
      `${counted(problems.length, "problem")} between ${GATES_DECLARATION_PATH} and ${AUDIT_REPORT_JSON_PATH}. A part is declared only where the audit found its check or a person answered a question about it`
    );
  }
  stdout(
    `${DECLARATION_CHECK_COMMAND}: PASS. ${AUDIT_REPORT_JSON_PATH} supports ${parts === 1 ? "the 1 part" : `each of the ${parts} parts`} declared in ${GATES_DECLARATION_PATH}`
  );
  return 0;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface DeclarationCheckCommandDependencies {
  readonly runDeclarationCheck: (
    targetPath: string | undefined
  ) => Promise<number>;
}

/**
 * Register `declaration-check` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerDeclarationCheck(
  group: Command,
  dependencies: DeclarationCheckCommandDependencies = {
    runDeclarationCheck: targetPath => runDeclarationCheck(targetPath),
  }
): void {
  group
    .command(DECLARATION_CHECK_COMMAND)
    .description(
      `Check that ${AUDIT_REPORT_JSON_PATH} supports every part declared in the gates block of ${GATES_DECLARATION_PATH}; writes nothing`
    )
    .argument("[path]", "Project path (default: current directory)")
    .action(async (targetPath: string | undefined) => {
      const code = await dependencies.runDeclarationCheck(targetPath);
      if (code !== 0) process.exitCode = code;
    });
}
