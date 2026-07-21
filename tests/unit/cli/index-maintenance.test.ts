import { describe, expect, it } from "vitest";
import { createTestProgram } from "./index-test-program.js";

const DEST = "./sample-proj";
const CHECK_BUDGET_COMMAND = "check-learnings-budget";

describe("maintenance command invocation", () => {
  it("routes version to the version action", async () => {
    const { program, runVersion } = createTestProgram();

    await program.parseAsync(["version"], { from: "user" });

    expect(runVersion).toHaveBeenCalledTimes(1);
  });

  it("routes update --yes to the update action", async () => {
    const { program, runUpdate } = createTestProgram();

    await program.parseAsync(["update", "--yes"], { from: "user" });

    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ yes: true })
    );
  });

  it("routes doctor options to the doctor action", async () => {
    const { program, runDoctor } = createTestProgram();

    await program.parseAsync(["doctor", DEST, "--json", "--offline"], {
      from: "user",
    });

    expect(runDoctor).toHaveBeenCalledWith(
      DEST,
      expect.objectContaining({ json: true, offline: true })
    );
  });

  it("routes both health protocol modes to the shared health action", async () => {
    const { program, runHealthCli } = createTestProgram();

    await program.parseAsync(["health", DEST, "--prepare-agentic"], {
      from: "user",
    });

    expect(runHealthCli).toHaveBeenCalledWith(
      DEST,
      expect.objectContaining({ prepareAgentic: true })
    );
  });

  it("routes standards-proof without running the update warning", async () => {
    const { program, runStandardsProofCli, runUpdateCheck } =
      createTestProgram();

    await program.parseAsync(["standards-proof", DEST], { from: "user" });

    expect(runStandardsProofCli).toHaveBeenCalledWith(DEST);
    expect(runUpdateCheck).not.toHaveBeenCalled();
  });
});

describe("sync and ui invocation", () => {
  it("registers sync and ui subcommands", () => {
    const { program } = createTestProgram();
    const subcommandNames = program.commands.map(command => command.name());
    expect(subcommandNames).toEqual(expect.arrayContaining(["sync", "ui"]));
  });

  it("routes sync options to the sync action", async () => {
    const { program, runSync } = createTestProgram();

    await program.parseAsync(["sync", DEST, "--dry-run", "--json"], {
      from: "user",
    });

    expect(runSync).toHaveBeenCalledWith(
      DEST,
      expect.objectContaining({ dryRun: true, json: true })
    );
  });

  it("routes ui options to the ui action, including --no-sync", async () => {
    const { program, runUi } = createTestProgram();

    await program.parseAsync(["ui", DEST, "--port", "5001", "--no-sync"], {
      from: "user",
    });

    expect(runUi).toHaveBeenCalledWith(
      DEST,
      expect.objectContaining({ port: "5001", sync: false })
    );
  });

  it("does not run the update check for sync or ui", async () => {
    const { program, runUpdateCheck } = createTestProgram();

    await program.parseAsync(["sync", DEST], { from: "user" });

    expect(runUpdateCheck).not.toHaveBeenCalled();
  });
});

describe("check-learnings-budget invocation", () => {
  it("registers the check-learnings-budget subcommand", () => {
    const { program } = createTestProgram();
    const subcommandNames = program.commands.map(command => command.name());
    expect(subcommandNames).toContain(CHECK_BUDGET_COMMAND);
  });

  it("routes the optional path argument to runCheckLearningsBudget", async () => {
    const { program, runCheckLearningsBudget } = createTestProgram();

    await program.parseAsync(
      [CHECK_BUDGET_COMMAND, "custom/PROJECT_LEARNINGS.md"],
      { from: "user" }
    );

    expect(runCheckLearningsBudget).toHaveBeenCalledTimes(1);
    expect(runCheckLearningsBudget.mock.calls[0][0]).toBe(
      "custom/PROJECT_LEARNINGS.md"
    );
  });

  it("routes the no-argument form to runCheckLearningsBudget with undefined", async () => {
    const { program, runCheckLearningsBudget } = createTestProgram();

    await program.parseAsync([CHECK_BUDGET_COMMAND], { from: "user" });

    expect(runCheckLearningsBudget).toHaveBeenCalledTimes(1);
    expect(runCheckLearningsBudget.mock.calls[0][0]).toBeUndefined();
  });

  it("does not run the update check for check-learnings-budget", async () => {
    const { program, runUpdateCheck } = createTestProgram();

    await program.parseAsync([CHECK_BUDGET_COMMAND], { from: "user" });

    expect(runUpdateCheck).not.toHaveBeenCalled();
  });
});
