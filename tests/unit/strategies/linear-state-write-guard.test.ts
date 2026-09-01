/**
 * Access-bound guard for Linear workflow-state writes (CodySwannGT/lisa#3356).
 *
 * The defect: `lisa-linear-access operation: save-issue` took a raw `stateId`
 * and dispatched it. The chokepoint had no idea which lifecycle role the caller
 * believed it was applying, so it had no possible refusal — the config-bound
 * resolver shipped in #3288 could be walked straight past. A caller repo in the
 * portfolio watched an issue leave its ready lane for a review-shaped state its
 * `linear.workflow` map deliberately does not name.
 *
 * These tests drive the guard onto every refusal path and onto the allow path.
 * The companion `linear-state-write-sink` suite proves the refusal lands BEFORE
 * transport, against a fake request sink that records every outgoing mutation —
 * a guard that refuses after the mutation left is not a guard.
 * @module tests/unit/strategies/linear-state-write-guard
 */
import { describe, expect, it } from "vitest";

import {
  REFUSALS,
  envIndexedDoneKeys,
  normalizeStateCatalog,
  resolveStateWriteTarget,
} from "../../../plugins/src/base/scripts/linear-state-write-target.mjs";

import {
  CLAIMED_ID,
  CLAIMED_NAME,
  CONFIG,
  STARTED,
  TEAM_STATES,
  UNCONFIGURED_REVIEW_ID,
} from "./linear-state-write-fixtures.js";

/** No local override in these cases; the committed config is the whole truth. */
const NO_LOCAL = undefined;

describe("the guard resolves a target instead of approving one", () => {
  it("returns the configured state for the role, not the state asked for", () => {
    const result = resolveStateWriteTarget({
      role: "claimed",
      states: TEAM_STATES,
      global: CONFIG,
      local: NO_LOCAL,
    });

    expect(result).toMatchObject({
      ok: true,
      role: "claimed",
      stateId: CLAIMED_ID,
      stateName: CLAIMED_NAME,
    });
  });

  it("resolves an env-indexed `done` rung from the environment key", () => {
    const result = resolveStateWriteTarget({
      role: "done",
      env: "production",
      states: TEAM_STATES,
      global: CONFIG,
    });

    expect(result).toMatchObject({ ok: true, stateId: "st-done" });
  });
});

describe("it refuses every write that is not the configured target", () => {
  it("refuses a mismatched target and names the role and configured value", () => {
    const result = resolveStateWriteTarget({
      role: "claimed",
      states: TEAM_STATES,
      global: CONFIG,
      assertStateId: UNCONFIGURED_REVIEW_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.refusal).toBe(REFUSALS.TARGET_MISMATCH);
    expect(result.message).toContain("'claimed'");
    expect(result.message).toContain(CLAIMED_NAME);
    expect(result.message).toContain(UNCONFIGURED_REVIEW_ID);
  });

  it("refuses a state write that declares no lifecycle role at all", () => {
    const result = resolveStateWriteTarget({
      states: TEAM_STATES,
      global: CONFIG,
      assertStateId: UNCONFIGURED_REVIEW_ID,
    });

    expect(result.refusal).toBe(REFUSALS.MISSING_ROLE);
  });

  it("refuses an unbound optional role rather than defaulting it", () => {
    const result = resolveStateWriteTarget({
      role: "review",
      states: TEAM_STATES,
      global: CONFIG,
    });

    expect(result.refusal).toBe(REFUSALS.ROLE_UNCONFIGURED);
    expect(result.message).toContain("linear.workflow.review");
  });

  it("refuses a required role the project never bound", () => {
    const result = resolveStateWriteTarget({
      role: "claimed",
      states: TEAM_STATES,
      global: { linear: { workflow: { ready: "Ready" } } },
    });

    expect(result.refusal).toBe(REFUSALS.ROLE_UNCONFIGURED);
  });

  it("refuses a bare `done` when the project indexes `done` by environment", () => {
    const result = resolveStateWriteTarget({
      role: "done",
      states: TEAM_STATES,
      global: CONFIG,
    });

    expect(result.refusal).toBe(REFUSALS.MISSING_ENV);
    expect(result.message).toContain("production");
  });

  it("refuses an environment key on a role that is not `done`", () => {
    const result = resolveStateWriteTarget({
      role: "claimed",
      env: "production",
      states: TEAM_STATES,
      global: CONFIG,
    });

    expect(result.refusal).toBe(REFUSALS.UNEXPECTED_ENV);
    expect(result.message).toContain("'claimed'");
  });

  it("refuses an environment key when `done` is a single state", () => {
    const result = resolveStateWriteTarget({
      role: "done",
      env: "production",
      states: TEAM_STATES,
      global: { linear: { workflow: { done: "Done" } } },
    });

    expect(result.refusal).toBe(REFUSALS.UNEXPECTED_ENV);
    expect(result.message).toContain("single state");
  });

  it("resolves a flat `done` with no environment key at all", () => {
    const result = resolveStateWriteTarget({
      role: "done",
      states: TEAM_STATES,
      global: { linear: { workflow: { done: "Done" } } },
    });

    expect(result).toMatchObject({ ok: true, stateId: "st-done" });
  });

  it("refuses when the configured name matches no state on the team", () => {
    const result = resolveStateWriteTarget({
      role: "claimed",
      states: TEAM_STATES,
      global: { linear: { workflow: { claimed: "Underway" } } },
    });

    expect(result.refusal).toBe(REFUSALS.STATE_ABSENT);
    expect(result.message).toContain("Underway");
  });

  it("refuses an ambiguous configured name instead of picking the first", () => {
    const result = resolveStateWriteTarget({
      role: "claimed",
      states: [
        ...TEAM_STATES,
        { id: "st-claimed-dup", name: CLAIMED_NAME, type: STARTED },
      ],
      global: CONFIG,
    });

    expect(result.refusal).toBe(REFUSALS.STATE_AMBIGUOUS);
    expect(result.message).toContain("st-claimed-dup");
  });

  it("refuses a malformed catalog rather than treating it as empty", () => {
    expect(
      resolveStateWriteTarget({ role: "claimed", states: {}, global: CONFIG })
        .refusal
    ).toBe(REFUSALS.CATALOG_MALFORMED);
    expect(
      resolveStateWriteTarget({
        role: "claimed",
        states: [{ name: CLAIMED_NAME }],
        global: CONFIG,
      }).refusal
    ).toBe(REFUSALS.CATALOG_MALFORMED);
  });
});

describe("catalog and env-map helpers", () => {
  it("accepts the flat list, the connection, and the raw team envelope", () => {
    const expected = { nodes: TEAM_STATES };

    expect(normalizeStateCatalog(TEAM_STATES)).toEqual(expected);
    expect(normalizeStateCatalog({ nodes: TEAM_STATES })).toEqual(expected);
    expect(
      normalizeStateCatalog({ team: { states: { nodes: TEAM_STATES } } })
    ).toEqual(expected);
  });

  it("treats a flat `done` string as needing no environment key", () => {
    expect(
      envIndexedDoneKeys(undefined, {
        linear: { workflow: { done: "Done" } },
      })
    ).toEqual([]);
    expect(envIndexedDoneKeys(undefined, CONFIG)).toEqual([
      "dev",
      "staging",
      "production",
    ]);
  });

  it("lets a local override decide whether `done` is env-indexed", () => {
    expect(
      envIndexedDoneKeys({ linear: { workflow: { done: "Shipped" } } }, CONFIG)
    ).toEqual([]);
  });
});
