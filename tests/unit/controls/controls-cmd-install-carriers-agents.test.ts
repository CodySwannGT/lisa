/**
 * Wiring of the `--agents` flag of `lisa controls install-carriers`.
 *
 * The flag has two forms and they mean different things: on its own it reads
 * the agents from the repository, with names it takes them from the caller.
 * What each form hands the installer, what the help promises, and what a
 * person is told about an agent that cannot be carried are part of the
 * contract (CodySwannGT/lisa#4990).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONTROLS_COMMAND } from "../../../src/cli/controls-cmd.js";
import type {
  CarrierPoint,
  CarrierResult,
} from "../../../src/controls/carrier-types.js";
import {
  CARRIERS_BLOCKED_EXIT_CODE,
  INSTALL_CARRIERS_COMMAND,
  INSTALL_CARRIERS_HELP_AFTER,
  type InstallCarriersOptions,
  registerInstallCarriers,
  runInstallCarriers,
} from "../../../src/controls/commands/install-carriers.js";

const POST_TOOL = "post-tool";
const ALREADY_WIRED = "already-wired";

/** An agent point with the keys every agent point has. */
const AGENT_POINT: CarrierPoint = {
  agent: "claude",
  hook: "PostToolUse",
  kind: "agent-hook",
  location: "coding-agent",
  moment: POST_TOOL,
  outcome: ALREADY_WIRED,
  path: ".claude/settings.json",
  reason: null,
  refusal: "exit-2",
  refusal_evidence: "documented",
  wired_through: "agent-config",
};

/**
 * A result holding the given agent points and nothing else of note.
 * @param points - The agent points
 * @param outcome - The run's outcome
 * @returns The result
 */
function resultWith(
  points: readonly CarrierPoint[],
  outcome: CarrierResult["outcome"] = ALREADY_WIRED
): CarrierResult {
  return {
    changes: [],
    each_checkout: {
      check: "lisa controls install-carriers --check",
      command: "lisa controls install-carriers",
      why: "Git does not copy hook settings into a new clone.",
    },
    enforcement_points: points,
    hook_owner: "lisa",
    mode: "install",
    outcome,
    reason: "Nothing changed.",
    record: ".lisa/controls/carriers.json",
    roster: { agents: ["claude"], harness: null, source: "named" },
    runner: {
      files: [],
      outcome: ALREADY_WIRED,
      path: "scripts/lisa-run-gates.mjs",
      reason: null,
    },
    schema_version: 1,
  };
}

/**
 * Parse an argument list against a group holding only `install-carriers`.
 * @param argv - The arguments after `lisa controls`
 * @returns The options the stand-in command received
 */
async function parsed(
  argv: readonly string[]
): Promise<readonly [string | undefined, InstallCarriersOptions][]> {
  const calls: [string | undefined, InstallCarriersOptions][] = [];
  const group = new Command(CONTROLS_COMMAND);
  registerInstallCarriers(group, {
    runInstallCarriers: (targetPath, options) => {
      calls.push([targetPath, options]);
      return Promise.resolve(0);
    },
  });
  await group.parseAsync([INSTALL_CARRIERS_COMMAND, ...argv], { from: "user" });
  return calls;
}

/**
 * Run the command over a stand-in for the installer.
 * @param result - What the installer answers
 * @returns The exit code and what a person was told
 */
async function ran(
  result: CarrierResult
): Promise<{ code: number; stderr: string[] }> {
  const stderr: string[] = [];
  const code = await runInstallCarriers(
    ".",
    { agents: { from: "named", names: ["claude"] } },
    {
      install: () => Promise.resolve({ problems: null, result }),
      stderr: line => stderr.push(line),
      stdout: () => undefined,
    }
  );
  return { code, stderr };
}

describe("the --agents flag", () => {
  const previousExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it("asks for no agent when it is not given", async () => {
    expect(await parsed([])).toEqual([[undefined, { check: false }]]);
  });

  it("reads the agents from the repository when it is given on its own", async () => {
    expect(await parsed(["some/repo", "--agents"])).toEqual([
      ["some/repo", { agents: { from: "harness" }, check: false }],
    ]);
  });

  it("takes the agents named after an equals sign, trimmed", async () => {
    expect(await parsed(["--agents=claude, agy", "--check"])).toEqual([
      [
        undefined,
        { agents: { from: "named", names: ["claude", "agy"] }, check: true },
      ],
    ]);
  });

  it("takes the next word as the names when one follows it", async () => {
    expect(await parsed(["--agents", "codex"])).toEqual([
      [
        undefined,
        { agents: { from: "named", names: ["codex"] }, check: false },
      ],
    ]);
  });

  it("is explained in the help, with both forms and what each writes", () => {
    expect(INSTALL_CARRIERS_HELP_AFTER).toContain("--agents=<names>");
    expect(INSTALL_CARRIERS_HELP_AFTER).toContain('"harness" setting');
    expect(INSTALL_CARRIERS_HELP_AFTER).toContain('"unenforceable_on"');
    expect(INSTALL_CARRIERS_HELP_AFTER).toContain(
      "claude, codex, cursor, agy, copilot, opencode, devin"
    );
    expect(INSTALL_CARRIERS_HELP_AFTER).toContain("never written over it");
  });
});

describe("what a person is told about agent points", () => {
  it("passes when an agent cannot be carried, and says which and why", async () => {
    const outcome = await ran(
      resultWith([
        AGENT_POINT,
        {
          agent: "agy",
          hook: null,
          kind: "agent-hook",
          location: "coding-agent",
          moment: POST_TOOL,
          outcome: "unenforceable",
          path: ".lisa.config.json",
          reason: "Antigravity has no hook that can refuse a file write.",
          recorded_on: ["code-style"],
          wired_through: "no-hook-surface",
        },
      ])
    );

    expect(outcome.code).toBe(0);
    expect(outcome.stderr[0]).toMatch(/^install-carriers: PASS\. /u);
    expect(outcome.stderr).toContain(
      "install-carriers: post-tool on agy is unenforceable. Antigravity has no hook that can refuse a file write."
    );
  });

  it("names the agent of a blocked point after the first", async () => {
    const blocked = (agent: "claude" | "cursor"): CarrierPoint => ({
      ...AGENT_POINT,
      agent,
      outcome: "blocked",
      reason: `${agent} is in the way.`,
    });

    const outcome = await ran(
      resultWith([blocked("claude"), blocked("cursor")], "blocked")
    );

    expect(outcome.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(outcome.stderr).toContain(
      "install-carriers: post-tool on cursor is blocked. cursor is in the way."
    );
  });

  it("says that Codex runs a repository's hooks only once they are approved", async () => {
    const withCodex = await ran(
      resultWith([{ ...AGENT_POINT, agent: "codex" }])
    );
    const without = await ran(resultWith([AGENT_POINT]));

    expect(withCodex.stderr.join("\n")).toContain("/hooks inside Codex");
    expect(without.stderr.join("\n")).not.toContain("/hooks");
  });
});
