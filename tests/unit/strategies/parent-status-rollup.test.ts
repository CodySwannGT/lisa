/**
 * Regression tests for the parent status rollup state machine across the
 * vendor status-transition (sync) surfaces.
 *
 * Issue #544: implement the **Parent status rollup (the state machine)** arm of
 * the vendor-neutral `leaf-only-lifecycle` rule (merged in #537) across the
 * surfaces that own status transitions — `lisa:github-sync` (GitHub sub-issue
 * completion), `lisa:jira-sync` (JIRA child/subtask status), `lisa:linear-sync`
 * (Linear child-issue status) — plus the vendor-neutral `lisa:tracker-sync`
 * dispatcher that documents the contract once. A parent/container derives its
 * lifecycle state from its children: any leaf blocked → parent blocked; any leaf
 * in progress → parent active; all required leaves terminal → parent rolls up to
 * the configured terminal `done`. Blocked dominates; the parent never carries
 * `ready`.
 *
 * Single-environment collapse (this repo): `.lisa.config.json` `deploy.branches`
 * declares only `production: main`, so the env-keyed `done` collapses to one
 * `done` value and the lifecycle is `ready → in-progress → code-review → done`
 * with no dev/staging promotion hops. The rule and skills stay multi-env
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
/** The rule section the rollup paths implement. */
const STATE_MACHINE = "Parent status rollup (the state machine)";
/** Shared test name reused for every skill that cites the rule by slug. */
const CITES_SLUG = "cites the leaf-only-lifecycle rule by slug";
/** Shared test name reused for every skill asserting the single-env collapse. */
const COLLAPSE_TEST =
  "documents the single-environment collapse and stays multi-env capable";
/** Shared test name reused for every skill asserting the state machine. */
const STATE_MACHINE_TEST =
  "encodes the blocked-dominant priority state machine";

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

/**
 * Assert a skill section documents the single-environment collapse while
 * staying multi-environment capable.
 * @param content - SKILL.md text (or the relevant rollup section) to assert.
 */
const assertSingleEnvCollapse = (content: string): void => {
  // Documents the collapse explicitly.
  expect(content).toMatch(/[Ss]ingle-environment collapse/);
  expect(content).toMatch(/production: main/);
  // Never assumes a dev → staging → prod promotion chain for the rollup.
  expect(content).toMatch(
    /no.*dev.*staging.*promotion|dev\/staging promotion/i
  );
  // Stays multi-env capable — env-keyed done logic is preserved.
  expect(content).toMatch(/env-keyed `done`|multi-environment|multi-env/i);
  // Never resolves a dev/staging done in this single-env repo.
  expect(content).toMatch(/never.*resolve.*dev|never resolves a dev/i);
};

/**
 * Assert a skill section encodes the four-row priority state machine
 * (blocked → claimed → done → unchanged).
 * @param section - The rollup section text to assert.
 */
const assertStateMachine = (section: string): void => {
  // Blocked dominates.
  expect(section).toMatch(/blocked/i);
  expect(section).toMatch(/[Bb]locked dominates/);
  // In-progress (claimed or in review) → active.
  expect(section).toMatch(/in progress|in-progress/i);
  // All required leaves terminal → done.
  expect(section).toMatch(/all.*required.*terminal|all.*required.*done/i);
  expect(section).toMatch(/terminal/i);
  // Required-only qualifier.
  expect(section).toMatch(/[Rr]equired/);
  // Recursive evaluation bottom-up.
  expect(section).toMatch(/[Rr]ecursive/);
  expect(section).toMatch(/bottom-up/i);
  // The parent never carries the build-ready role.
  expect(section).toMatch(/never set the parent to.*ready|never.*ready/i);
};

describe("parent status rollup (#544)", () => {
  // The vendor-neutral dispatcher documents the rollup contract once and
  // forwards the --rollup flag to the resolved vendor sync skill.
  describe.each(SKILL_ROOTS)("%s/tracker-sync", root => {
    const content = readSkill(root, "tracker-sync");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("names the rollup state-machine section of the rule", () => {
      expect(content).toContain(STATE_MACHINE);
    });

    it("forwards the --rollup flag to the vendor sync skill", () => {
      expect(content).toMatch(/--rollup/);
    });

    it("documents the four-row priority state machine", () => {
      assertStateMachine(content);
    });

    it(COLLAPSE_TEST, () => {
      assertSingleEnvCollapse(content);
    });

    it("requires a safe (no-op suggestion) default, never an unsafe guess", () => {
      expect(content).toMatch(/[Ss]afe|no-op/);
      expect(content).toMatch(/never.*unsafe|unsafe default/i);
    });
  });

  // GitHub sub-issue-completion arm: derive the parent's status:* label from
  // its child sub-issues, blocked-dominant, terminal = single status:done.
  describe.each(SKILL_ROOTS)("%s/github-sync", root => {
    const content = readSkill(root, "github-sync");
    const heading = "### Step 5: Parent Status Rollup";

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("defines a parent status rollup step gated on --rollup", () => {
      expect(content).toContain(heading);
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/--rollup/);
    });

    it("resolves children via the github-read-issue sub-issue graph", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/github-read-issue/);
      expect(section).toMatch(/subIssues/);
    });

    it(STATE_MACHINE_TEST, () => {
      assertStateMachine(content.slice(content.indexOf(heading)));
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
      assertSingleEnvCollapse(section);
      // No per-environment label hops.
      expect(section).toMatch(/status:on-dev|on-dev/);
    });
  });

  // JIRA child/subtask-status arm: Epic ← Stories ← Sub-tasks, native hierarchy.
  describe.each(SKILL_ROOTS)("%s/jira-sync", root => {
    const content = readSkill(root, "jira-sync");
    const heading = "### Step 5: Parent Status Rollup";

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("defines a parent status rollup step gated on --rollup", () => {
      expect(content).toContain(heading);
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/--rollup/);
    });

    it("resolves children via the jira-read-ticket Epic/Story/Sub-task hierarchy", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/jira-read-ticket/);
      expect(section).toMatch(/Epic/);
      expect(section).toMatch(/Sub-task/);
    });

    it(STATE_MACHINE_TEST, () => {
      assertStateMachine(content.slice(content.indexOf(heading)));
    });

    it("treats the review hop as optional for JIRA per config-resolution", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/review.*optional|optional for JIRA/i);
    });

    it(COLLAPSE_TEST, () => {
      assertSingleEnvCollapse(content.slice(content.indexOf(heading)));
    });
  });

  // Linear child-issue-status arm: Project ← Issues, Issue ← sub-Issues.
  describe.each(SKILL_ROOTS)("%s/linear-sync", root => {
    const content = readSkill(root, "linear-sync");
    const heading = "## Phase 5 — Parent Status Rollup";

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("defines a parent status rollup phase gated on --rollup", () => {
      expect(content).toContain(heading);
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/--rollup/);
    });

    it("resolves children via the linear-read-issue Project/sub-Issue hierarchy", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/linear-read-issue/);
      expect(section).toMatch(/Project/);
      expect(section).toMatch(/sub-Issue/i);
    });

    it(STATE_MACHINE_TEST, () => {
      assertStateMachine(content.slice(content.indexOf(heading)));
    });

    it("updates only the status:* label, never the native Linear state", () => {
      const section = content.slice(content.indexOf(heading));
      expect(section).toMatch(/status:\*/);
      expect(section).toMatch(/not.*auto-transition|native Linear `state`/i);
    });

    it(COLLAPSE_TEST, () => {
      assertSingleEnvCollapse(content.slice(content.indexOf(heading)));
    });
  });
});

// The rule itself remains the single source of truth and documents both the
// generic env-keyed terminal and the single-environment collapse.
describe("leaf-only-lifecycle rule: rollup section (#544)", () => {
  describe.each(["plugins/src/base/rules", "plugins/lisa/rules"] as const)(
    "%s/leaf-only-lifecycle",
    root => {
      const content = readFileSync(
        path.resolve(root, "leaf-only-lifecycle.md"),
        "utf8"
      );

      it("defines the parent status rollup state machine", () => {
        expect(content).toContain(STATE_MACHINE);
      });

      it("documents the env-keyed terminal AND the single-environment collapse", () => {
        expect(content).toMatch(/env-keyed/i);
        expect(content).toMatch(/[Ss]ingle-environment collapse/);
        expect(content).toMatch(/ready.*claimed.*review.*done|ready → claimed/);
      });

      it("states blocked dominates and the parent never carries ready", () => {
        expect(content).toMatch(/[Bb]locked dominates/);
        expect(content).toMatch(/parent never carries.*ready/i);
      });
    }
  );
});
