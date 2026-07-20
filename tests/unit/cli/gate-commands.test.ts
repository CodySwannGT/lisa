/** CLI wiring contract for Lisa's non-project gate commands. */
import { describe, expect, it, vi } from "vitest";

import { createProgram } from "../../../src/cli/index.js";

const FILE_UPSTREAM_COMMAND = "file-upstream";

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
