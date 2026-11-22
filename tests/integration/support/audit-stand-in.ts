/**
 * The record a stand-in for the auditing agent writes, for suites that run
 * the audit skill's own commands (CodySwannGT/lisa#4980).
 *
 * The stand-in does what the skill tells the agent to do and no more: one
 * finding for every requirement that was printed, filed where its `answered`
 * value says, the questions it has to ask, and the answers already on record
 * copied over exactly.
 * @module tests/integration/support/audit-stand-in
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  sampleFinding,
  type SampleFinding,
  type SampleQuestion,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import type { PrintedCriterion } from "./audit-skill-run.js";

/** The record, relative to the repository root. */
export const REPORT_JSON = ".lisa/audit/report.json";

/** The readable report, relative to the repository root. */
export const REPORT_MD = ".lisa/audit/report.md";

/** The tracker question as an audit that found one candidate asks it. */
export const TRACKER_QUESTION: SampleQuestion = {
  id: "tracker",
  text: "Which tracker does the team plan and follow its work in?",
  candidates: [
    {
      answer: "GitHub Issues",
      found_in:
        "Two commit messages end with a number sign and an issue number.",
    },
  ],
};

/**
 * The parts a requirement is answered in, read from what the catalogue
 * command printed.
 * @param criterion - One printed requirement
 * @param scopes - The parts of the repository
 * @returns Every folder for a requirement answered per part, when there are
 *   folders; otherwise the whole repository alone
 */
function answeredIn(
  criterion: PrintedCriterion,
  scopes: readonly string[]
): readonly string[] {
  const folders = scopes.filter(scope => scope !== ".");
  return criterion.answered === "part" && folders.length > 0 ? folders : ["."];
}

/**
 * Read the answers the record already holds, as step 1a of the skill has the
 * agent do.
 * @param repoPath - The repository being audited
 * @returns The `answers` list; empty when there is no record or no list
 */
export function answersOnRecord(repoPath: string): readonly SampleQuestion[] {
  const file = path.join(repoPath, REPORT_JSON);
  if (!existsSync(file)) return [];
  const { answers } = JSON.parse(readFileSync(file, "utf8")) as SampleReport;
  return answers ?? [];
}

/**
 * The record an agent would write.
 * @param criteria - The requirements `lisa controls catalogue` printed
 * @param scopes - The parts of the repository
 * @param extra - What differs from a plain record
 * @param extra.known - Findings to use in place of the plain ones
 * @param extra.questions - The questions to ask
 * @param extra.answers - The answers on record, copied over
 * @returns The record
 */
export function standInReport(
  criteria: readonly PrintedCriterion[],
  scopes: readonly string[],
  extra: {
    readonly known?: readonly SampleFinding[];
    readonly questions?: readonly SampleQuestion[];
    readonly answers?: readonly SampleQuestion[];
  } = {}
): SampleReport {
  return {
    schema_version: 1,
    scopes,
    findings: criteria.flatMap(criterion =>
      answeredIn(criterion, scopes).map(
        scope =>
          (extra.known ?? []).find(
            finding =>
              finding.criterion === criterion.id && finding.scope === scope
          ) ?? sampleFinding(String(criterion.id), scope)
      )
    ),
    questions: extra.questions ?? [TRACKER_QUESTION],
    answers: extra.answers ?? [],
  };
}
