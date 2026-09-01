/**
 * The Linear state-write guard refuses BEFORE transport (#3356).
 *
 * The other half of the guard's coverage — its sibling file drives the
 * resolution and refusal paths in-process. This one answers the question a
 * unit test cannot: does the refusal land before anything leaves? It runs a
 * stand-in access layer as a separate process against a fake request sink that
 * records every outgoing mutation, so "zero mutations" is an observation rather
 * than an inference. A guard that refuses after the mutation left is not a
 * guard.
 * @module tests/unit/strategies/linear-state-write-sink
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
import { REFUSALS } from "../../../plugins/src/base/scripts/linear-state-write-target.mjs";

import {
  CLAIMED_ID,
  CONFIG,
  GUARD,
  TEAM_STATES,
  UNCONFIGURED_REVIEW_ID,
} from "./linear-state-write-fixtures.js";

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
