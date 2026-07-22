/** CLI wiring contract for Lisa's non-project gate commands. */
import { describe, expect, it, vi } from "vitest";

import { GATE_COMMAND_NAMES } from "../../../src/cli/gate-commands.js";
import { createProgram } from "../../../src/cli/index.js";

const FILE_UPSTREAM_COMMAND = "file-upstream";
const COMMAND = "deploy-status-sync";
const ENV_FLAG = "--environment";
const RANGE = "abc..def";

/**
 * Create a program with observable filing and update-check boundaries.
 * @returns Program and boundary spies
 */
function createGateProgram(): {
  readonly printUpdateWarning: ReturnType<typeof vi.fn>;
  readonly program: ReturnType<typeof createProgram>;
  readonly runFileUpstream: ReturnType<typeof vi.fn>;
  readonly runUpdateCheck: ReturnType<typeof vi.fn>;
} {
  const runFileUpstream = vi.fn(async () => 0);
  const runUpdateCheck = vi.fn(async () => ({
    current: "0.0.0",
    isOutdated: false,
    latest: null,
    reason: "skipped" as const,
  }));
  const printUpdateWarning = vi.fn();
  const program = createProgram({
    printUpdateWarning,
    runFileUpstream,
    runUpdateCheck,
  }).exitOverride();

  return { printUpdateWarning, program, runFileUpstream, runUpdateCheck };
}

describe("file-upstream invocation", () => {
  it("registers the public allowlist-projection subcommand", () => {
    const { program } = createGateProgram();

    expect(program.commands.map(command => command.name())).toContain(
      FILE_UPSTREAM_COMMAND
    );
  });

  it("routes only the optional input file to runFileUpstream", async () => {
    const { program, runFileUpstream } = createGateProgram();

    await program.parseAsync(
      [FILE_UPSTREAM_COMMAND, "--input", "filing-event.json"],
      { from: "user" }
    );

    expect(runFileUpstream).toHaveBeenCalledOnce();
    expect(runFileUpstream).toHaveBeenCalledWith({
      input: "filing-event.json",
    });
  });

  it("does not expose a caller-controlled Lisa root", () => {
    const { program } = createGateProgram();
    const command = program.commands.find(
      candidate => candidate.name() === FILE_UPSTREAM_COMMAND
    );

    expect(command?.options.map(option => option.long)).toEqual(["--input"]);
  });

  it("does not run the update check for file-upstream", async () => {
    const { printUpdateWarning, program, runUpdateCheck } = createGateProgram();

    await program.parseAsync([FILE_UPSTREAM_COMMAND], { from: "user" });

    expect(runUpdateCheck).not.toHaveBeenCalled();
    expect(printUpdateWarning).not.toHaveBeenCalled();
  });
});

describe("gate-command registration", () => {
  it("lists deploy-status-sync among the gate commands", () => {
    expect(GATE_COMMAND_NAMES).toContain(COMMAND);
  });

  it("registers the command and skips the update check", async () => {
    const runDeployStatusSyncSpy = vi.fn(async () => 0);
    const runUpdateCheck = vi.fn(async () => ({
      current: "0.0.0",
      isOutdated: false,
      latest: null,
      reason: "skipped" as const,
    }));
    const printUpdateWarning = vi.fn();
    const program = createProgram({
      printUpdateWarning,
      runDeployStatusSync: runDeployStatusSyncSpy,
      runUpdateCheck,
    }).exitOverride();
    await program.parseAsync(
      [COMMAND, ENV_FLAG, "staging", "--range", RANGE, "--dry-run"],
      { from: "user" }
    );
    expect(runDeployStatusSyncSpy).toHaveBeenCalledOnce();
    expect(runDeployStatusSyncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "staging",
        range: RANGE,
        dryRun: true,
      })
    );
    expect(runUpdateCheck).not.toHaveBeenCalled();
    expect(printUpdateWarning).not.toHaveBeenCalled();
  });
});
