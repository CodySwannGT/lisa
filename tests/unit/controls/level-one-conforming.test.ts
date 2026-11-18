/**
 * A repository can reach a conforming Level 1 result, and loses it when any
 * one requirement stops being met (CodySwannGT/lisa#4998).
 *
 * The fixture is built the way an operator gets there: one declared control
 * with a working paired proof, an audit that points at the written records,
 * and a person's answers to the questions only a person can answer. The
 * verdict then says, for every requirement, how strongly it is known:
 * exercised for a proof, observed for a record found where the audit
 * pointed, asserted for a person's word.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import { loadCriterionCatalogue } from "../../../src/controls/catalogue.js";
import type { ControlRegister } from "../../../src/controls/register-types.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import { computeVerdict } from "../../../src/controls/verdict.js";
import {
  checkVerdict,
  evidenceIn,
  jsonOf,
  record,
  RECORDED_NOW,
  verdictIn,
} from "./support/attest-record-run.js";
import {
  conformingRepository,
  isAttested,
  isLocated,
  needsControl,
  PERSON_ANSWER,
  RECORD_FILE,
  REQUIREMENTS,
} from "./support/conforming-repository.js";
import { removeCopies, type ProofSetting } from "./support/proof-run.js";
import { absorb, answerInline } from "./support/report-answers-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const CONFORMING = "conforming";
const NON_CONFORMING = "non-conforming";

/**
 * Build the repository and write down an attest run in it.
 * @returns The repository
 */
async function attested(): Promise<ProofSetting> {
  const where = await conformingRepository();
  const recorded = await record(where);
  if (recorded.problems !== null) throw new Error(recorded.problems.join("\n"));
  return where;
}

/**
 * The ids of the requirements one of the three ways meets.
 * @param met - Tells whether a requirement is met that way
 * @returns Their ids, in the catalogue's order
 */
function idsOf(
  met: (criterion: (typeof REQUIREMENTS)[number]) => boolean
): readonly string[] {
  return REQUIREMENTS.filter(met).map(each => each.id);
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("a repository in which every requirement is met", () => {
  it("gets a conforming Level 1 result that its own check accepts", async () => {
    const where = await attested();
    const verdict = verdictIn(where.repoPath);

    expect(verdict.result).toBe(CONFORMING);
    expect(verdict.prevented_by).toEqual([]);
    expect(verdict.counts).toEqual({
      conforming: REQUIREMENTS.length,
      [NON_CONFORMING]: 0,
      unknown: 0,
      "not-applicable": 0,
    });
    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("shows, for every requirement, whether it rests on a proof, a located record or a person's word", async () => {
    const where = await attested();
    const { criteria } = verdictIn(where.repoPath);
    const withRung = (rung: string, reason: string): readonly string[] =>
      criteria
        .filter(each => each.rung === rung && each.reason === reason)
        .map(each => each.criterion);

    expect(withRung("exercised", "control-proved")).toEqual(
      idsOf(needsControl)
    );
    expect(withRung("observed", "artifact-located")).toEqual(idsOf(isLocated));
    expect(withRung("asserted", "person-attested")).toEqual(idsOf(isAttested));
    expect(idsOf(needsControl)).toHaveLength(27);
    expect(idsOf(isLocated)).toHaveLength(39);
    expect(idsOf(isAttested)).toHaveLength(11);
  });

  it("records where each located record was found and what each person answered", async () => {
    const where = await attested();
    const records = evidenceIn(where.repoPath).records;
    const [located] = idsOf(isLocated);
    const [vouched] = idsOf(isAttested);

    expect(
      records.find(each => each.id === `audit-finding/${located ?? ""}@.`)
    ).toMatchObject({
      rung: "observed",
      result: "held",
      reason: "artifact-located",
      detail: expect.stringContaining(`${RECORD_FILE} line 1`) as unknown,
    });
    expect(
      records.find(each => each.id === `audit-finding/${vouched ?? ""}@.`)
    ).toMatchObject({
      rung: "asserted",
      result: "held",
      reason: "person-attested",
      detail: expect.stringContaining(`"${PERSON_ANSWER}"`) as unknown,
    });
  });

  it("is non-conforming, naming the one requirement, when what meets any single requirement is taken away", async () => {
    const where = await attested();
    const evidence = evidenceIn(where.repoPath);
    const register = jsonOf<ControlRegister>(
      where.repoPath,
      CONTROL_REGISTER_PATH
    );
    const catalogue = loadCriterionCatalogue();

    const without = REQUIREMENTS.map(({ id }) => {
      const verdict = computeVerdict({
        catalogue,
        register,
        evidence: {
          ...evidence,
          records: evidence.records.filter(each => each.criterion !== id),
        },
        now: RECORDED_NOW,
      });
      return [id, verdict.result, verdict.prevented_by];
    });

    expect(without).toEqual(
      REQUIREMENTS.map(({ id }) => [id, NON_CONFORMING, [id]])
    );
  });
});

describe("what meets a requirement, taken away in the repository itself", () => {
  it("leaves a requirement a person vouches for unknown once the person takes the answer back", async () => {
    const where = await conformingRepository();
    const [vouched] = idsOf(isAttested);
    // The person empties the answer line, and the shipped command withdraws
    // the answer from the record. The finding still says it is written down.
    answerInline(where.repoPath, `${vouched ?? ""}@.`, "");
    const withdrawn = await absorb(where.repoPath);

    const recorded = await record(where);
    const verdict = recorded.problems === null ? recorded.verdict : null;

    expect(withdrawn.code).toBe(0);
    expect(verdict?.result).toBe(NON_CONFORMING);
    expect(verdict?.prevented_by).toEqual([vouched]);
    expect(
      verdict?.criteria.find(each => each.criterion === vouched)
    ).toMatchObject({ verdict: "unknown", reason: "no-attestation" });
  });

  it("leaves a located record unknown when the line the audit pointed at is no longer there, whatever the report's own check found", async () => {
    const where = await conformingRepository();
    const [located] = idsOf(isLocated);

    const recorded = await record(
      where,
      {},
      {
        loadReport: async (root, now) => {
          const { loadAuditReport } =
            await import("../../../src/controls/audit-report-file.js");
          const loaded = await loadAuditReport(root, now);
          return loaded.problems === null
            ? {
                ...loaded,
                report: {
                  ...loaded.report,
                  findings: loaded.report.findings.map(finding =>
                    finding.criterion === located
                      ? {
                          ...finding,
                          mechanisms: finding.mechanisms.map(mechanism => ({
                            ...mechanism,
                            locators: [{ path: RECORD_FILE, line: 9999 }],
                          })),
                        }
                      : finding
                  ),
                },
              }
            : loaded;
        },
      }
    );
    const verdict = recorded.problems === null ? recorded.verdict : null;

    expect(verdict?.result).toBe(NON_CONFORMING);
    expect(verdict?.prevented_by).toEqual([located]);
    expect(
      verdict?.criteria.find(each => each.criterion === located)
    ).toMatchObject({
      verdict: "unknown",
      reason: "artifact-not-found",
      detail: expect.stringContaining(
        `nothing is at ${RECORD_FILE} line 9999`
      ) as unknown,
    });
  });
});
