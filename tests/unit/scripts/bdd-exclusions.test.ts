/**
 * The exclusion ledger, and the rule that a red run still writes its paperwork.
 *
 * An exclusion is a standing claim that a real test proves nothing about
 * product behavior. Left unchecked those claims outlive what they excused, and
 * "unmapped test" stops meaning anything — so a dead exclusion is a defect in
 * its own right. The last case guards the opposite failure: a fleet fork let
 * one renamed title wedge regeneration entirely, so the artifacts documenting
 * a defect could not be produced until the defect was gone.
 */
import { describe, expect, it } from "vitest";

import {
  HOME_SPEC,
  type Report,
  codes,
  healthyProject,
  messages,
  readProjectFile,
  runGate,
  runGateWrite,
} from "./bdd/support";

const UNDISCLOSED = "spec-undisclosed";
const EXCLUSION_STALE = "exclusion-stale";
const STRAY_SPEC = "e2e/stray.spec.ts";
const STRAY_TITLE = "a test nobody declared";
const STRAY_SOURCE = `test("${STRAY_TITLE}", async () => {});\n`;
const SMOKE_REASON = "starter template kept as a runner smoke check";

describe("an exclusion cannot outlive what it excused", () => {
  it("fails when the excluded file no longer exists", () => {
    const run = runGate(
      healthyProject({
        exclusions: [
          { file: "e2e/deleted.spec.ts", reason: "deleted last quarter" },
        ],
      })
    );
    expect(run.status).toBe(1);
    expect(messages(run, EXCLUSION_STALE)[0]).toContain("e2e/deleted.spec.ts");
  });

  it("fails when its evidence matches nothing in the file", () => {
    const run = runGate(
      healthyProject(
        {
          exclusions: [
            {
              file: STRAY_SPEC,
              evidence: "a title that was renamed away",
              reason: SMOKE_REASON,
            },
          ],
        },
        { files: { [STRAY_SPEC]: STRAY_SOURCE } }
      )
    );
    expect(messages(run, EXCLUSION_STALE)[0]).toContain("renamed away");
    expect(codes(run)).toContain(UNDISCLOSED);
  });

  it("fails when no configured discovery root covers the excluded file", () => {
    const run = runGate(
      healthyProject(
        {
          exclusions: [{ file: "src/util.ts", reason: "not a test at all" }],
        },
        { files: { "src/util.ts": "export const x = 1;\n" } }
      )
    );
    expect(messages(run, EXCLUSION_STALE)[0]).toContain("discovery root");
  });
});

describe("a defect never wedges the artifacts that document it", () => {
  it("regenerates the burndown and report while the run is red", () => {
    // The fleet hit this exactly: one renamed test title made `--write` refuse
    // to run, so a new waiver could not be recorded until an unrelated string
    // was repaired. A defect must stay a defect and keep losing coverage
    // credit — without holding the paperwork hostage.
    const root = healthyProject(
      {},
      { files: { [HOME_SPEC]: STRAY_SOURCE, [STRAY_SPEC]: STRAY_SOURCE } }
    );
    const burndown = runGateWrite(root);
    const report = JSON.parse(
      readProjectFile(root, "bdd/coverage-report.json")
    ) as Report;
    expect(burndown).toContain(STRAY_TITLE);
    expect(report.testInventory.undisclosed).toHaveLength(2);
    expect(report.traceability.overall.covered).toBe(0);
    expect(runGate(root).status).toBe(1);
  });
});
