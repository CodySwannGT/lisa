/**
 * Refusing an answer that holds a secret's value before it is recorded.
 *
 * A person answers an audit question by typing on its answer line, and
 * `lisa controls report-check --absorb` copies what was typed into
 * `.lisa/audit/report.json`, which is committed and shared. An answer is the
 * one piece of text in the report that no agent writes, so it is the one
 * place a person can paste a token by mistake. It is looked at here, before
 * the copy is made: an answer shaped like a credential is not recorded, and
 * the person is told which line to correct.
 *
 * The line names the file and the line number and never repeats the answer.
 * @module controls/audit-answers-secrets
 */
import {
  AUDIT_REPORT_JSON_PATH,
  type InlineAnswers,
  type InlineEntry,
} from "./audit-report-types.js";
import { VALUE_NOT_REPEATED } from "./secret-scan-json.js";
import { credentialKinds } from "./secret-scan.js";
import { describeCredentialKind } from "./secret-shapes.js";

/**
 * Say which typed answers hold something shaped like a credential.
 * @param entries - Every question entry read from the files people type in
 * @returns One line per answer and shape; empty when every answer is clean
 */
export function answersHoldingCredentials(
  entries: readonly InlineEntry[]
): readonly string[] {
  return entries.flatMap(entry =>
    credentialKinds(entry.answer ?? "").map(
      kind =>
        `The answer typed on line ${entry.line} of ${entry.file} holds something shaped like a credential: ${describeCredentialKind(kind)}. An answer is copied into ${AUDIT_REPORT_JSON_PATH}, which is shared, so it was not recorded. Take the value off the answer line and write the name it goes by instead. ${VALUE_NOT_REPEATED}`
    )
  );
}

/**
 * Say why the answers people typed cannot be recorded, when they cannot.
 *
 * Files that are not in the written form come first, because their entries
 * cannot be relied on. Then every answer is looked at for a secret's value.
 * @param inline - What was read from the files people type in
 * @returns One line per problem; empty when every answer can be recorded
 */
export function typedAnswerProblems(inline: InlineAnswers): readonly string[] {
  return inline.problems.length > 0
    ? inline.problems
    : answersHoldingCredentials(inline.entries);
}
