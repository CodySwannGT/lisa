/**
 * Answering an audit's questions the way an operator does: by typing on an
 * answer line of a rendered file and touching nothing else
 * (CodySwannGT/lisa#4980).
 * @module tests/helpers/audit-answers
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The start of an answer line. */
const ANSWER_LINE = "- **Answer**:";

/**
 * Read a file of a repository.
 * @param repoPath - Repository root
 * @param relative - Repository-relative path
 * @returns Its content
 */
export function fileOf(repoPath: string, relative: string): string {
  return readFileSync(path.join(repoPath, relative), "utf8");
}

/**
 * Write a file of a repository, creating its folder.
 * @param repoPath - Repository root
 * @param relative - Repository-relative path
 * @param content - What to write
 */
export function writeFileOf(
  repoPath: string,
  relative: string,
  content: string
): void {
  const file = path.join(repoPath, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * Type on the answer line of one question: replace what stands after the
 * label and touch nothing else.
 * @param repoPath - Repository root
 * @param file - The file to answer in, relative to the repository root
 * @param id - The question's id, as its heading shows it
 * @param answer - What to type; an empty string empties the line
 * @throws {Error} When the file has no such question, so a case can never
 *   pass by answering nothing
 */
export function typeAnswer(
  repoPath: string,
  file: string,
  id: string,
  answer: string
): void {
  const lines = fileOf(repoPath, file).split("\n");
  const heading = lines.indexOf(`### ${id}`);
  const line = lines.findIndex(
    (text, index) => index > heading && text.startsWith(ANSWER_LINE)
  );
  if (heading === -1 || line === -1) {
    throw new Error(`${file} has no answer line for the question "${id}".`);
  }
  writeFileOf(
    repoPath,
    file,
    lines
      .map((text, index) =>
        index === line ? `${ANSWER_LINE} ${answer}`.trimEnd() : text
      )
      .join("\n")
  );
}
