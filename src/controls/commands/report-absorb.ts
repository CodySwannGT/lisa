/**
 * `lisa controls report-check --absorb [path]`: record what people typed on
 * the answer lines of the audit's questions.
 *
 * A person answers a question by typing on its answer line in
 * `.lisa/audit/report.md`, or in `wiki/gaps.md` where the repository keeps a
 * wiki. This command reads those lines and moves each answer into
 * `.lisa/audit/report.json` as a fact, under the question's id, dropping the
 * question. It is the only thing that writes an answer into the record, and
 * it never decides one.
 *
 * It runs before anything renders the readable report again, and it renders
 * nothing itself: the files a person typed in are left exactly as they are.
 * It does not check the report either; `lisa controls report-check` does
 * that, and refuses a record that does not carry an answer these files hold.
 *
 * Exit 0 when the record now carries every answer that is written, including
 * when there was nothing to absorb (a first run, with no report at all) and
 * when answers are written but no record exists yet to hold them. Exit 1,
 * with nothing changed, when a file is not in the written form, when two
 * files answer one question differently, or when the record cannot be read.
 * @module controls/commands/report-absorb
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { isJsonObject, type JsonObject } from "../../sync/json-path.js";
import {
  absorbInlineAnswers,
  type AbsorbedChange,
} from "../audit-answers-absorb.js";
import { typedAnswerProblems } from "../audit-answers-secrets.js";
import {
  readInlineAnswers,
  readOrdinaryFile,
} from "../audit-inline-answers-file.js";
import { resolveRepositoryRoot } from "../audit-report-file.js";
import { AUDIT_REPORT_JSON_PATH } from "../audit-report.js";
import {
  parseProblemWithoutExcerpt,
  withoutCredentials,
} from "../secret-scan-json.js";

/** The option that turns `report-check` into this command. */
export const ABSORB_OPTION = "--absorb";

/** How the command names itself in what it prints. */
const NAME = `report-check ${ABSORB_OPTION}`;

/** What a run with nothing to do says. */
const NOTHING = "No answers to absorb";

/** What every refusal of the record says about the answers. */
const KEPT = "The answers are still where they were typed.";

/** What the command needs from outside, each replaceable in a test. */
export interface ReportAbsorbDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** Where the lines about what was absorbed go. */
  readonly stdout?: (line: string) => void;
  /** Where problems go, one per call. */
  readonly stderr?: (line: string) => void;
}

/** The parsed record, or the one-line reason it cannot take an answer. */
type RecordRead =
  | { readonly problem: null; readonly document: JsonObject }
  | { readonly problem: string };

/** What absorbing did in one repository, before anything is printed. */
type AbsorbRun =
  | { readonly problems: readonly string[] }
  | {
      readonly problems: null;
      /** One line per change. */
      readonly lines: readonly string[];
      /** What the closing line says. */
      readonly summary: string;
    };

/**
 * Count things in words.
 * @param count - How many
 * @param noun - What they are, singular
 * @returns For example `1 answer` or `3 answers`
 */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * A run that changed nothing and has nothing wrong to report.
 * @param summary - What the closing line says
 * @returns The run
 */
function unchanged(summary: string): AbsorbRun {
  return { problems: null, lines: [], summary };
}

/**
 * Parse the record far enough to move answers into it.
 * @param text - The content of `report.json`
 * @returns The record, or why no answer can be recorded in it
 */
function parseRecord(text: string): RecordRead {
  try {
    const document: unknown = JSON.parse(text);
    if (!isJsonObject(document)) {
      return {
        problem: `${AUDIT_REPORT_JSON_PATH} is not a JSON object, so no answer can be recorded in it. ${KEPT} Write the record again, then run this again.`,
      };
    }
    const malformed = ["questions", "answers"]
      .filter(
        key => document[key] !== undefined && !Array.isArray(document[key])
      )
      .join(" and ");
    return malformed === ""
      ? { problem: null, document }
      : {
          problem: `In ${AUDIT_REPORT_JSON_PATH}, ${malformed} must be a list, so no answer can be recorded there. ${KEPT} Correct the record, then run this again.`,
        };
  } catch (error) {
    const detail = parseProblemWithoutExcerpt(error);
    return {
      problem: `${AUDIT_REPORT_JSON_PATH} is not valid JSON, so no answer can be recorded in it. ${KEPT} Write the record again, then run this again. (${detail})`,
    };
  }
}

/**
 * Say what one change was, for the operator.
 * @param change - The change
 * @returns One line
 */
function changeLine(change: AbsorbedChange): string {
  const about = `"${change.question}"`;
  if (change.kind === "withdrawn") {
    return `Withdrew the answer to ${about}: its answer line is empty`;
  }
  if (change.kind === "dropped") {
    return `Stopped asking ${about}: its answer is already on record`;
  }
  return `${change.kind === "recorded" ? "Recorded" : "Replaced"} the answer to ${about}: ${change.answer ?? ""}`;
}

/**
 * Say that answers are written but there is no record to hold them yet.
 * @param count - How many answers are written
 * @returns The closing line's text
 */
function waiting(count: number): string {
  const [verb, them] = count === 1 ? ["is", "it"] : ["are", "them"];
  return `${counted(count, "answer")} ${verb} written in the report, but there is no ${AUDIT_REPORT_JSON_PATH} to record ${them} in yet. Run this again once the audit has written one`;
}

/**
 * Absorb the typed answers of one repository into its record.
 * @param root - Real path of the repository
 * @returns What was done, or why nothing was
 */
async function absorbIn(root: string): Promise<AbsorbRun> {
  const inline = await readInlineAnswers(root);
  const refused = typedAnswerProblems(inline);
  if (refused.length > 0) return { problems: refused };
  const typed = inline.entries.filter(entry => entry.answer !== null).length;
  const text = await readOrdinaryFile(root, AUDIT_REPORT_JSON_PATH);
  if (text === null) return unchanged(typed === 0 ? NOTHING : waiting(typed));
  const read = parseRecord(text);
  if (read.problem !== null) {
    return typed === 0 ? unchanged(NOTHING) : { problems: [read.problem] };
  }
  const { document, changes } = absorbInlineAnswers(
    read.document,
    inline.entries
  );
  if (changes.length === 0) {
    return unchanged(
      typed === 0
        ? NOTHING
        : "The record already holds every answer written in the report"
    );
  }
  await writeFile(
    path.join(root, AUDIT_REPORT_JSON_PATH),
    `${JSON.stringify(document, null, 2)}\n`
  );
  const of = (kind: AbsorbedChange["kind"]): number =>
    changes.filter(change => change.kind === kind).length;
  return {
    problems: null,
    lines: changes.map(change => changeLine(change)),
    summary: `${of("recorded")} recorded, ${of("replaced")} replaced, ${of("withdrawn")} withdrawn in ${AUDIT_REPORT_JSON_PATH}`,
  };
}

/**
 * Absorb the answers typed in one repository's report.
 * @param targetPath - The repository; the working directory when left out
 * @param dependencies - Replaceable collaborators
 * @returns The exit code: 0 when the record carries every written answer or
 *   there was nothing to absorb, 1 when something was refused
 */
export async function runReportAbsorb(
  targetPath: string | undefined,
  dependencies: ReportAbsorbDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const named = path.resolve(
    dependencies.cwd ?? process.cwd(),
    targetPath ?? "."
  );
  const root = await resolveRepositoryRoot(named);
  const run: AbsorbRun =
    root === null
      ? {
          problems: [
            `${targetPath ?? named} is not a folder. Give the path of the repository whose answers to absorb.`,
          ],
        }
      : await absorbIn(root);
  if (run.problems === null) {
    [...run.lines, `${NAME}: PASS. ${run.summary}`].forEach(line => {
      stdout(line.replaceAll(/\s+/gu, " "));
    });
    return 0;
  }
  withoutCredentials(run.problems).forEach(problem => {
    stderr(problem.replaceAll(/\s+/gu, " "));
  });
  stderr(
    `${NAME}: FAIL. ${counted(run.problems.length, "problem")}; nothing was changed`
  );
  return 1;
}
