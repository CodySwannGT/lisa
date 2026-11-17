/**
 * The audit's open questions in a repository's wiki.
 *
 * Where a repository keeps a wiki, `wiki/gaps.md` is the file people already
 * answer questions in: `/lisa:agent-ready` lists there what only a person can
 * say. The audit's open questions are copied into that file too, so an
 * operator has one place to look.
 *
 * The file is not the audit's. `/lisa:agent-ready` keeps a header, a list of
 * open gaps and a list of resolved ones in it, in its own form. So the audit
 * owns exactly one block, between two marker lines, and nothing outside it:
 *
 * - a file with no block gets one added at its end;
 * - a file with a block has that block replaced where it stands;
 * - every other byte of the file is left as it was;
 * - the file is created only when the wiki has none and there is something to
 *   ask, and the `wiki/` folder is never created.
 *
 * Working out what to write is separate from writing it, so the check can
 * refuse before it has written anything anywhere.
 * @module controls/audit-gaps-file
 */
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseQuestionBlock } from "./audit-inline-answers.js";
import { WIKI_FOLDER, WIKI_GAPS_PATH } from "./audit-questions-format.js";
import { renderGapsQuestionBlock } from "./audit-questions-markdown.js";
import type { AuditReport } from "./audit-report-types.js";
import type { InScopeCriterion } from "./catalogue.js";

/** What the check should do about `wiki/gaps.md`. */
export interface GapsFilePlan {
  /** Why the file cannot be written, in one line; `null` when it can. */
  readonly problem: string | null;
  /** Whether the file holds, or is about to hold, the audit's block. */
  readonly managed: boolean;
  /** The whole file to write; `null` when it needs no change. */
  readonly content: string | null;
}

/** The plan for a repository whose wiki file the audit has no business in. */
const LEFT_ALONE: GapsFilePlan = {
  problem: null,
  managed: false,
  content: null,
};

/**
 * The plan for a file that cannot be written.
 * @param problem - Why not, in one line
 * @returns The plan
 */
function refused(problem: string): GapsFilePlan {
  return { ...LEFT_ALONE, problem };
}

/**
 * Say what is at a path, without following a link.
 * @param target - Absolute path
 * @returns `folder`, `file`, `missing`, or `other` for a link or anything else
 */
async function kindOf(
  target: string
): Promise<"folder" | "file" | "missing" | "other"> {
  try {
    const stat = await lstat(target);
    if (stat.isDirectory()) return "folder";
    return stat.isFile() ? "file" : "other";
  } catch {
    return "missing";
  }
}

/**
 * Put the audit's block into the text of an existing gaps file.
 * @param text - The file as it is
 * @param block - The block's lines, from one marker to the other
 * @param hasOpen - Whether the block holds an open question
 * @returns The plan: the new text, no change, or why the file is refused
 */
function planFor(
  text: string,
  block: readonly string[],
  hasOpen: boolean
): GapsFilePlan {
  const { problems, region } = parseQuestionBlock(text, WIKI_GAPS_PATH, {
    lisaRendered: false,
  });
  const [problem] = problems;
  if (problem !== undefined) return refused(problem);
  if (region === null && !hasOpen) return LEFT_ALONE;
  const lines = text.split("\n");
  const separator = text === "" || text.endsWith("\n") ? "" : "\n";
  const content =
    region === null
      ? `${text}${separator}${text === "" ? "" : "\n"}${block.join("\n")}\n`
      : [
          ...lines.slice(0, region.start),
          ...block,
          ...lines.slice(region.end + 1),
        ].join("\n");
  return {
    problem: null,
    managed: true,
    content: content === text ? null : content,
  };
}

/**
 * Work out what the check should write to `wiki/gaps.md`, writing nothing.
 * @param root - Real path of the repository
 * @param report - The validated report
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns The plan
 */
export async function planGapsFile(
  root: string,
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): Promise<GapsFilePlan> {
  if ((await kindOf(path.join(root, WIKI_FOLDER))) !== "folder") {
    return LEFT_ALONE;
  }
  const file = path.join(root, WIKI_GAPS_PATH);
  const kind = await kindOf(file);
  const block = renderGapsQuestionBlock(report, criteria);
  const hasOpen = report.questions.length > 0;
  if (kind === "missing") {
    return hasOpen
      ? { problem: null, managed: true, content: `${block.join("\n")}\n` }
      : LEFT_ALONE;
  }
  return kind === "file"
    ? planFor(await readFile(file, "utf8"), block, hasOpen)
    : refused(
        `${WIKI_GAPS_PATH} is not an ordinary file (it may be a link), so nothing was written. Remove it, then run this check again.`
      );
}

/**
 * Carry out a plan.
 * @param root - Real path of the repository
 * @param content - The whole file to write
 */
export async function writeGapsFile(
  root: string,
  content: string
): Promise<void> {
  await writeFile(path.join(root, WIKI_GAPS_PATH), content);
}
