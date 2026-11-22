/**
 * AC4 of CodySwannGT/lisa#4859: signed authorization artifacts and the gate
 * trailer carry the configured tracker's own reference, and a reference in any
 * other tracker's grammar fails verification.
 */
import { describe, expect, it } from "vitest";
import {
  expectedWorkItem,
  verifySignedWorkItem,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import {
  JIRA_CONFIG,
  LINEAR_CONFIG,
} from "../../support/npm-update-tracker-host.js";

const GITHUB_REF = "acme/widgets#7";

/** The fields of an allocation and its signed preview that name the work item. */
function signed(workItem: string, number = 7) {
  return {
    allocation: { number, workItem },
    preview: {
      descriptor: { workItem },
      message: `chore(deps): update selected npm dependencies\n\nWork-Item: ${workItem}\nAutomation-Provenance: actions/1/attempts/1\n`,
    },
  };
}

describe("signed work-item grammar per tracker", () => {
  it("derives <PROJECT>-<N> for Jira and <TEAM>-<N> for Linear", () => {
    expect(expectedWorkItem(JIRA_CONFIG, 7)).toBe("PROJ-7");
    expect(expectedWorkItem(LINEAR_CONFIG, 7)).toBe("ENG-7");
  });

  it("verifies a Jira authorization and gate trailer naming PROJ-7", () => {
    const { allocation, preview } = signed("PROJ-7");
    expect(() =>
      verifySignedWorkItem(JIRA_CONFIG, allocation, preview)
    ).not.toThrow();
  });

  it("verifies a Linear authorization and gate trailer naming ENG-7", () => {
    const { allocation, preview } = signed("ENG-7");
    expect(() =>
      verifySignedWorkItem(LINEAR_CONFIG, allocation, preview)
    ).not.toThrow();
  });

  it.each([GITHUB_REF, "ENG-7", "proj-7", "PROJ-07", "PROJ-8", "PROJ-7 "])(
    "rejects %j under a Jira config",
    workItem => {
      const { allocation, preview } = signed(workItem);
      expect(() =>
        verifySignedWorkItem(JIRA_CONFIG, allocation, preview)
      ).toThrow(/work item/);
    }
  );

  it.each([GITHUB_REF, "PROJ-7", "eng-7"])(
    "rejects %j under a Linear config",
    workItem => {
      const { allocation, preview } = signed(workItem);
      expect(() =>
        verifySignedWorkItem(LINEAR_CONFIG, allocation, preview)
      ).toThrow(/work item/);
    }
  );

  it("rejects a descriptor or trailer that disagrees with the allocation", () => {
    const { allocation, preview } = signed("PROJ-7");
    expect(() =>
      verifySignedWorkItem(JIRA_CONFIG, allocation, {
        ...preview,
        descriptor: { workItem: GITHUB_REF },
      })
    ).toThrow(/work item/);
    expect(() =>
      verifySignedWorkItem(JIRA_CONFIG, allocation, {
        ...preview,
        message: `${preview.message}Work-Item: PROJ-7\n`,
      })
    ).toThrow(/work item/);
    expect(() =>
      verifySignedWorkItem(JIRA_CONFIG, allocation, {
        ...preview,
        message: preview.message.replace("PROJ-7", GITHUB_REF),
      })
    ).toThrow(/work item/);
  });
});
