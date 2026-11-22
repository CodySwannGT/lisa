/**
 * What an attest run leaves in the repository: the evidence, the control
 * register and the verdict, written in that order so each is computed from
 * the one before (CodySwannGT/lisa#4998).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import { parseEvidenceDocument } from "../../../src/controls/evidence-document.js";
import { DEFAULT_FRESHNESS_SECONDS } from "../../../src/controls/evidence-types.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import { digestOf } from "../../../src/controls/verdict-digest.js";
import { VERDICT_PATH } from "../../../src/controls/verdict-types.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import {
  amendFinding,
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import {
  ACCEPTS_EVERYTHING,
  checks,
  F_NONE_SOURCE,
  provedGates,
  workspaceCopy,
} from "../../helpers/control-proofs.js";
import {
  evidenceIn,
  jsonOf,
  record,
  RECORDED_NOW,
  textOf,
  verdictIn,
  WRITTEN_FILES,
} from "./support/attest-record-run.js";
import { removeCopies, setting } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const BROKEN = provedGates([{ command: ACCEPTS_EVERYTHING }]);
const ENTRY = "code-style@.";

/**
 * A requirement that may not apply: it asks about connectors to outside
 * tools, and the catalogue allows that a repository's agents use none. A
 * requirement that always applies cannot be filed as not applicable.
 */
const NO_CONNECTORS = "AC9.4";

/** The word for a requirement, or a result, that is not met. */
const NON_CONFORMING = "non-conforming";

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("what an attest run writes down", () => {
  it("is one evidence record per half, with the commit, the command and the times", async () => {
    const where = setting(WORKING);
    const head = runControlAuditGit(where.repoPath, [
      "rev-parse",
      "HEAD",
    ]).trim();

    const recorded = await record(where);

    expect(recorded.problems).toBeNull();
    expect(evidenceIn(where.repoPath).records).toEqual([
      expect.objectContaining({
        id: `${ENTRY}/commit/clean/SI7`,
        criterion: "SI7",
        entry_id: ENTRY,
        rung: "exercised",
        half: "clean",
        result: "held",
        commit: head,
        exit_status: 0,
        started_at: "2026-01-01T00:00:02.000Z",
        completed_at: "2026-01-01T00:00:03.000Z",
        freshness_seconds: DEFAULT_FRESHNESS_SECONDS,
      }),
      expect.objectContaining({
        id: `${ENTRY}/commit/violation/SI7`,
        half: "violation",
        result: "held",
        commit: head,
        exit_status: 1,
        started_at: "2026-01-01T00:00:00.000Z",
        completed_at: "2026-01-01T00:00:01.000Z",
      }),
    ]);
    expect(
      parseEvidenceDocument(evidenceIn(where.repoPath)).problems
    ).toBeNull();
  });

  it("is a verdict that is conforming for the proved requirement and names the rest", async () => {
    const where = setting(WORKING);

    await record(where);
    const verdict = verdictIn(where.repoPath);

    expect(
      verdict.criteria.find(each => each.criterion === "SI7")
    ).toMatchObject({ verdict: "conforming", rung: "exercised" });
    expect(verdict.result).toBe(NON_CONFORMING);
    expect(verdict.prevented_by).not.toContain("SI7");
    expect(verdict.prevented_by).toHaveLength(verdict.criteria.length - 1);
  });

  it("records a failed proof, and the requirement is then non-conforming", async () => {
    const where = setting(BROKEN);

    await record(where);

    expect(
      evidenceIn(where.repoPath).records.map(each => [each.half, each.result])
    ).toEqual([
      ["clean", "held"],
      ["violation", "failed"],
    ]);
    expect(
      verdictIn(where.repoPath).criteria.find(each => each.criterion === "SI7")
    ).toMatchObject({ verdict: NON_CONFORMING, reason: "control-failed" });
  });

  it("tells the operator what was written and what the Level 1 result is", async () => {
    const where = setting(WORKING);

    const recorded = await record(where);

    const lines = recorded.problems === null ? recorded.lines : [];
    expect(lines.slice(0, 4)).toEqual([
      `Recorded 2 evidence records in ${EVIDENCE_PATH}: 2 about controls, 0 from the audit report.`,
      expect.stringMatching(
        /^No audit report is at \.lisa\/audit\/report\.json, /u
      ),
      expect.stringContaining(CONTROL_REGISTER_PATH),
      expect.stringMatching(
        /^Level 1 result: non-conforming\. Conforming or not applicable: 1 of 77 requirements\. Preventing a conforming result: 76 \(0 non-conforming, 76 unknown\): AC1\.1, /u
      ),
    ]);
    expect(lines.slice(4)).toContainEqual(
      expect.stringMatching(
        /^AC5\.1 needs evidence\. .*The minimum evidence rung is observed\.$/u
      )
    );
    expect(lines.slice(4)).toContainEqual(
      expect.stringMatching(
        /^AC5\.2 needs evidence\. .*The minimum evidence rung is exercised\.$/u
      )
    );
  });

  it("is the same bytes when the same run is written down twice", async () => {
    const where = setting(WORKING);

    await record(where);
    const first = WRITTEN_FILES.map(file => textOf(where.repoPath, file));
    await record(where);

    expect(WRITTEN_FILES.map(file => textOf(where.repoPath, file))).toEqual(
      first
    );
    first.forEach(text => {
      expect(text).not.toContain(where.repoPath);
      expect(text).not.toContain(where.workspace);
    });
  });

  it("records no commit, and still writes, where there is no git", async () => {
    const where = setting(WORKING);
    const bare = workspaceCopy(where.repoPath, false);

    try {
      const recorded = await record({ ...where, repoPath: bare.directory });

      expect(recorded.problems).toBeNull();
      expect(
        evidenceIn(bare.directory).records.map(each => each.commit)
      ).toEqual([null, null]);
    } finally {
      bare.cleanup();
    }
  });
});

describe("the findings of an audit report", () => {
  it("are recorded as asserted evidence and decide the requirements no control serves", async () => {
    const where = setting(WORKING);
    writeAuditReport(
      where.repoPath,
      amendFinding(
        completeAuditReport(),
        { criterion: NO_CONNECTORS, scope: "." },
        {
          state: "not-applicable",
          what: "Agents use no connectors to outside tools here.",
        }
      )
    );

    const recorded = await record(where);
    const verdict = verdictIn(where.repoPath);

    expect(recorded.problems).toBeNull();
    expect(
      evidenceIn(where.repoPath).records.filter(each => each.entry_id === null)
    ).toHaveLength(77);
    expect(
      verdict.criteria.find(each => each.criterion === NO_CONNECTORS)
    ).toMatchObject({
      verdict: "not-applicable",
      fact: "Agents use no connectors to outside tools here.",
      evidence: [`audit-finding/${NO_CONNECTORS}@.`],
    });
    expect(
      verdict.criteria.find(each => each.criterion === "AC1.5")
    ).toMatchObject({ verdict: NON_CONFORMING, reason: "nothing-found" });
    expect(
      verdict.criteria.find(each => each.criterion === "SI7")?.verdict
    ).toBe("conforming");
  });

  it("are left out, and the operator is told, when the report does not pass its check", async () => {
    const where = setting(WORKING);
    writeAuditReport(where.repoPath, { schema_version: 1 });

    const recorded = await record(where);

    expect(recorded.problems === null ? recorded.lines : []).toContainEqual(
      expect.stringContaining("does not pass its check")
    );
    expect(evidenceIn(where.repoPath).records).toHaveLength(2);
  });
});

describe("the order the three files are written in", () => {
  it("is evidence, then register, then verdict", async () => {
    const where = setting(WORKING);
    const order: string[] = [];
    const { writeControlFile } =
      await import("../../../src/controls/control-files.js");

    await record(
      where,
      {},
      {
        writeFile: (root, file, text) => {
          order.push(file);
          return writeControlFile(root, file, text);
        },
      }
    );

    expect(order).toEqual([...WRITTEN_FILES]);
  });

  it("gives a verdict whose digest covers the register and the evidence as written", async () => {
    const where = setting(WORKING);

    await record(where);
    const { digest } = verdictIn(where.repoPath);
    const register = jsonOf<unknown>(where.repoPath, CONTROL_REGISTER_PATH);
    const evidence = jsonOf<unknown>(where.repoPath, EVIDENCE_PATH);

    expect(digest).toEqual({
      algorithm: "sha256",
      register: digestOf(register),
      evidence: digestOf(evidence),
      value: digestOf({ evidence, register }),
    });
  });
});

describe("an attest run that cannot be written down", () => {
  it("says so and writes nothing when the evidence file is a link", async () => {
    const where = setting(WORKING);
    const file = path.join(where.repoPath, EVIDENCE_PATH);
    const elsewhere = path.join(where.workspace, "elsewhere.json");
    writeFileSync(elsewhere, "{}\n");
    mkdirSync(path.dirname(file), { recursive: true });
    createSymlink(elsewhere, file);

    const recorded = await record(where);

    expect(recorded.problems).toEqual([
      expect.stringContaining(`${EVIDENCE_PATH} is not an ordinary file`),
    ]);
    expect(textOf(where.workspace, "elsewhere.json")).toBe("{}\n");
    expect(() => textOf(where.repoPath, VERDICT_PATH)).toThrow();
  });

  it("says what went wrong instead of throwing when a file cannot be written", async () => {
    const where = setting(WORKING);

    const recorded = await record(
      where,
      {},
      {
        writeFile: () => Promise.reject(new Error("the disk is full")),
      }
    );

    expect(recorded.problems).toEqual(["the disk is full"]);
  });

  it("replaces an evidence file that is not what it writes, and says so", async () => {
    const where = setting(WORKING);
    const file = path.join(where.repoPath, EVIDENCE_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ records: [{ id: "by-hand" }] }));

    const recorded = await record(where);

    expect(recorded.problems === null ? recorded.lines : []).toContainEqual(
      expect.stringContaining("did not hold what the attest step writes")
    );
    expect(evidenceIn(where.repoPath).records).toHaveLength(2);
  });

  it.each([0, 1.5, 366 * 24 * 60 * 60])(
    "refuses a freshness lifetime of %d seconds",
    async freshnessSeconds => {
      const where = setting(WORKING);

      const recorded = await record(where, { freshnessSeconds });

      expect(recorded.problems).toEqual([
        expect.stringContaining("freshness lifetime"),
      ]);
      expect(() => textOf(where.repoPath, EVIDENCE_PATH)).toThrow();
    }
  );

  it("gives each record the lifetime the caller asks for", async () => {
    const where = setting(WORKING);

    await record(where, { freshnessSeconds: 3600, now: RECORDED_NOW });

    expect(
      evidenceIn(where.repoPath).records.map(each => each.freshness_seconds)
    ).toEqual([3600, 3600]);
    expect(verdictIn(where.repoPath).current_until).toBe(
      "2026-01-01T01:00:01.000Z"
    );
  });
});
