/**
 * Contract tests for the Linear build lane living on native workflow STATES
 * (`linear.workflow`) rather than labels (`linear.labels.build.*`).
 *
 * WHY THIS FILE EXISTS
 *
 * Linear Issues carry first-class workflow states with a machine-readable
 * `type` — the same shape JIRA statuses have. GitHub Issues does not, which is
 * why the GitHub adapter must use labels. The Linear adapter was originally
 * built by copying the GitHub one (it literally reused `BUILD_LABEL_DEFAULTS`),
 * which left TWO writers on one lifecycle: Linear's own git automations move
 * `state` on merge while Lisa moved only labels. The two then disagreed
 * permanently on any merge that did not run through a Lisa flow.
 *
 * These assertions are the structural guard against that regression. The
 * failure mode they catch is silent — a config key quietly re-growing a build
 * lane under `linear.labels` reads as ordinary configuration, and nothing else
 * in the build would notice.
 */

import { describe, expect, it } from "vitest";

import { SYNC_REGISTRY } from "../../../src/sync/registry";

const LINEAR_WORKFLOW = "linear.workflow";
const JIRA_WORKFLOW = "jira.workflow";
const LINEAR_LABELS = "linear.labels";
const GITHUB_LABELS = "github.labels";
const byName = (a: string, b: string) => a.localeCompare(b);

const entry = (key: string) => {
  const found = SYNC_REGISTRY.find(s => s.key === key);
  if (!found) throw new Error(`registry key not found: ${key}`);
  return found;
};

/**
 * The REQUIRED roles. `review` is deliberately not here: it is optional, and a
 * `defaultValue` in this registry is materialized into a project's
 * `.lisa.config.json` by `lisa sync`, so seeding `review` would hand every
 * project a review hop it never configured — and make "unset" indistinguishable
 * from "not customized", which is the one thing an optional role must express.
 */
const BUILD_ROLES = ["ready", "claimed", "blocked", "done"] as const;

describe("linear.workflow — the build lane is native states", () => {
  it("is registered and relevant when the tracker is Linear", () => {
    expect(entry(LINEAR_WORKFLOW).relevantWhen).toContain("tracker=linear");
  });

  it("maps every build role to a state name, mirroring jira.workflow", () => {
    const linear = entry(LINEAR_WORKFLOW).defaultValue as Record<
      string,
      unknown
    >;
    const jira = entry(JIRA_WORKFLOW).defaultValue as Record<string, unknown>;

    // Same role vocabulary as JIRA — that parity IS the point of the migration.
    expect(Object.keys(linear).sort(byName)).toEqual(
      Object.keys(jira).sort(byName)
    );
    for (const role of BUILD_ROLES) expect(linear[role]).toBeDefined();
  });

  it("seeds no OPTIONAL role on either status tracker", () => {
    // A default here is written into a downstream config by `lisa sync`, so an
    // optional role with a default is an opt-out nobody can take.
    expect(entry(LINEAR_WORKFLOW).defaultValue).not.toHaveProperty("review");
    expect(entry(JIRA_WORKFLOW).defaultValue).not.toHaveProperty("review");
  });

  it("keys `done` by environment, like JIRA", () => {
    const done = (entry(LINEAR_WORKFLOW).defaultValue as Record<string, any>)
      .done;
    expect(Object.keys(done).sort(byName)).toEqual([
      "dev",
      "production",
      "staging",
    ]);
  });

  it("names no state that looks like a lifecycle label", () => {
    // A `status:`-prefixed value here means someone pasted the GitHub lane back
    // in. Workflow state names are human board columns, never namespaced keys.
    const flat = JSON.stringify(entry(LINEAR_WORKFLOW).defaultValue);
    expect(flat).not.toMatch(/status:/);
  });
});

describe("linear.labels — markers and the PRD lane only", () => {
  it("carries no build lifecycle roles", () => {
    const labels = entry(LINEAR_LABELS).defaultValue as Record<string, any>;
    for (const role of BUILD_ROLES) {
      expect(labels.build?.[role]).toBeUndefined();
    }
  });

  it("keeps human_needed as a LABEL", () => {
    // An Issue holds exactly one state but any number of labels, so an
    // additive marker cannot be a state — same reasoning as jira.labels.
    const labels = entry(LINEAR_LABELS).defaultValue as Record<string, any>;
    expect(labels.build?.human_needed).toBe("human-needed");
  });

  it("keeps the whole PRD lane as labels", () => {
    // PRDs are Linear PROJECTS, whose status model is a separate object from
    // Issue workflow states — so this lane legitimately stays label-driven.
    const labels = entry(LINEAR_LABELS).defaultValue as Record<string, any>;
    const github = entry(GITHUB_LABELS).defaultValue as Record<string, any>;
    expect(labels.prd).toEqual(github.prd);
  });

  it("no longer shares the GitHub build-label defaults", () => {
    // The precise regression: `linear.labels.build` was `{...BUILD_LABEL_DEFAULTS}`.
    const linear = entry(LINEAR_LABELS).defaultValue as Record<string, any>;
    const github = entry(GITHUB_LABELS).defaultValue as Record<string, any>;
    expect(linear.build).not.toEqual(github.build);
  });
});

describe("`ready` must be a DEDICATED state, never the tracker default", () => {
  // The first cut mapped `ready` to "Todo" — which is where Linear puts a
  // BRAND-NEW issue. That inverted the gate: the lane stopped meaning "a human
  // flipped this to build-ready" and started meaning "nobody has touched this",
  // so every untouched backlog item read as claimable. Measured on the first
  // team migrated: 20 issues in the lane, only 8 ever explicitly marked ready.
  //
  // JIRA never had the bug because `jira.workflow.ready` is a dedicated `Ready`
  // status while a fresh ticket lands in the project default. These pin the
  // parallel so a future "simplification" back to the default fails here.

  const LINEAR_DEFAULT_STATES = ["Todo", "Backlog", "Triage"];

  it("does not use a stock Linear default state for `ready`", () => {
    const ready = (
      entry(LINEAR_WORKFLOW).defaultValue as Record<string, unknown>
    ).ready;

    expect(LINEAR_DEFAULT_STATES).not.toContain(ready);
  });

  it("uses the same role name JIRA does", () => {
    const linear = entry(LINEAR_WORKFLOW).defaultValue as Record<
      string,
      unknown
    >;
    const jira = entry(JIRA_WORKFLOW).defaultValue as Record<string, unknown>;

    expect(linear.ready).toBe(jira.ready);
  });

  it("keeps `ready` distinct from every other role", () => {
    // A `ready` that collides with `claimed` or a `done` rung would make the
    // queue re-claim its own output.
    const linear = entry(LINEAR_WORKFLOW).defaultValue as Record<string, any>;
    const others = [
      linear.claimed,
      linear.review,
      linear.blocked,
      ...Object.values(linear.done),
    ];

    expect(others).not.toContain(linear.ready);
  });
});
