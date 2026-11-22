/**
 * The findings a before-enforce run offers the audit report
 * (CodySwannGT/lisa#5001).
 *
 * The run writes nothing; it prints findings in the report's own shape for
 * the attest skill to put there. So what matters is that each offered
 * finding is one the report accepts in the place the report keeps it: the
 * state, the placement, the plain-language fields and the pointers. The
 * last case puts an offered finding into a complete report and runs the
 * report's own check on it.
 * @module tests/unit/controls/before-enforce-findings
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AuditFinding } from "../../../src/controls/audit-report-types.js";
import { criterionIdsIn } from "../../../src/controls/catalogue.js";
import {
  API_SOURCE,
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  amendFinding,
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import {
  beforeEnforce,
  declared,
  type BeforeEnforceRunResult,
} from "./support/before-enforce-run.js";
import { removeScratch } from "./support/proof-copy-run.js";
import { check, keep, removeFixtures } from "./support/report-check-run.js";

/** Answered once per part of the repository. */
const STYLE = "SI7";

/** Answered once for the whole repository. */
const CHANGE_REVIEW = "AC1.7";

const LINTER = checks(F_NONE_SOURCE);

/**
 * The findings a run offered.
 * @param run - What the command printed
 * @returns The findings
 */
function offered(run: BeforeEnforceRunResult): readonly AuditFinding[] {
  return run.result?.audit_findings ?? [];
}

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("the finding offered for a check that exists and is not enforced", () => {
  it("is in state exists-not-enforced and quotes the accepted change: the git command and its exit status", async () => {
    const [finding, ...rest] = offered(
      await beforeEnforce(declared(provedGates([{ command: LINTER }])))
    );

    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      criterion: STYLE,
      scope: ".",
      state: "exists-not-enforced",
    });
    expect(finding?.what).toContain(
      'The check "code-style" for the whole repository exists and is not enforced.'
    );
    expect(finding?.what).toContain(
      "nothing stopped it: git commit exited 0 and the change went through"
    );
    expect(finding?.what).toContain("reported the problem, so it works");
    expect(finding?.next).toContain("Run the enforce step.");
  });

  it("names no requirement by its id in what an operator reads", async () => {
    const [finding] = offered(
      await beforeEnforce(declared(provedGates([{ command: LINTER }])))
    );

    expect(
      [finding?.what, finding?.why, finding?.next].flatMap(text =>
        criterionIdsIn(text ?? "")
      )
    ).toEqual([]);
    expect(finding?.why.trim()).not.toBe("");
  });

  it("points at the gate in the declaration and at every place the entry itself cites", async () => {
    const repoPath = declared(provedGates([{ command: LINTER }]));
    const [finding] = offered(await beforeEnforce(repoPath));
    const [mechanism, ...others] = finding?.mechanisms ?? [];

    expect(others).toEqual([]);
    expect(mechanism).toMatchObject({
      tool: path.basename(process.execPath),
      command: LINTER.join(" "),
      moment: "none",
    });
    expect(mechanism?.locators).toEqual([
      { path: ".lisa.config.json", line: 3 },
      { path: "Makefile", line: 1 },
    ]);
  });

  it("is placed at the folder for a requirement answered per part, and at the whole repository for one answered once", async () => {
    const { repoPath } = keep(
      buildProofFixture(
        {
          "code-style": {
            commit: "required",
            criteria: [STYLE, CHANGE_REVIEW],
            parts: [
              {
                scope: "api",
                command: checks("src/api/greeting.py"),
                evidence: { locators: [{ path: "api/ruff.toml", line: 1 }] },
                proof: {
                  violation: ".lisa/controls/proofs/lint.violation.patch",
                  clean: ".lisa/controls/proofs/lint.clean.patch",
                  failure_shape: ["Found 1 error"],
                },
              },
            ],
          },
        },
        proofFiles(proofPatches("F-mixed", API_SOURCE)),
        "F-mixed"
      )
    );

    const findings = offered(await beforeEnforce(repoPath));

    expect(findings.map(finding => [finding.criterion, finding.scope])).toEqual(
      [
        [CHANGE_REVIEW, "."],
        [STYLE, "api"],
      ]
    );
    expect(findings[1]?.what).toContain('in the folder "api"');
  });

  it("is not offered for an entry that was not exercised", async () => {
    const run = await beforeEnforce(
      declared(
        provedGates([{ command: LINTER, without: ["violation", "clean"] }])
      )
    );

    expect(offered(run)).toEqual([]);
  });
});

describe("an offered finding put into the audit report", () => {
  it("replaces the report's finding at the same requirement and place, and the report's own check accepts it", async () => {
    const repoPath = declared(provedGates([{ command: LINTER }]));
    writeFileSync(path.join(repoPath, "Makefile"), "lint:\n\ttrue\n");
    const [finding] = offered(await beforeEnforce(repoPath));
    if (finding === undefined) throw new Error("no finding was offered");

    writeAuditReport(
      repoPath,
      amendFinding(
        completeAuditReport(),
        { criterion: finding.criterion, scope: finding.scope },
        { ...finding }
      )
    );
    const checked = await check(repoPath);

    expect(checked.stderr).toEqual([]);
    expect(checked.code).toBe(0);
  });
});
