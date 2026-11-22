/**
 * The evidence file and the verdict an attest run writes are valid against
 * their published schemas on every fixture repository
 * (CodySwannGT/lisa#4998).
 *
 * Each fixture is given the declaration a configure step would write for it
 * and a complete audit report, so the files hold every kind of record: the
 * halves of a paired proof where a control has one, and a record of each
 * audit finding.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import { EVIDENCE_SCHEMA_PACKAGE_PATH } from "../../../src/controls/evidence-types.js";
import { VERDICT_SCHEMA_PACKAGE_PATH } from "../../../src/controls/verdict-types.js";
import {
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import {
  API_SOURCE,
  checks,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  provedGates,
  WEB_SOURCE,
} from "../../helpers/control-proofs.js";
import { F_PAVED_GATES } from "../../helpers/control-register.js";
import {
  checkVerdict,
  evidenceIn,
  record,
  verdictIn,
} from "./support/attest-record-run.js";
import {
  removeCopies,
  setting,
  type ProofSetting,
} from "./support/proof-run.js";
import { schemaErrors } from "./support/published-schema.js";
import { removeFixtures } from "./support/report-check-run.js";

/** The scope list of an audit of a repository with one part. */
const ONE_PART: readonly string[] = ["."];

/**
 * F-none with one control that has a working paired proof.
 * @returns The repository and its copy
 */
function fNone(): ProofSetting {
  return setting(provedGates([{ command: checks(F_NONE_SOURCE) }]));
}

/**
 * F-mixed with one control per folder, each with a working paired proof.
 * @returns The repository and its copy
 */
function fMixed(): ProofSetting {
  return setting(
    provedGates([
      { scope: "web", command: checks("src/index.ts"), name: "web" },
      { scope: "api", command: checks("src/api/greeting.py"), name: "api" },
    ]),
    {
      files: {
        ...proofFiles(proofPatches("F-mixed", API_SOURCE), "api"),
        ...proofFiles(proofPatches("F-mixed", WEB_SOURCE), "web"),
      },
      fixture: "F-mixed",
    }
  );
}

/**
 * F-paved with the task-per-gate declaration existing users have: no control
 * has a paired proof, so no proof is run.
 * @returns The repository and its copy
 */
function fPaved(): ProofSetting {
  return setting(F_PAVED_GATES, { files: {}, fixture: "F-paved" });
}

/**
 * F-empty with no control declared at all.
 * @returns The repository and its copy
 */
function fEmpty(): ProofSetting {
  return setting({}, { files: {}, fixture: "F-empty" });
}

/**
 * Give a repository a complete audit report.
 * @param where - The repository and its copy
 * @param scopes - The parts the report covers
 * @returns The same repository
 */
function audited(where: ProofSetting, scopes: readonly string[]): ProofSetting {
  writeAuditReport(where.repoPath, completeAuditReport(scopes));
  return where;
}

/**
 * Build a fixture, give it a complete audit report, and write down an
 * attest run.
 * @param build - Builds the fixture
 * @param scopes - The parts its audit report covers
 * @returns The repository
 */
async function attested(
  build: () => ProofSetting,
  scopes: readonly string[]
): Promise<ProofSetting> {
  const where = audited(build(), scopes);
  const recorded = await record(where);
  if (recorded.problems !== null) throw new Error(recorded.problems.join("\n"));
  return where;
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe.each([
  ["F-none", fNone, ONE_PART, 2],
  ["F-mixed", fMixed, [".", "api", "web"], 4],
  ["F-paved", fPaved, ONE_PART, 0],
  ["F-empty", fEmpty, ONE_PART, 0],
] as const)(
  "what an attest run writes on %s",
  (_name, build, scopes, fromControls) => {
    it("is an evidence file that is valid against the published schema", async () => {
      const where = await attested(build, scopes);
      const evidence = evidenceIn(where.repoPath);

      expect(schemaErrors(EVIDENCE_SCHEMA_PACKAGE_PATH, evidence)).toEqual([]);
      expect(
        evidence.records.filter(each => each.entry_id !== null)
      ).toHaveLength(fromControls);
      expect(
        evidence.records.filter(each => each.entry_id === null).length
      ).toBeGreaterThanOrEqual(77);
    });

    it("is a verdict that is valid against the published schema and passes its own check", async () => {
      const where = await attested(build, scopes);

      expect(
        schemaErrors(VERDICT_SCHEMA_PACKAGE_PATH, verdictIn(where.repoPath))
      ).toEqual([]);
      expect(verdictIn(where.repoPath).criteria).toHaveLength(77);
      expect((await checkVerdict(where.repoPath)).code).toBe(
        ATTEST_CHECK_EXIT.MATCHES
      );
    });
  }
);
