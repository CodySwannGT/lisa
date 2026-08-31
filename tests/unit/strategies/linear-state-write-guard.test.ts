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
 * These tests drive the guard onto every refusal path and onto the allow path,
 * and prove the refusal happens BEFORE transport by running a fake request sink
 * that records every outgoing mutation. A guard that refuses after the mutation
 * left is not a guard.
 * @module tests/unit/strategies/linear-state-write-guard
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import {
  REFUSALS,
  envIndexedDoneKeys,
  normalizeStateCatalog,
  resolveStateWriteTarget,
} from "../../../plugins/src/base/scripts/linear-state-write-target.mjs";

/** The guard under test, at its authored source path. */
const GUARD = join(
  process.cwd(),
  "plugins/src/base/scripts/linear-state-write-target.mjs"
);

/** Linear's own machine-readable state type for an in-flight lane. */
const STARTED = "started";

/** The configured `claimed` state name, and the id it must resolve to. */
const CLAIMED_NAME = "In Progress";
const CLAIMED_ID = "st-claimed";

/** A review-shaped lane the configuration deliberately never names. */
const UNCONFIGURED_REVIEW_ID = "st-human-review";

/**
 * A board shaped like the one the occurrence was observed on: a claimed lane, a
 * blocked lane, and two review-shaped lanes the config deliberately omits.
 * Every identifier here is invented.
 */
const TEAM_STATES = [
  { id: "st-backlog", name: "Triage", type: "backlog", position: -2400 },
  { id: "st-ready", name: "Ready", type: "unstarted", position: -2100 },
  { id: "st-blocked", name: "Blocked", type: STARTED, position: -1989.26 },
  { id: CLAIMED_ID, name: CLAIMED_NAME, type: STARTED, position: -1478.5 },
  {
    id: UNCONFIGURED_REVIEW_ID,
    name: "Awaiting Code Review",
    type: STARTED,
    position: -1209.69,
  },
  { id: "st-human-qa", name: "Peer Check", type: STARTED, position: -1079.7 },
  { id: "st-done", name: "Done", type: "completed", position: 900 },
];

/** A project that binds every required role and deliberately binds no `review`. */
const CONFIG = {
  linear: {
    workspace: "example-workspace",
    teamKey: "EXM",
    workflow: {
      ready: "Ready",
      claimed: CLAIMED_NAME,
      blocked: "Blocked",
      done: { dev: "On Dev", staging: "On Stg", production: "Done" },
    },
  },
};

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

describe("the CLI answers a bare state write with the refusal, not usage", () => {
  /**
   * Run the guard CLI and capture its exit status and stderr.
   *
   * @param {readonly string[]} argv arguments after the script path
   * @returns {{status: number, stderr: string}} observed outcome
   */
  const runCli = (argv: readonly string[]) => {
    const outcome = boundedSpawnSync({
      command: process.execPath,
      args: [GUARD, ...argv],
      label: "linear-state-write-target CLI",
    });

    return { status: outcome.status ?? 1, stderr: outcome.stderr ?? "" };
  };

  it("refuses a --state-id with no --role instead of printing usage", () => {
    const observed = runCli(["--state-id", UNCONFIGURED_REVIEW_ID]);

    expect(observed.status).toBe(2);
    expect(observed.stderr).toContain(REFUSALS.MISSING_ROLE);
    expect(observed.stderr).not.toContain("usage:");
  });

  it("still prints usage when invoked with nothing to judge", () => {
    const observed = runCli([]);

    expect(observed.status).toBe(2);
    expect(observed.stderr).toContain("usage:");
  });
});

describe("the refusal happens before transport", () => {
  let dir = "";
  let dispatch = "";

  /**
   * Stand in for the access layer: resolve the target, and only then dispatch.
   *
   * Written as a separate process, invoked the way the skill invokes it, so the
   * ordering being asserted is the real one rather than one the test arranged.
   */
  const HARNESS = `
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [guard, config, states, sink, role, env, assertId] = process.argv.slice(2);
let stateId;
try {
  stateId = execFileSync(process.execPath, [
    guard,
    "--role", role,
    "--states", states,
    "--config", config,
    "--local", "/nonexistent/.lisa.config.local.json",
    ...(env ? ["--env", env] : []),
    ...(assertId ? ["--state-id", assertId] : []),
  ], { encoding: "utf8" }).trim();
} catch (error) {
  process.stderr.write(String(error.stderr ?? error.message));
  process.exit(2);
}
appendFileSync(sink, JSON.stringify({ mutation: "issueUpdate", stateId }) + "\\n");
`;

  /**
   * Run the harness and report what the sink recorded.
   *
   * @param {string[]} argv role, env, asserted id
   * @returns {{status: number, mutations: string[]}} observed outcome
   */
  const run = (argv: readonly string[]) => {
    // A fresh sink per case rather than a truncated shared one: an absent file
    // and an empty file both mean "nothing was dispatched", and neither can be
    // confused with a leftover line from the case before.
    const sink = join(dir, `requests-${argv.join("~")}.jsonl`);
    const outcome = boundedSpawnSync({
      command: process.execPath,
      args: [
        dispatch,
        GUARD,
        join(dir, "config.json"),
        join(dir, "states.json"),
        sink,
        ...argv,
      ],
      label: "fake Linear access layer",
    });
    const recorded = existsSync(sink) ? readFileSync(sink, "utf8") : "";

    return {
      status: outcome.status ?? 1,
      mutations: recorded.split("\n").filter(Boolean),
    };
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lisa-linear-state-"));
    dispatch = join(dir, "fake-access-layer.mjs");
    writeFileSync(join(dir, "config.json"), JSON.stringify(CONFIG));
    writeFileSync(join(dir, "states.json"), JSON.stringify(TEAM_STATES));
    writeFileSync(dispatch, HARNESS);
  });

  afterAll(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("records ZERO mutations and exits nonzero on a mismatched target", () => {
    const observed = run(["claimed", "", UNCONFIGURED_REVIEW_ID]);

    expect(observed.status).not.toBe(0);
    expect(observed.mutations).toEqual([]);
  });

  it("records ZERO mutations for an unbound `review` role", () => {
    const observed = run(["review", "", ""]);

    expect(observed.status).not.toBe(0);
    expect(observed.mutations).toEqual([]);
  });

  it("dispatches exactly one mutation for the exact configured target", () => {
    const observed = run(["claimed", "", CLAIMED_ID]);

    expect(observed.status).toBe(0);
    expect(observed.mutations).toHaveLength(1);
    expect(JSON.parse(observed.mutations[0])).toEqual({
      mutation: "issueUpdate",
      stateId: CLAIMED_ID,
    });
  });

  it("dispatches the resolved id when the caller asserts none", () => {
    const observed = run(["done", "production", ""]);

    expect(observed.status).toBe(0);
    expect(JSON.parse(observed.mutations[0]).stateId).toBe("st-done");
  });
});
