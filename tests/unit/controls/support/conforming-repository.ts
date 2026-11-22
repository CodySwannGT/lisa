/**
 * A fixture repository in which every Level 1 requirement can be met, built
 * the way an operator would get there: declare a control with a paired
 * proof, let the audit point at the written records, answer the questions
 * only a person can answer, and let the audit file what it then finds
 * (CodySwannGT/lisa#4998).
 *
 * Which requirement is met by what follows the catalogue:
 *
 * - a requirement a check answers, and a record that needs exercised
 *   evidence, is served by the one declared control;
 * - a record that needs observed evidence is a finding that points at a
 *   line of a committed file;
 * - a requirement a person vouches for is such a finding together with a
 *   person's answer, typed on the answer line of the readable report and
 *   absorbed by the shipped command.
 * @module tests/unit/controls/support/conforming-repository
 */
import {
  inScopeCriteria,
  loadCriterionCatalogue,
  type InScopeCriterion,
} from "../../../../src/controls/catalogue.js";
import {
  amendFinding,
  askAbout,
  completeAuditReport,
  writeAuditReport,
  type SampleFinding,
  type SampleReport,
} from "../../../helpers/control-audit-report.js";
import {
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../../helpers/control-proofs.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import { setting, type ProofSetting } from "./proof-run.js";
import { absorb, answerInline, recordOf } from "./report-answers-run.js";
import { check, type Run } from "./report-check-run.js";

/** The whole repository, as a finding's scope. */
const WHOLE = ".";

/** The gate the one declared control belongs to. */
const GATE = "code-style";

/** What a person types when asked to vouch for a requirement. */
export const PERSON_ANSWER = "The platform lead, every quarter.";

/** A committed file of F-none the audit can point at. */
export const RECORD_FILE = "pyproject.toml";

/** Every in-scope requirement of the shipped catalogue. */
export const REQUIREMENTS = inScopeCriteria(loadCriterionCatalogue());

/**
 * Tell whether a requirement is one only a person can vouch for.
 * @param criterion - The requirement
 * @returns Whether its kind is `human-attested`
 */
export function isAttested(criterion: InScopeCriterion): boolean {
  return criterion.kind === "human-attested";
}

/**
 * Tell whether a requirement is met by a record the attest step can find.
 * @param criterion - The requirement
 * @returns Whether it is an `artifact` that accepts observed evidence
 */
export function isLocated(criterion: InScopeCriterion): boolean {
  return criterion.kind === "artifact" && criterion.minimum_rung === "observed";
}

/**
 * Tell whether a requirement can only be met by a control with a proof.
 * @param criterion - The requirement
 * @returns Whether no audit finding can make it conforming
 */
export function needsControl(criterion: InScopeCriterion): boolean {
  return !isAttested(criterion) && !isLocated(criterion);
}

/** What the audit files once it has found the record a requirement asks for. */
const FOUND: SampleFinding = {
  state: "exists-not-enforced",
  what: "This is written down in the project file.",
  mechanisms: [
    {
      tool: "a written record",
      command: null,
      moment: "none",
      locators: [{ path: RECORD_FILE, line: 1 }],
    },
  ],
};

/**
 * A gates block with one working control that serves every requirement a
 * finding cannot meet.
 * @returns The gates block
 */
function controlForEveryCheck(): GatesBlock {
  const block = provedGates([{ command: checks(F_NONE_SOURCE) }], GATE);
  return {
    [GATE]: {
      ...(block[GATE] as Readonly<Record<string, unknown>>),
      criteria: REQUIREMENTS.filter(needsControl).map(each => each.id),
    },
  };
}

/**
 * Hand back a run that passed.
 * @param run - What a command printed and returned
 * @returns The same run
 * @throws {Error} When it did not pass
 */
function passed(run: Run): Run {
  if (run.code !== 0) throw new Error(run.stderr.join("\n"));
  return run;
}

/**
 * File one finding for each of some requirements.
 * @param report - The report to start from
 * @param criteria - The requirements
 * @param change - What each finding is changed to
 * @returns A new report
 */
function filed(
  report: SampleReport,
  criteria: readonly InScopeCriterion[],
  change: SampleFinding
): SampleReport {
  return criteria.reduce(
    (current, criterion) =>
      amendFinding(current, { criterion: criterion.id, scope: WHOLE }, change),
    report
  );
}

/**
 * Build a repository in which every Level 1 requirement is met, with a
 * valid audit report on disk. No attest run has been written down yet.
 * @returns The repository and its disposable copy
 */
export async function conformingRepository(): Promise<ProofSetting> {
  const where = setting(controlForEveryCheck());
  const people = REQUIREMENTS.filter(isAttested);
  // 1. The audit asks a person about each requirement only a person can
  //    vouch for.
  writeAuditReport(
    where.repoPath,
    people.reduce(
      (current, criterion) =>
        askAbout(current, { criterion: criterion.id, scope: WHOLE }),
      completeAuditReport()
    )
  );
  passed(await check(where.repoPath));
  // 2. A person answers on the answer lines, and the shipped command
  //    records the answers.
  people.forEach(criterion => {
    answerInline(where.repoPath, `${criterion.id}@${WHOLE}`, PERSON_ANSWER);
  });
  passed(await absorb(where.repoPath));
  // 3. The audit decides each finding again, pointing at what it found.
  writeAuditReport(
    where.repoPath,
    filed(
      recordOf(where.repoPath),
      REQUIREMENTS.filter(each => !needsControl(each)),
      FOUND
    )
  );
  passed(await check(where.repoPath));
  return where;
}
