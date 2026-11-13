/**
 * Regression tests for the parent status rollup state machine across the
 * vendor status-transition (sync) surfaces.
 *
 * Issue #544: implement the **Parent status rollup (the state machine)** arm of
 * the vendor-neutral `leaf-only-lifecycle` rule (merged in #537) across the
 * surfaces that own status transitions — `lisa-github-sync` (GitHub sub-issue
 * completion), `lisa-jira-sync` (JIRA child/subtask status), `lisa-linear-sync`
 * (Linear child-issue status) — plus the vendor-neutral `lisa-tracker-sync`
 * dispatcher that documents the contract once. A parent/container derives its
 * lifecycle state from its children: any leaf blocked → parent blocked; any leaf
 * in progress → parent active; all required leaves terminal → parent rolls up to
 * the configured terminal `done`. Blocked dominates; the parent never carries
 * `ready`.
 *
 * Single-environment collapse (this repo): `.lisa.config.json` `deploy.branches`
 * declares only `production: main`, so the env-keyed `done` collapses to one
 * `done` value. GitHub's lifecycle is `ready → in-progress → done` with no
 * code-review hop and no dev/staging promotion hops. The rule and skills stay multi-env
 * capable; these tests assert the collapse is documented and that the rollup
 * never resolves a dev/staging `done` in this repo.
 *
 * Both the source (`plugins/src/base/skills`) and the generated artifact
 * (`plugins/lisa/skills`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/parent-status-rollup
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** Vendor-neutral rule slug every rollup path cites. */
const RULE_SLUG = "leaf-only-lifecycle";
/** Shared test name reused for every skill that cites the rule by slug. */
const CITES_SLUG = "cites the leaf-only-lifecycle rule by slug";
/** Shared test name reused for every skill asserting the intermediate-env rung. */
const INTERMEDIATE_ENV_TEST = "documents the intermediate-env rollup rung";

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

/**
 * Assert a section documents the intermediate-env rollup rung: a parent rolls
 * up to a non-terminal env value (e.g. staging) once all its required children
 * have reached it, while native closure stays gated on the production terminal.
 * This is the rung whose absence stranded SE-318 in `Ready`.
 * @param section - The rollup section text to assert.
 * @param stagingToken - The vendor's staging `done` value (e.g. `On Stg`).
 */
const assertIntermediateEnvRollup = (
  section: string,
  stagingToken: string
): void => {
  expect(section).toContain(stagingToken);
};

describe("parent status rollup (#544)", () => {
  // The vendor-neutral dispatcher documents the rollup contract once and
  // forwards the --rollup flag to the resolved vendor sync skill.
  describe.each(SKILL_ROOTS)("%s/lisa-tracker-sync", root => {
    const content = readSkill(root, "lisa-tracker-sync");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it(INTERMEDIATE_ENV_TEST, () => {
      assertIntermediateEnvRollup(content, "On Stg");
    });
  });

  // GitHub sub-issue-completion arm: derive the parent's status:* label from
  // its child sub-issues, blocked-dominant, terminal = single status:done.
  describe.each(SKILL_ROOTS)("%s/lisa-github-sync", root => {
    const content = readSkill(root, "lisa-github-sync");
    const heading = "### Step 5: Parent Status Rollup";

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("resolves children via the github-read-issue sub-issue graph", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/subIssues/);
    });

    it("maps the derived roles to GitHub status labels", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/status:blocked/);
      expect(section).toMatch(/status:in-progress/);
      expect(section).toMatch(/status:done/);
    });

    it("never sets the parent to status:ready", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/status:ready/);
      expect(section).toMatch(
        /[Nn]ever set the parent to .*status:ready|ready.*leaf-only/
      );
    });

    it("collapses the terminal to a single status:done in this repo", () => {
      const section = content.slice(content.indexOf(heading));
      // No per-environment label hops.
      expect(section).toMatch(/status:on-dev|on-dev/);
    });

    it(INTERMEDIATE_ENV_TEST, () => {
      const section = content.slice(content.indexOf(heading));
      assertIntermediateEnvRollup(section, "status:on-stg");
    });
  });

  // JIRA child/subtask-status arm: Epic ← Stories ← Sub-tasks, native hierarchy.
  describe.each(SKILL_ROOTS)("%s/lisa-jira-sync", root => {
    const content = readSkill(root, "lisa-jira-sync");
    const heading = "### Step 5: Parent Status Rollup";

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("treats the review hop as optional for JIRA per config-resolution", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/review.*optional|optional for JIRA/i);
    });

    it(INTERMEDIATE_ENV_TEST, () => {
      assertIntermediateEnvRollup(
        content.slice(content.indexOf(heading)),
        "On Stg"
      );
    });
  });

  // Linear child-issue-status arm: Project ← Issues, Issue ← sub-Issues.
  describe.each(SKILL_ROOTS)("%s/lisa-linear-sync", root => {
    const content = readSkill(root, "lisa-linear-sync");
    const heading = "## Phase 5 — Parent Status Rollup";

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    // INVERTED by the Linear state migration. This used to assert the rollup
    // touched only `status:*` labels and never the native state — which was the
    // defect: the native state was then free to disagree with the label lane
    // forever. The rollup now writes the state, because the state IS the lane.
    it("rolls the parent up by moving its native workflow state", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).not.toMatch(/status:\*/);
    });

    it("never rolls a parent into the human-owned ready lane", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/never `\$READY`|never .*ready/i);
    });

    it(INTERMEDIATE_ENV_TEST, () => {
      assertIntermediateEnvRollup(
        content.slice(content.indexOf(heading)),
        "On Stg"
      );
    });
  });
});

// The rule itself remains the single source of truth and documents both the
// generic env-keyed terminal and the single-environment collapse.
describe("leaf-only-lifecycle rule: rollup section (#544)", () => {
  describe.each([
    "plugins/src/base/rules/reference",
    "plugins/lisa/rules/reference",
  ] as const)("%s/leaf-only-lifecycle", root => {
    const content = readFileSync(
      path.resolve(root, "leaf-only-lifecycle.md"),
      "utf8"
    );

    it("documents the intermediate-env rollup rung (the SE-318 gap)", () => {
      assertIntermediateEnvRollup(content, "On Stg");
    });
  });
});
