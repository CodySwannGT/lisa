/**
 * Regression coverage for the Linear `ready` gate inversion (#2443).
 *
 * The `ready` role must name a lane a human moves an Issue INTO. Linear's
 * default created state is where every brand-new Issue lands, so pointing
 * `ready` at it inverts the gate: the claimable lane stops meaning "a human
 * flipped this to build-ready" and starts meaning "nobody has touched this",
 * and build-intake dispatches work nobody approved. Observed on acmeorgd — 20
 * Issues in the lane, 12 of them never marked ready, including decision tickets
 * shaped like leaves that the leaf-only gate could not catch.
 *
 * `LINEAR_WORKFLOW_DEFAULTS.ready` was already repaired to `Ready`, so this
 * file covers the arm that repair left open: a PER-PROJECT `linear.workflow`
 * override reproducing the same inversion, which nothing validated.
 * @module tests/unit/strategies/linear-ready-state-inversion
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveBuildLifecycleRoles } from "../../../plugins/src/base/scripts/queue-contract-resolution.mjs";

const SKILL_ROOT = "plugins/src/base/skills";
const VALIDATE_MAPPING_SKILL = "lisa-validate-tracker-mapping";

const readSkill = (name: string): string =>
  readFileSync(path.resolve(SKILL_ROOT, name, "SKILL.md"), "utf8");

describe("Linear `ready` may never be the team's default created state (#2443)", () => {
  it("still defaults `ready` to the dedicated `Ready` state", () => {
    const linear = resolveBuildLifecycleRoles({ tracker: "linear" });

    expect(linear.roles.ready).toBe("Ready");
  });

  it.each(["Todo", "Backlog", "Triage", "To Do"])(
    "rejects a `ready` override naming the stock default created state %s",
    stockDefault => {
      expect(() =>
        resolveBuildLifecycleRoles({
          tracker: "linear",
          linear: { workflow: { ready: stockDefault } },
        })
      ).toThrow(/default/i);
    }
  );

  it("names the offending state and the repair command in the rejection", () => {
    let message = "";
    try {
      resolveBuildLifecycleRoles({
        tracker: "linear",
        linear: { workflow: { ready: "Todo" } },
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Todo");
    expect(message).toContain("linear.workflow.ready");
    expect(message).toContain("/lisa:setup:linear");
  });

  it("rejects regardless of casing and surrounding whitespace", () => {
    expect(() =>
      resolveBuildLifecycleRoles({
        tracker: "linear",
        linear: { workflow: { ready: "  todo  " } },
      })
    ).toThrow(/default/i);
  });

  it("accepts a genuine dedicated ready lane under any team's naming", () => {
    const linear = resolveBuildLifecycleRoles({
      tracker: "linear",
      linear: { workflow: { ready: "Ready for Dev" } },
    });

    expect(linear.roles.ready).toBe("Ready for Dev");
  });

  it("leaves the other Linear roles free to use those names", () => {
    const linear = resolveBuildLifecycleRoles({
      tracker: "linear",
      linear: { workflow: { blocked: "Triage" } },
    });

    expect(linear.roles.blocked).toBe("Triage");
  });

  it("does not police JIRA or GitHub, whose defaults are not this lane", () => {
    const jira = resolveBuildLifecycleRoles({
      tracker: "jira",
      jira: { workflow: { ready: "To Do" } },
    });

    expect(jira.roles.ready).toBe("To Do");
  });
});

describe("`lisa-validate-tracker-mapping` owns the live inversion check", () => {
  it("audits the Linear build lane as workflow states", () => {
    const skill = readSkill(VALIDATE_MAPPING_SKILL);

    expect(skill).toMatch(
      /\*\*Linear build workflow\*\* \(`linear\.workflow`\)/
    );
  });

  it("marks the pre-state-model label keys inert rather than auditing them", () => {
    const skill = readSkill(VALIDATE_MAPPING_SKILL);
    const mentions = skill
      .split("\n")
      .filter(line => line.includes("linear.labels.build"));

    expect(mentions.length).toBeGreaterThan(0);
    for (const line of mentions) expect(line).toContain("inert");
  });

  it("classifies a `ready` equal to the team's default created state as INVERTED", () => {
    const skill = readSkill(VALIDATE_MAPPING_SKILL);

    expect(skill).toContain("INVERTED");
    expect(skill).toContain("defaultIssueState");
  });

  it("never auto-repairs an INVERTED role, because the config alone cannot say what the human meant", () => {
    const skill = readSkill(VALIDATE_MAPPING_SKILL);
    const repairSection = skill.slice(skill.indexOf("## Step 6"));

    expect(repairSection).toContain("INVERTED");
    expect(repairSection).toMatch(/never auto-repair|Never auto-repair/);
  });

  it("keeps an INVERTED project out of the VALID verdict", () => {
    const skill = readSkill(VALIDATE_MAPPING_SKILL);
    const verdictSection = skill.slice(
      skill.indexOf("A project's verdict"),
      skill.indexOf("## Step 5")
    );

    expect(verdictSection).toContain("INVERTED");
  });
});

describe("`lisa-linear-access` surfaces which state the team creates into", () => {
  it("flags the team default on `list-workflow-states` so callers need no second query", () => {
    const skill = readSkill("lisa-linear-access");

    expect(skill).toContain("defaultIssueState");
    expect(skill).toContain("isTeamDefault");
  });
});
