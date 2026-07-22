import { describe, expect, it } from "vitest";
import type { DeployLadder } from "../../../src/core/deploy-status-sync.js";
import {
  DEPLOY_STATUS_SYNC_MARKER,
  planTransitions,
  type TrackerItemState,
  type TransitionPlanInput,
} from "../../../src/core/deploy-status-transition.js";

// Hardcoded known values — never computed from the module under test.
const EXPECTED_PLAN = "expected plan";
const SKIP_AT_OR_BEYOND = "skip-at-or-beyond";
const SKIP_CONTAINER = "skip-container";
const DEV_LABEL = "status:on-dev";
const STAGING_LABEL = "status:on-stg";
const PRODUCTION_LABEL = "status:done";

const LADDER: DeployLadder = {
  rungs: [
    { env: "dev", branch: "dev", doneStatus: DEV_LABEL },
    { env: "staging", branch: "staging", doneStatus: STAGING_LABEL },
    { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
  ],
  terminalOnly: false,
  terminalEnv: "production",
};

/**
 * Build a leaf item state with overridable fields.
 * @param overrides - Fields to override
 * @returns Item state fixture
 */
function leaf(overrides: Partial<TrackerItemState> = {}): TrackerItemState {
  return {
    ref: "acme/app#101",
    openChildren: 0,
    closed: false,
    ...overrides,
  };
}

/**
 * Build a planner input over the standard 3-env ladder.
 * @param overrides - Fields to override
 * @returns Planner input fixture
 */
function input(
  overrides: Partial<TransitionPlanInput> = {}
): TransitionPlanInput {
  return {
    ladder: LADDER,
    env: "staging",
    tracker: "github",
    branch: "staging",
    headSha: "abc1234",
    items: [leaf()],
    ...overrides,
  };
}

describe("planTransitions promotion", () => {
  it("promotes an item with no recognized status (index -1)", () => {
    const plan = planTransitions(input());
    expect(plan.kind).toBe("plan");
    if (plan.kind !== "plan") return;
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      kind: "promote",
      ref: "acme/app#101",
      doneStatus: STAGING_LABEL,
      close: false,
    });
  });

  it("promotes an item below the target rung", () => {
    const plan = planTransitions(
      input({ items: [leaf({ currentStatus: DEV_LABEL })] })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    expect(plan.actions[0]).toMatchObject({
      kind: "promote",
      doneStatus: STAGING_LABEL,
    });
  });

  it("promotes an open item whose status is outside the vocabulary", () => {
    const plan = planTransitions(
      input({ items: [leaf({ currentStatus: "status:in-progress" })] })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    expect(plan.actions[0]).toMatchObject({ kind: "promote" });
  });

  it("emits a deterministic marker-prefixed comment body with no timestamp", () => {
    const first = planTransitions(input());
    const second = planTransitions(input());
    if (first.kind !== "plan" || second.kind !== "plan")
      throw new Error(EXPECTED_PLAN);
    const firstAction = first.actions[0];
    const secondAction = second.actions[0];
    if (firstAction?.kind !== "promote" || secondAction?.kind !== "promote")
      throw new Error("expected promote");
    expect(firstAction.commentBody.startsWith(DEPLOY_STATUS_SYNC_MARKER)).toBe(
      true
    );
    expect(firstAction.commentBody).toContain(STAGING_LABEL);
    expect(firstAction.commentBody).toContain("abc1234");
    expect(firstAction.commentBody).toBe(secondAction.commentBody);
  });
});

describe("planTransitions at-or-beyond guard", () => {
  it("skips an item already at the target rung", () => {
    const plan = planTransitions(
      input({ items: [leaf({ currentStatus: STAGING_LABEL })] })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    expect(plan.actions[0]).toMatchObject({ kind: SKIP_AT_OR_BEYOND });
  });

  it("never moves an item backward from a higher rung", () => {
    const plan = planTransitions(
      input({
        env: "dev",
        branch: "dev",
        items: [leaf({ currentStatus: STAGING_LABEL })],
      })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    const action = plan.actions[0];
    expect(action).toMatchObject({ kind: SKIP_AT_OR_BEYOND });
    if (action?.kind !== SKIP_AT_OR_BEYOND) return;
    expect(action.reason).toContain(STAGING_LABEL);
  });

  it("skips a closed item with a recognized status", () => {
    const plan = planTransitions(
      input({ items: [leaf({ currentStatus: DEV_LABEL, closed: true })] })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    expect(plan.actions[0]).toMatchObject({ kind: SKIP_AT_OR_BEYOND });
  });

  it("skips a closed item at an unrecognized status, naming value and config surface", () => {
    const plan = planTransitions(
      input({ items: [leaf({ currentStatus: "Archived", closed: true })] })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    const action = plan.actions[0];
    expect(action).toMatchObject({ kind: "skip-unrecognized-status" });
    if (action?.kind !== "skip-unrecognized-status") return;
    expect(action.reason).toContain("Archived");
    expect(action.reason).toContain("github.labels.build.done");
  });
});

describe("planTransitions terminal closure", () => {
  it("closes natively only at the terminal production rung", () => {
    const plan = planTransitions(
      input({
        env: "production",
        branch: "main",
        items: [leaf({ currentStatus: STAGING_LABEL })],
      })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    expect(plan.actions[0]).toMatchObject({
      kind: "promote",
      doneStatus: PRODUCTION_LABEL,
      close: true,
    });
  });

  it("does not close when the target rung is not the universe terminal", () => {
    const skippedTerminal: DeployLadder = {
      rungs: [{ env: "dev", branch: "dev", doneStatus: DEV_LABEL }],
      terminalOnly: false,
      terminalEnv: "qa",
    };
    const plan = planTransitions(
      input({ ladder: skippedTerminal, env: "dev", branch: "dev" })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    expect(plan.actions[0]).toMatchObject({ kind: "promote", close: false });
  });

  it("closes for a genuinely terminal single-rung ladder", () => {
    const single: DeployLadder = {
      rungs: [
        { env: "production", branch: "main", doneStatus: PRODUCTION_LABEL },
      ],
      terminalOnly: true,
      terminalEnv: "production",
    };
    const plan = planTransitions(
      input({ ladder: single, env: "production", branch: "main" })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    expect(plan.actions[0]).toMatchObject({ kind: "promote", close: true });
  });
});

describe("planTransitions container skip", () => {
  it("skips an epic-typed item with a rollup comment", () => {
    const plan = planTransitions(
      input({ items: [leaf({ type: "type:Epic" })] })
    );
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    const action = plan.actions[0];
    expect(action).toMatchObject({ kind: SKIP_CONTAINER });
    if (action?.kind !== SKIP_CONTAINER) return;
    expect(action.commentBody.startsWith(DEPLOY_STATUS_SYNC_MARKER)).toBe(true);
    expect(action.commentBody).toContain("leaf-only-lifecycle");
  });

  it("skips an item with open children", () => {
    const plan = planTransitions(input({ items: [leaf({ openChildren: 2 })] }));
    if (plan.kind !== "plan") throw new Error(EXPECTED_PLAN);
    expect(plan.actions[0]).toMatchObject({ kind: SKIP_CONTAINER });
  });

  it("emits an identical rollup body across different env events", () => {
    const dev = planTransitions(
      input({ env: "dev", branch: "dev", items: [leaf({ openChildren: 1 })] })
    );
    const staging = planTransitions(
      input({ items: [leaf({ openChildren: 1 })] })
    );
    if (dev.kind !== "plan" || staging.kind !== "plan")
      throw new Error(EXPECTED_PLAN);
    const devAction = dev.actions[0];
    const stagingAction = staging.actions[0];
    if (
      devAction?.kind !== SKIP_CONTAINER ||
      stagingAction?.kind !== SKIP_CONTAINER
    )
      throw new Error("expected skip-container");
    expect(devAction.commentBody).toBe(stagingAction.commentBody);
  });
});

describe("planTransitions unconfigured env and alias", () => {
  it("produces an explanatory no-op naming the missing config key", () => {
    const plan = planTransitions(input({ env: "qa", branch: "qa" }));
    expect(plan.kind).toBe("no-op");
    if (plan.kind !== "no-op") return;
    expect(plan.reason).toContain("github.labels.build.done.qa");
    expect(plan.reason).toContain('"qa"');
  });

  it("names the jira done map for a jira tracker no-op", () => {
    const plan = planTransitions(input({ env: "qa", tracker: "jira" }));
    if (plan.kind !== "no-op") throw new Error("expected no-op");
    expect(plan.reason).toContain("jira.workflow.done.qa");
  });

  it("matches a prod rung when the requested env says production (sole alias)", () => {
    const aliased: DeployLadder = {
      rungs: [{ env: "prod", branch: "main", doneStatus: PRODUCTION_LABEL }],
      terminalOnly: true,
      terminalEnv: "prod",
    };
    const plan = planTransitions(
      input({ ladder: aliased, env: "production", branch: "main" })
    );
    expect(plan.kind).toBe("plan");
    if (plan.kind !== "plan") return;
    expect(plan.actions[0]).toMatchObject({ kind: "promote", close: true });
  });
});
