/**
 * The second round of CodeRabbit findings on the stale-link sweep
 * (CodySwannGT/lisa#5065): each done rung resolves local, then committed,
 * then built-in, so a local `dev`-only override never makes `dev` terminal;
 * a Jira or Linear item whose own status was not read is left alone; and an
 * item whose removals keep failing goes after every other candidate, so it
 * cannot spend the per-cycle cap every cycle.
 * @module tests/unit/strategies/stale-blocker-cycles
 */
import { describe, expect, it } from "vitest";

import { confirmStaleLinkPlan } from "../../../plugins/src/base/scripts/stale-blocker-confirm.mjs";
import { terminalDoneRoles } from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";
import { recordRemovalResult } from "../../../plugins/src/base/scripts/stale-blocker-pending.mjs";
import {
  planStaleLinkSweep,
  summarizeStaleLinkSweep,
} from "../../../plugins/src/base/scripts/stale-blocker-sweep.mjs";
import {
  DONE,
  JIRA_ROLES,
  jiraIssue,
  jiraLink,
} from "./stale-blocker-fixtures.js";

const NOW = "2026-11-19T12:00:00Z";
const LATER = "2026-11-19T12:05:00Z";

describe("terminalDoneRoles merges each rung across configs", () => {
  const committed = {
    github: {
      labels: {
        build: { done: { dev: "stage:dev", production: "stage:live" } },
      },
    },
  };

  it("keeps the committed production rung when local overrides only dev", () => {
    expect(
      terminalDoneRoles({
        tracker: "github",
        global: committed,
        local: { github: { labels: { build: { done: { dev: "stage:x" } } } } },
      })
    ).toEqual(["stage:live"]);
  });

  it("falls back to the built-in production rung, never a local dev one", () => {
    expect(
      terminalDoneRoles({
        tracker: "jira",
        local: { jira: { workflow: { done: { dev: "On Dev" } } } },
      })
    ).toEqual(["done"]);
  });

  it("still lets a local string or production rung win", () => {
    expect(
      terminalDoneRoles({
        tracker: "github",
        global: committed,
        local: { github: { labels: { build: { done: "shipped" } } } },
      })
    ).toEqual(["shipped"]);
    expect(
      terminalDoneRoles({
        tracker: "github",
        global: committed,
        local: {
          github: { labels: { build: { done: { production: "gone" } } } },
        },
      })
    ).toEqual(["gone"]);
  });
});

describe("an item whose own status was not read", () => {
  const link = [jiraLink("1", "ABC-9", DONE)];
  const noStatus = {
    key: "ABC-1",
    fields: { issuelinks: link },
    comments: [],
  };
  const linearNoState = {
    identifier: "DEMO-1",
    team: { key: "DEMO" },
    inverseRelations: {
      nodes: [
        {
          id: "rel-1",
          type: "blocks",
          issue: {
            identifier: "DEMO-9",
            state: { name: "Done", type: "completed" },
            team: { key: "DEMO" },
          },
        },
      ],
    },
    comments: [],
  };

  it.each([
    ["jira", noStatus, "ABC-1"],
    ["linear", linearNoState, "DEMO-1"],
  ] as const)("plans no removal on %s and reports it", (tracker, raw, ref) => {
    const result = planStaleLinkSweep({
      tracker,
      items: [raw],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    });
    expect(result.plans).toEqual([]);
    expect(result.report.unknownStatus).toEqual([ref]);
    expect(summarizeStaleLinkSweep(result.report)).toContain(
      `left ${ref} alone because its status could not be read`
    );
  });

  it("is skipped at confirm time when the fresh read has no status", () => {
    const planned = planStaleLinkSweep({
      tracker: "jira",
      items: [jiraIssue("ABC-1", link)],
      doneRoles: ["done"],
      roles: JIRA_ROLES,
    }).plans[0];
    if (!planned) throw new Error("expected a plan entry");
    expect(
      confirmStaleLinkPlan({
        tracker: "jira",
        plan: planned,
        fresh: noStatus,
        doneRoles: ["done"],
        roles: JIRA_ROLES,
      })
    ).toEqual({
      plan: null,
      skipped: [{ blocker: "ABC-9", reason: "status-unknown" }],
    });
  });
});

describe("items whose removals keep failing", () => {
  const items = ["ABC-1", "ABC-2", "ABC-3"].map(key =>
    jiraIssue(key, [jiraLink("1", `${key}9`, DONE)])
  );
  const plan = (failures?: Record<string, { attempts: number }>) =>
    planStaleLinkSweep({
      tracker: "jira",
      items,
      doneRoles: ["done"],
      roles: JIRA_ROLES,
      max: 1,
      ...(failures === undefined ? {} : { failures }),
    });

  it("go after every other candidate, so the cap reaches later items", () => {
    expect(plan().plans.map(entry => entry.ref)).toEqual(["ABC-1"]);
    const failures = {
      "ABC-1": { attempts: 2 },
      "ABC-2": { attempts: 1 },
    };
    const next = plan(failures);
    expect(next.plans.map(entry => entry.ref)).toEqual(["ABC-3"]);
    expect(next.deferred).toEqual(["ABC-2", "ABC-1"]);
  });

  it("are recorded per failure and cleared by a removal that succeeds", () => {
    const failing = { ref: "ABC-1", stillPresent: ["ABC-19"] };
    const once = recordRemovalResult({}, failing, NOW);
    const twice = recordRemovalResult(once, failing, LATER);
    expect(twice).toEqual({
      "ABC-1": { attempts: 2, since: NOW, stillPresent: ["ABC-19"] },
    });
    expect(
      recordRemovalResult(twice, { ref: "ABC-1", stillPresent: [] }, LATER)
    ).toEqual({});
    expect(
      recordRemovalResult(undefined, { ref: "ABC-2", stillPresent: [] }, NOW)
    ).toEqual({});
  });
});
