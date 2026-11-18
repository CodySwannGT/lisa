/**
 * `lisa controls attest --check`: the committed verdict is computed again
 * from the committed register and evidence, and any difference is named
 * (CodySwannGT/lisa#4998).
 *
 * The verdict is what an operator shows to someone else, so it must not be
 * possible to edit it into a pass, to edit the evidence under it, or to let
 * it outlive the evidence it rests on, without this check saying so.
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import type { EvidenceDocument } from "../../../src/controls/evidence-types.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import { digestOf } from "../../../src/controls/verdict-digest.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../../src/controls/verdict-types.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import {
  ACCEPTS_EVERYTHING,
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  attested,
  checkVerdict,
  editJson,
  jsonOf,
} from "./support/attest-record-run.js";
import { removeCopies } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const BROKEN = provedGates([{ command: ACCEPTS_EVERYTHING }]);

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("lisa controls attest --check on an untouched verdict", () => {
  it("exits 0 and says what the verdict is", async () => {
    const where = await attested(WORKING);

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
    expect(run.stderr).toEqual([]);
    expect(run.stdout).toEqual([
      expect.stringMatching(
        /^attest --check: PASS\. \.lisa\/controls\/verdict\.json is what \.lisa\/controls\/register\.json and \.lisa\/controls\/evidence\.json give\. Level 1 result: non-conforming\. /u
      ),
    ]);
  });

  it("writes nothing", async () => {
    const where = await attested(WORKING);
    const before = runControlAuditGit(where.repoPath, ["status", "--short"]);

    await checkVerdict(where.repoPath);

    expect(runControlAuditGit(where.repoPath, ["status", "--short"])).toBe(
      before
    );
  });

  it("still passes when the files are only laid out differently", async () => {
    const where = await attested(WORKING);
    editJson<Verdict>(where.repoPath, VERDICT_PATH, verdict =>
      Object.fromEntries(Object.entries(verdict).reverse())
    );

    expect((await checkVerdict(where.repoPath)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });
});

describe("lisa controls attest --check on a verdict edited by hand", () => {
  it("exits non-zero when the result was edited to read conforming", async () => {
    const where = await attested(WORKING);
    editJson<Verdict>(where.repoPath, VERDICT_PATH, verdict => ({
      ...verdict,
      result: "conforming",
      prevented_by: [],
    }));

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr).toContain(
      `${VERDICT_PATH} says the Level 1 result is "conforming"; the register and the evidence give non-conforming.`
    );
    expect(run.stderr).toContain(
      `${VERDICT_PATH} leaves AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.6, AC1.7, AC1.8, AC1.9, AC2.1 and 66 more out of "prevented_by"; the register and the evidence give them as requirements that prevent a conforming result.`
    );
    expect(run.stderr.at(-1)).toMatch(
      /^attest --check: FAIL\. 2 differences .* do not edit them by hand\. Run "lisa controls attest"/u
    );
  });

  it("names the requirement whose verdict was edited", async () => {
    const where = await attested(WORKING);
    editJson<Verdict>(where.repoPath, VERDICT_PATH, verdict => ({
      ...verdict,
      criteria: verdict.criteria.map(each =>
        each.criterion === "AC1.1" ? { ...each, verdict: "conforming" } : each
      ),
    }));

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr[0]).toMatch(
      /^AC1\.1: \.lisa\/controls\/verdict\.json says "conforming"; the register and the evidence give unknown\. No control in the register serves this requirement/u
    );
  });

  it.each([
    [
      "a requirement was removed",
      (verdict: Verdict) => ({
        ...verdict,
        criteria: verdict.criteria.filter(each => each.criterion !== "AC1.1"),
      }),
      "AC1.1: .lisa/controls/verdict.json has no verdict for this requirement",
    ],
    [
      "the digest was changed",
      (verdict: Verdict) => ({
        ...verdict,
        digest: { ...verdict.digest, value: "0".repeat(64) },
      }),
      "The digest written in .lisa/controls/verdict.json is not the digest of the register and the evidence",
    ],
    [
      "the time it stays current until was moved",
      (verdict: Verdict) => ({
        ...verdict,
        current_until: "2099-01-01T00:00:00.000Z",
      }),
      '.lisa/controls/verdict.json says "current_until" is "2099-01-01T00:00:00.000Z"',
    ],
    [
      "a requirement that is conforming was listed as preventing the result",
      (verdict: Verdict) => ({
        ...verdict,
        prevented_by: ["SI7", ...verdict.prevented_by],
      }),
      '.lisa/controls/verdict.json lists SI7 in "prevented_by"; the register and the evidence give no reason for it to be there.',
    ],
    [
      "a key was added",
      (verdict: Verdict) => ({ ...verdict, approved_by: "someone" }),
      'has the key "approved_by", which the attest step does not write',
    ],
    [
      "the reason of a requirement was reworded",
      (verdict: Verdict) => ({
        ...verdict,
        criteria: verdict.criteria.map(each =>
          each.criterion === "SI7" ? { ...each, detail: "Trust me." } : each
        ),
      }),
      "SI7: the verdict is conforming in both, but detail is not what the register and the evidence give.",
    ],
  ])("exits non-zero when %s", async (_name, change, saying) => {
    const where = await attested(WORKING);
    editJson<Verdict>(where.repoPath, VERDICT_PATH, change);

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr.join("\n")).toContain(saying);
  });
});

describe("lisa controls attest --check when what the verdict rests on was changed", () => {
  /**
   * Turn the record of the failed half into one that says it held.
   * @param evidence - The evidence file
   * @returns The edited file
   */
  function flipped(evidence: EvidenceDocument): EvidenceDocument {
    return {
      ...evidence,
      records: evidence.records.map(each =>
        each.result === "failed" ? { ...each, result: "held" } : each
      ),
    };
  }

  it("exits non-zero when an evidence record was edited to flip its result", async () => {
    const where = await attested(BROKEN);
    editJson<EvidenceDocument>(where.repoPath, EVIDENCE_PATH, flipped);

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr[0]).toMatch(
      /^\.lisa\/controls\/evidence\.json is not the evidence this verdict was computed from: /u
    );
    expect(run.stderr.join("\n")).toContain(
      'SI7: .lisa/controls/verdict.json says "non-conforming"; the register and the evidence give conforming.'
    );
  });

  it("still exits non-zero when the digest was edited to match the edited evidence", async () => {
    const where = await attested(BROKEN);
    editJson<EvidenceDocument>(where.repoPath, EVIDENCE_PATH, flipped);
    const evidence = jsonOf<unknown>(where.repoPath, EVIDENCE_PATH);
    const register = jsonOf<unknown>(where.repoPath, CONTROL_REGISTER_PATH);
    editJson<Verdict>(where.repoPath, VERDICT_PATH, verdict => ({
      ...verdict,
      digest: {
        ...verdict.digest,
        evidence: digestOf(evidence),
        value: digestOf({ evidence, register }),
      },
    }));

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr.join("\n")).not.toContain("is not the evidence");
    expect(run.stderr.join("\n")).toContain(
      "the register and the evidence give conforming"
    );
  });

  it("exits non-zero when a record was added by hand in a form the attest step does not write", async () => {
    const where = await attested(WORKING);
    editJson<EvidenceDocument>(where.repoPath, EVIDENCE_PATH, evidence => ({
      ...evidence,
      records: [...evidence.records, { id: "by-hand", criterion: "AC1.1" }],
    }));

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr[0]).toMatch(
      /^\.lisa\/controls\/evidence\.json: Record 3 \("by-hand"\): /u
    );
  });

  it("exits non-zero when the register was edited by hand", async () => {
    const where = await attested(WORKING);
    editJson<{ entries: { tier: string }[] }>(
      where.repoPath,
      CONTROL_REGISTER_PATH,
      register => ({
        ...register,
        entries: register.entries.map(entry => ({
          ...entry,
          tier: "authoritative",
        })),
      })
    );

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr.join("\n")).toContain("code-style@.");
    expect(run.stderr.join("\n")).toContain("tier");
  });

  it.each([
    [VERDICT_PATH, "No verdict was found at .lisa/controls/verdict.json."],
    [
      EVIDENCE_PATH,
      "No evidence file was found at .lisa/controls/evidence.json.",
    ],
    [
      CONTROL_REGISTER_PATH,
      "No control register was found at .lisa/controls/register.json.",
    ],
  ])("exits non-zero when %s is gone", async (file, saying) => {
    const where = await attested(WORKING);
    rmSync(path.join(where.repoPath, file));

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr).toContain(saying);
  });
});
