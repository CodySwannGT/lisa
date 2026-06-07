import { Command, InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import { HARNESS_VALUES } from "../../../src/core/config.js";
import {
  addSharedOptions,
  parseHarnessArg,
} from "../../../src/cli/shared-options.js";

describe("parseHarnessArg", () => {
  it("returns the value unchanged for every supported harness", () => {
    for (const harness of HARNESS_VALUES) {
      expect(parseHarnessArg(harness)).toBe(harness);
    }
  });

  it("normalizes the 'all' alias to 'fleet'", () => {
    expect(parseHarnessArg("all")).toBe("fleet");
  });

  it("throws InvalidArgumentError listing the allowed values for an unknown harness", () => {
    expect(() => parseHarnessArg("nonsense")).toThrow(InvalidArgumentError);
    try {
      parseHarnessArg("nonsense");
    } catch (error) {
      expect((error as Error).message).toContain(HARNESS_VALUES.join(" | "));
      expect((error as Error).message).toContain("all");
      expect((error as Error).message).toContain('"nonsense"');
    }
  });

  it("rejects the removed 'both' harness value", () => {
    expect(() => parseHarnessArg("both")).toThrow(InvalidArgumentError);
  });
});

describe("addSharedOptions", () => {
  it("registers the shared apply flags on a command", () => {
    const command = addSharedOptions(new Command("apply"));
    const optionFlags = command.options.map(option => option.long);

    expect(optionFlags).toEqual(
      expect.arrayContaining([
        "--dry-run",
        "--yes",
        "--validate",
        "--skip-git-check",
        "--harness",
      ])
    );
  });

  it("returns the same command instance for chaining", () => {
    const command = new Command("apply");
    expect(addSharedOptions(command)).toBe(command);
  });

  it("parses the shared flags into the documented CLIOptions shape", () => {
    const command = addSharedOptions(new Command("apply"))
      .argument("[destination]")
      .exitOverride();

    command.parse(
      [
        "./sample-proj",
        "--yes",
        "--dry-run",
        "--skip-git-check",
        "--harness",
        "codex",
      ],
      { from: "user" }
    );

    expect(command.opts()).toMatchObject({
      yes: true,
      dryRun: true,
      skipGitCheck: true,
      harness: "codex",
    });
  });
});
