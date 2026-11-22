/**
 * Wiring of the two `lisa controls attest` options that reach outside the
 * repository (CodySwannGT/lisa#4997).
 *
 * `--pull-request-canaries` opens real pull requests and
 * `--acknowledge-external-effects` lets a proof do what it says it does
 * outside the repository. Both must be off unless the operator types them,
 * so this file checks what the command hands on when they are typed and,
 * above all, when they are not.
 * @module tests/unit/controls/controls-cmd-attest-pull-request
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTROLS_COMMAND,
  addControlsCommand,
} from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  ATTEST_COMMAND,
  ATTEST_EXIT,
  registerAttest,
  type AttestCommandDependencies,
} from "../../../src/controls/commands/attest.js";

const CANARIES = "--pull-request-canaries";
const ACKNOWLEDGE = "--acknowledge-external-effects";

describe("lisa controls attest: the options that reach outside the repository", () => {
  const exitCodeBefore = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = exitCodeBefore;
  });

  /**
   * Parse a command line with a stand-in for the command.
   * @param flags - What the operator typed after `attest`
   * @returns The options the stand-in was handed
   */
  async function optionsFor(flags: readonly string[]): Promise<unknown> {
    const runAttest = vi.fn<AttestCommandDependencies["runAttest"]>(
      async () => ATTEST_EXIT.PASSED
    );
    const program = new Command().exitOverride();
    addControlsCommand(program, [
      group => {
        registerAttest(group, { runAttest });
      },
    ]);

    await program.parseAsync([CONTROLS_COMMAND, ATTEST_COMMAND, ...flags], {
      from: "user",
    });

    return runAttest.mock.calls[0]?.[1];
  }

  it("lists both options on the shipped command, each saying what it does", () => {
    const command = createProgram()
      .commands.find(candidate => candidate.name() === CONTROLS_COMMAND)
      ?.commands.find(candidate => candidate.name() === ATTEST_COMMAND);
    const described = Object.fromEntries(
      (command?.options ?? []).map(option => [option.flags, option.description])
    );

    expect(described[CANARIES]).toContain("never merged");
    expect(described[CANARIES]).toContain("lisa-attest/");
    expect(described[ACKNOWLEDGE]).toContain("outside the repository");
  });

  it("asks for neither when neither is typed", async () => {
    expect(await optionsFor([])).toEqual({ json: false });
  });

  it("asks for canaries only when the operator types the option", async () => {
    expect(await optionsFor([CANARIES])).toEqual({
      json: false,
      pullRequestCanaries: true,
    });
  });

  it("passes on the acknowledgement only when the operator types the option", async () => {
    expect(await optionsFor([ACKNOWLEDGE])).toEqual({
      json: false,
      acknowledgeExternalEffects: true,
    });
  });

  it("passes on both together", async () => {
    expect(await optionsFor([CANARIES, ACKNOWLEDGE, "--json"])).toEqual({
      json: true,
      pullRequestCanaries: true,
      acknowledgeExternalEffects: true,
    });
  });
});
