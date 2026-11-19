/**
 * Shared declarations for the suites that hold the operator questionnaire to
 * the criterion catalogue (CodySwannGT/lisa#4977).
 *
 * The suites were one file under `tests/unit/scripts/` until the control-audit
 * tests moved under `tests/unit/controls/` (planning decision P4 of
 * CodySwannGT/lisa#4961). That folder holds each suite under the line limit, so
 * the file was split in two and what both halves read lives here.
 * @module tests/unit/controls/support/readiness-questionnaire-helpers
 */
import path from "node:path";

import {
  loadCatalogue,
  readRepositoryFile,
  type InScopeCriterion,
} from "../../../helpers/criterion-catalogue.js";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The generated document. */
export const QUESTIONNAIRE_PATH = "docs/agentic-readiness-questionnaire.md";

/** The generator, as the derived-artifact check runs it. */
export const GENERATOR_SCRIPT = "scripts/generate-readiness-questionnaire.mjs";

/** The command an operator is told to run. */
export const GENERATOR_COMMAND = "bun run build:readiness-questionnaire";

export const catalogue = loadCatalogue();
export const committed = readRepositoryFile(QUESTIONNAIRE_PATH);
export const inScope = catalogue.criteria.filter(
  (criterion): criterion is InScopeCriterion => criterion.in_scope
);

/**
 * The numbered questions of a rendered questionnaire, in order.
 * @param document - A questionnaire's Markdown
 * @returns Each question's number and text
 */
export function numberedQuestions(
  document: string
): { number: number; text: string }[] {
  return [...document.matchAll(/^(?<number>\d+)\. (?<text>.+)$/gmu)].map(
    match => ({
      number: Number(match.groups?.number),
      text: match.groups?.text ?? "",
    })
  );
}
