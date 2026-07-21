import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createProgram } from "../../../src/cli/index.js";
import { getPackageVersion } from "../../../src/cli/version.js";
import type { UpdateCheckResult } from "../../../src/cli/update-check.js";

const DEST = "./sample-proj";
const CHECK_BUDGET_COMMAND = "check-learnings-budget";

const SKIPPED_RESULT: UpdateCheckResult = {
  current: "0.0.0",
  latest: null,
  isOutdated: false,
  reason: "skipped",
};

/**
 * Build a program whose update-check and apply action are stubbed so tests can
 * observe wiring without touching the npm registry or the real orchestrator.
 * @returns The program plus the injected spies
 */
function createTestProgram(): {
  program: ReturnType<typeof createProgram>;
  runApply: ReturnType<typeof vi.fn>;
  runSetupProject: ReturnType<typeof vi.fn>;
  runSetupWiki: ReturnType<typeof vi.fn>;
  runVersion: ReturnType<typeof vi.fn>;
  runUpdate: ReturnType<typeof vi.fn>;
  runDoctor: ReturnType<typeof vi.fn>;
  runHealthCli: ReturnType<typeof vi.fn>;
  runSync: ReturnType<typeof vi.fn>;
  runUi: ReturnType<typeof vi.fn>;
  runCheckLearningsBudget: ReturnType<typeof vi.fn>;
  runFileUpstream: ReturnType<typeof vi.fn>;
  runUpdateCheck: ReturnType<typeof vi.fn>;
  printUpdateWarning: ReturnType<typeof vi.fn>;
} {
  const runApply = vi.fn(async () => undefined);
  const runSetupProject = vi.fn(async () => undefined);
  const runSetupWiki = vi.fn(async () => undefined);
  const runVersion = vi.fn(async () => undefined);
  const runUpdate = vi.fn(async () => 0);
  const runDoctor = vi.fn(async () => ({ checks: [] }));
  const runHealthCli = vi.fn(async () => undefined);
  const runSync = vi.fn(async () => 0);
  const runUi = vi.fn(async () => ({}) as Server);
  const runCheckLearningsBudget = vi.fn(async () => 0);
  const runFileUpstream = vi.fn(async () => 0);
  const runUpdateCheck = vi.fn(async () => SKIPPED_RESULT);
  const printUpdateWarning = vi.fn();
  const program = createProgram({
    runApply,
    runSetupProject,
    runSetupWiki,
    runVersion,
    runUpdate,
    runDoctor,
    runHealthCli,
    runSync,
    runUi,
    runCheckLearningsBudget,
    runFileUpstream,
    runUpdateCheck,
    printUpdateWarning,
  }).exitOverride();
  return {
    program,
    runApply,
    runSetupProject,
    runSetupWiki,
    runVersion,
    runUpdate,
    runDoctor,
    runHealthCli,
    runSync,
    runUi,
    runCheckLearningsBudget,
    runFileUpstream,
    runUpdateCheck,
    printUpdateWarning,
  };
}

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

  it("registers version, update, doctor, and health subcommands", () => {
    const { program } = createTestProgram();
    const subcommandNames = program.commands.map(command => command.name());
    expect(subcommandNames).toEqual(
      expect.arrayContaining(["version", "update", "doctor", "health"])
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
    const { program, runSetupProject } = createTestProgram();

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
      })
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
