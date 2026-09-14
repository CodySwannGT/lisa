import { describe, expect, it } from "vitest";

import { findBreakages } from "../../../scripts/check-workflow-package-paths.mjs";
import { readContractDeclaration } from "../../../scripts/lib/workflow-contract-probe.mjs";

const ARTIFACT = "plugins/fixture/resolve-token.mjs";
const GROUPS = [
  { workflow: "build.yml", step: "Opt-in token", paths: [ARTIFACT] },
];
const CONTRACTS = {
  [ARTIFACT]: {
    kind: "reference",
    why: "The optional workflow input activates this new package artifact only after an explicit migration.",
    since: "4.60.0",
    degradation:
      "Existing explicit-token callers skip this step; opting in before upgrading reports the required package upgrade.",
  },
};

describe("introduced optional workflow package paths", () => {
  it("preserves older callers when the declared optional artifact did not exist", () => {
    expect(findBreakages(GROUPS, { "4.59.1": [] }, CONTRACTS)).toEqual([]);
  });

  it.each(["4.60.0", "4.61.0", "next-release"])(
    "requires the artifact in %s",
    version => {
      expect(findBreakages(GROUPS, { [version]: [] }, CONTRACTS)).toHaveLength(
        1
      );
      expect(
        findBreakages(GROUPS, { [version]: [`package/${ARTIFACT}`] }, CONTRACTS)
      ).toEqual([]);
    }
  );

  it("does not excuse an undeclared path on an older release", () => {
    expect(findBreakages(GROUPS, { "4.59.1": [] })).toHaveLength(1);
  });

  it("requires an explanation of the compatibility behavior", () => {
    expect(() =>
      readContractDeclaration({
        contracts: { [ARTIFACT]: { ...CONTRACTS[ARTIFACT], degradation: "" } },
      })
    ).toThrow(/degradation/);
  });
});
