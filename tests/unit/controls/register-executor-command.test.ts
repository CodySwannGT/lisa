/**
 * `lisa controls register` against a repository whose pull-request check runs
 * from a pipeline file Lisa did not write.
 *
 * The two things the operator relies on: the entries read unproved until both
 * halves of their proof are on record, and `--check` stays honest about it.
 * The register is generated from the declaration and the evidence file
 * together, so the committed file is out of date exactly when one of the two
 * changed, and `--check` says which (CodySwannGT/lisa#4991).
 */
import { rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import { buildFNone } from "../../helpers/control-audit-fixtures.js";
import { writeEvidenceRecords } from "../../helpers/control-audit-report.js";
import {
  F_MIXED_GATES,
  registerSchemaErrors,
} from "../../helpers/control-register.js";
import {
  LISA_WRITTEN,
  bothHalves,
  proofRecord,
  withExecutor,
} from "./support/executor-fixtures.js";
import {
  declared,
  editRegister,
  readRegister,
  register,
} from "./support/register-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const LINT_API = "code-style@api";
const LINT_WEB = "code-style@web";

const UNPROVED_NOTE =
  /^register(?: --check)?: 2 entries read unproved: code-style@api, code-style@web\. The pull-request check for them runs from \.gitlab-ci\.yml on gitlab, a file Lisa did not write, and \.lisa\/controls\/evidence\.json holds no record of both halves of their proof yet\. They stay unproved until the attest step records both\.$/u;

const STATUS_DRIFT = `The entry "${LINT_API}" in ${CONTROL_REGISTER_PATH} does not match the gates declaration: status differs. The status is worked out from the proof records in ${EVIDENCE_PATH}, so it changes when a proof is recorded or removed.`;

/**
 * The entries of the register a repository holds that read unproved.
 * @param repoPath - The repository root
 * @returns Their identifiers, in file order
 */
function unprovedIn(repoPath: string): readonly string[] {
  const document = JSON.parse(readRegister(repoPath)) as {
    readonly entries: readonly {
      readonly id: string;
      readonly status?: string;
    }[];
  };
  return document.entries
    .filter(entry => entry.status === "unproved")
    .map(entry => entry.id);
}

/**
 * Build F-mixed with a pipeline file named on every pull-request gate and its
 * register already generated.
 * @returns The repository root
 */
async function generatedWithPipeline(): Promise<string> {
  const repoPath = declared("F-mixed", withExecutor(F_MIXED_GATES));
  await register(repoPath);
  return repoPath;
}

afterEach(removeFixtures);

describe("a non-GitHub executor starts unproved", () => {
  it("in the file the command writes, and the command says so", async () => {
    const repoPath = declared("F-mixed", withExecutor(F_MIXED_GATES));

    const run = await register(repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(run.stdout).toEqual([
      expect.stringMatching(UNPROVED_NOTE),
      `register: PASS. 3 entries from 2 gates; wrote ${CONTROL_REGISTER_PATH}`,
    ]);
    expect(unprovedIn(repoPath)).toEqual([LINT_API, LINT_WEB]);
    expect(
      registerSchemaErrors(JSON.parse(readRegister(repoPath)) as unknown)
    ).toEqual([]);
  });

  it("and the committed file passes the check", async () => {
    const repoPath = await generatedWithPipeline();

    const run = await register(repoPath, true);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(run.stdout).toEqual([
      expect.stringMatching(UNPROVED_NOTE),
      `register --check: PASS. ${CONTROL_REGISTER_PATH} matches the gates declaration (3 entries from 2 gates)`,
    ]);
  });

  it("but says nothing of it when Lisa wrote the executor", async () => {
    const repoPath = declared(
      "F-mixed",
      withExecutor(F_MIXED_GATES, LISA_WRITTEN)
    );

    const run = await register(repoPath);

    expect(run.stdout).toEqual([
      `register: PASS. 3 entries from 2 gates; wrote ${CONTROL_REGISTER_PATH}`,
    ]);
    expect(unprovedIn(repoPath)).toEqual([]);
  });
});

describe("evidence clears the status", () => {
  it("when the register is regenerated, for the entry it is evidence of", async () => {
    const repoPath = await generatedWithPipeline();
    writeEvidenceRecords(repoPath, bothHalves(LINT_API));

    const run = await register(repoPath);

    expect(run.code).toBe(0);
    expect(run.stdout).toEqual([
      expect.stringMatching(
        /^register: 1 entry reads unproved: code-style@web\. The pull-request check for it runs from /u
      ),
      `register: PASS. 3 entries from 2 gates; wrote ${CONTROL_REGISTER_PATH}`,
    ]);
    expect(unprovedIn(repoPath)).toEqual([LINT_WEB]);
    expect((await register(repoPath, true)).code).toBe(0);
  });

  it("and says nothing of it once every entry's proof is on record", async () => {
    const repoPath = await generatedWithPipeline();
    writeEvidenceRecords(repoPath, [
      ...bothHalves(LINT_API),
      ...bothHalves(LINT_WEB),
    ]);

    const run = await register(repoPath);

    expect(run.stdout).toEqual([
      `register: PASS. 3 entries from 2 gates; wrote ${CONTROL_REGISTER_PATH}`,
    ]);
    expect(unprovedIn(repoPath)).toEqual([]);
  });

  it("but one half leaves the file as it was", async () => {
    const repoPath = await generatedWithPipeline();
    const before = readRegister(repoPath);
    writeEvidenceRecords(repoPath, [proofRecord(LINT_API, "violation")]);

    const run = await register(repoPath);

    expect(run.stdout.at(-1)).toBe(
      `register: PASS. 3 entries from 2 gates; ${CONTROL_REGISTER_PATH} is already up to date`
    );
    expect(readRegister(repoPath)).toBe(before);
  });

  it("but not evidence reached through a link", async () => {
    const repoPath = await generatedWithPipeline();
    const outside = keep(buildFNone()).repoPath;
    writeEvidenceRecords(outside, bothHalves(LINT_API));
    symlinkSync(
      path.join(outside, EVIDENCE_PATH),
      path.join(repoPath, EVIDENCE_PATH)
    );

    await register(repoPath);

    expect(unprovedIn(repoPath)).toEqual([LINT_API, LINT_WEB]);
  });
});

describe("the check after the evidence changed", () => {
  it("fails until the register is regenerated, and says why", async () => {
    const repoPath = await generatedWithPipeline();
    const before = readRegister(repoPath);
    writeEvidenceRecords(repoPath, bothHalves(LINT_API));

    const run = await register(repoPath, true);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toBe(STATUS_DRIFT);
    expect(run.stderr).toHaveLength(2);
    expect(readRegister(repoPath)).toBe(before);
  });

  it("fails again when the evidence is taken away", async () => {
    const repoPath = await generatedWithPipeline();
    writeEvidenceRecords(repoPath, bothHalves(LINT_API));
    await register(repoPath);
    rmSync(path.join(repoPath, EVIDENCE_PATH));

    const run = await register(repoPath, true);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toBe(STATUS_DRIFT);
  });

  it("catches a status removed by hand", async () => {
    const repoPath = await generatedWithPipeline();
    editRegister(repoPath, document => {
      document.entries.splice(
        0,
        document.entries.length,
        ...document.entries.map(entry =>
          Object.fromEntries(
            Object.entries(entry).filter(([key]) => key !== "status")
          )
        )
      );
    });

    const run = await register(repoPath, true);

    expect(run.code).toBe(1);
    expect(run.stderr.slice(0, 2)).toEqual([
      STATUS_DRIFT,
      STATUS_DRIFT.replace(LINT_API, LINT_WEB),
    ]);
  });
});
