/**
 * Reading, from a repository, what people have typed on the answer lines of
 * the audit's questions.
 *
 * A question is written to two places: `.lisa/audit/report.md`, always, and
 * `wiki/gaps.md` when the repository keeps a wiki. A person may answer in
 * either, so both are read, and a question answered differently in the two is
 * refused instead of one answer being chosen over the other.
 *
 * Neither file is read through a link: a file that is not an ordinary file of
 * the repository holds nothing as far as this code is concerned. Nothing is
 * written.
 * @module controls/audit-inline-answers-file
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  mergeInlineEntries,
  parseQuestionBlock,
} from "./audit-inline-answers.js";
import { WIKI_GAPS_PATH } from "./audit-questions-format.js";
import {
  AUDIT_REPORT_MARKDOWN_PATH,
  type InlineAnswers,
} from "./audit-report-types.js";

/**
 * Read a file of the repository, unless it or its folder is a link.
 * @param root - Real path of the repository
 * @param relative - Repository-relative path of the file
 * @returns The file's content, or `null` when no ordinary file is there
 */
export async function readOrdinaryFile(
  root: string,
  relative: string
): Promise<string | null> {
  const file = path.join(root, relative);
  try {
    const folder = path.dirname(file);
    if ((await realpath(folder)) !== folder) return null;
    return (await lstat(file)).isFile() ? await readFile(file, "utf8") : null;
  } catch {
    return null;
  }
}

/**
 * Read every answer line of the audit's questions in a repository.
 * @param root - Real path of the repository
 * @returns Each question entry once, or everything wrong with the files
 */
export async function readInlineAnswers(root: string): Promise<InlineAnswers> {
  const report = await readOrdinaryFile(root, AUDIT_REPORT_MARKDOWN_PATH);
  const gaps = await readOrdinaryFile(root, WIKI_GAPS_PATH);
  const blocks = [
    ...(report === null
      ? []
      : [
          parseQuestionBlock(report, AUDIT_REPORT_MARKDOWN_PATH, {
            lisaRendered: true,
          }),
        ]),
    ...(gaps === null
      ? []
      : [parseQuestionBlock(gaps, WIKI_GAPS_PATH, { lisaRendered: false })]),
  ];
  const merged = mergeInlineEntries(blocks.flatMap(block => block.entries));
  const problems = [
    ...blocks.flatMap(block => block.problems),
    ...merged.problems,
  ];
  return {
    rendered: report !== null,
    problems,
    entries: problems.length === 0 ? merged.entries : [],
  };
}
