import { describe, expect, it } from "vitest";
import { DEFAULT_SETUP_PROJECT_DEPENDENCIES } from "../../../src/cli/setup-project.js";
import { getPackageVersion } from "../../../src/cli/version.js";
import { createTestProgram } from "./index-test-program.js";

const DEST = "./sample-proj";

describe("createProgram", () => {
  it("names the program lisa and reports the package.json version (not the hardcoded 1.0.0)", () => {
    const { program } = createTestProgram();
    expect(program.name()).toBe("lisa");
    expect(program.version()).toBe(getPackageVersion());
    expect(program.version()).not.toBe("1.0.0");
  });

  it("registers an explicit apply subcommand", () => {
    const { program } = createTestProgram();
    const subcommandNames = program.commands.map(command => command.name());
    expect(subcommandNames).toContain("apply");
  });

  it("registers the setup-project subcommand", () => {
    const { program } = createTestProgram();
    const subcommandNames = program.commands.map(command => command.name());
    expect(subcommandNames).toContain("setup-project");
  });

  it("registers the setup-wiki subcommand", () => {
    const { program } = createTestProgram();
    const subcommandNames = program.commands.map(command => command.name());
    expect(subcommandNames).toContain("setup-wiki");
  });

  it("registers version, update, doctor, health, and standards proof subcommands", () => {
    const { program } = createTestProgram();
    const subcommandNames = program.commands.map(command => command.name());
    expect(subcommandNames).toEqual(
      expect.arrayContaining([
        "version",
        "update",
        "doctor",
        "health",
        "standards-proof",
      ])
    );
  });

  it("exposes the root --no-update-check option", () => {
    const { program } = createTestProgram();
    const rootLongs = program.options.map(option => option.long);
    expect(rootLongs).toContain("--no-update-check");
  });
});

describe("backwards-compatible invocation", () => {
  it("routes the bare positional form `lisa <destination>` to runApply", async () => {
    const { program, runApply } = createTestProgram();

    await program.parseAsync([DEST, "--yes"], { from: "user" });

    expect(runApply).toHaveBeenCalledTimes(1);
    expect(runApply.mock.calls[0][0]).toBe(DEST);
    expect(runApply.mock.calls[0][1]).toMatchObject({ yes: true });
  });

  it("routes `lisa apply <destination>` to the same runApply with the same options", async () => {
    const { program, runApply } = createTestProgram();

    await program.parseAsync(["apply", DEST, "--yes"], {
      from: "user",
    });

    expect(runApply).toHaveBeenCalledTimes(1);
    expect(runApply.mock.calls[0][0]).toBe(DEST);
    expect(runApply.mock.calls[0][1]).toMatchObject({ yes: true });
  });

  it("forwards every shared flag through the positional form", async () => {
    const { program, runApply } = createTestProgram();

    await program.parseAsync(
      [DEST, "--yes", "--dry-run", "--skip-git-check", "--harness", "codex"],
      { from: "user" }
    );

    expect(runApply.mock.calls[0][1]).toMatchObject({
      yes: true,
      dryRun: true,
      skipGitCheck: true,
      harness: "codex",
    });
  });
});

describe("update-check pre-action hook", () => {
  it("runs the update check exactly once before the apply action", async () => {
    const { program, runApply, runUpdateCheck, printUpdateWarning } =
      createTestProgram();

    await program.parseAsync(["apply", DEST, "--yes"], {
      from: "user",
    });

    expect(runUpdateCheck).toHaveBeenCalledTimes(1);
    expect(printUpdateWarning).toHaveBeenCalledTimes(1);
    expect(runApply).toHaveBeenCalledTimes(1);
    expect(runUpdateCheck.mock.invocationCallOrder[0]).toBeLessThan(
      runApply.mock.invocationCallOrder[0]
    );
  });

  it("runs the update check once for the positional form too", async () => {
    const { program, runUpdateCheck } = createTestProgram();

    await program.parseAsync([DEST, "--yes"], { from: "user" });

    expect(runUpdateCheck).toHaveBeenCalledTimes(1);
  });

  it("does not run the update check when --no-update-check is passed", async () => {
    const { program, runUpdateCheck } = createTestProgram();

    await program.parseAsync(["apply", DEST, "--yes", "--no-update-check"], {
      from: "user",
    });

    expect(runUpdateCheck).not.toHaveBeenCalled();
  });

  it("does not run the root update warning for maintenance commands", async () => {
    const { program, runUpdateCheck } = createTestProgram();

    await program.parseAsync(["version"], { from: "user" });

    expect(runUpdateCheck).not.toHaveBeenCalled();
  });
});

describe("setup-project invocation", () => {
  it("routes setup-project to the setup action with shared options", async () => {
    const { program, runApply, runSetupProject } = createTestProgram();

    await program.parseAsync(
      ["setup-project", "--type", "rails", DEST, "--yes", "--harness", "codex"],
      { from: "user" }
    );

    expect(runSetupProject).toHaveBeenCalledWith(
      DEST,
      expect.objectContaining({
        type: "rails",
        yes: true,
        harness: "codex",
      }),
      {
        runApply,
        runCommand: DEFAULT_SETUP_PROJECT_DEPENDENCIES.runCommand,
      }
    );
  });
});

describe("setup-wiki invocation", () => {
  it("routes setup-wiki to the setup-wiki action with shared options", async () => {
    const { program, runSetupWiki } = createTestProgram();

    await program.parseAsync(["setup-wiki", DEST, "--yes"], { from: "user" });

    expect(runSetupWiki).toHaveBeenCalledWith(
      DEST,
      expect.objectContaining({ yes: true })
    );
  });
});
