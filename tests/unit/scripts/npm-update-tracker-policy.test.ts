/**
 * AC1 of CodySwannGT/lisa#4859: the npm-update policy accepts Jira- and
 * Linear-tracked hosts and still refuses every other tracker value.
 */
import { describe, expect, it } from "vitest";
import { validatePolicy } from "../../../all/copy-overwrite/scripts/lib/npm-update-policy.mjs";
import {
  JIRA_CONFIG,
  JIRA_MAINTAINER,
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  policyFor,
} from "../../support/npm-update-tracker-host.js";

const TRACKER_DIFFERS = /configured repository\/tracker differs/;

describe("npm-update policy tracker scope", () => {
  it("accepts a Linear-tracked host with a Linear user id maintainer", () => {
    const policy = policyFor(LINEAR_MAINTAINER);
    expect(validatePolicy(policy, LINEAR_CONFIG)).toEqual(policy);
  });

  it("accepts a Jira-tracked host with a Jira account id maintainer", () => {
    const policy = policyFor(JIRA_MAINTAINER);
    expect(validatePolicy(policy, JIRA_CONFIG)).toEqual(policy);
  });

  it.each([
    ["jira", JIRA_CONFIG, JIRA_MAINTAINER],
    ["linear", LINEAR_CONFIG, LINEAR_MAINTAINER],
  ])(
    "does not fail %s with the repository/tracker refusal",
    (_name, config, maintainer) => {
      expect(() => validatePolicy(policyFor(maintainer), config)).not.toThrow(
        TRACKER_DIFFERS
      );
    }
  );

  it.each(["gitlab", "notion", "GitHub", "", undefined])(
    "refuses tracker %s",
    tracker => {
      expect(() =>
        validatePolicy(policyFor("maintainer"), {
          ...LINEAR_CONFIG,
          tracker,
        })
      ).toThrow(/tracker/);
    }
  );

  it("refuses a Jira host without a project and a Linear host without a team", () => {
    expect(() =>
      validatePolicy(policyFor(JIRA_MAINTAINER), { ...JIRA_CONFIG, jira: {} })
    ).toThrow(/tracker/);
    expect(() =>
      validatePolicy(policyFor(LINEAR_MAINTAINER), {
        ...LINEAR_CONFIG,
        linear: { workspace: "acme" },
      })
    ).toThrow(/tracker/);
    expect(() =>
      validatePolicy(policyFor(LINEAR_MAINTAINER), {
        ...LINEAR_CONFIG,
        linear: { teamKey: "ENG" },
      })
    ).toThrow(/tracker/);
  });

  it("refuses a code-host repository that differs from the configured GitHub repository", () => {
    expect(() =>
      validatePolicy(
        { ...policyFor(LINEAR_MAINTAINER), repository: "foreign/widgets" },
        LINEAR_CONFIG
      )
    ).toThrow(TRACKER_DIFFERS);
  });

  it("requires the maintainer identifier grammar of the configured tracker", () => {
    expect(() => validatePolicy(policyFor("octocat"), LINEAR_CONFIG)).toThrow(
      /maintainer/
    );
    expect(() => validatePolicy(policyFor("has space"), JIRA_CONFIG)).toThrow(
      /maintainer/
    );
    expect(() =>
      validatePolicy(policyFor(JIRA_MAINTAINER), {
        tracker: "github",
        github: { org: "acme", repo: "widgets" },
      })
    ).toThrow(/maintainer/);
  });
});
