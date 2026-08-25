/**
 * The CLI must expose a cleanup verb (CodySwannGT/lisa#2993).
 *
 * The defect this pins is an ABSENCE, which is why it is asserted against the
 * registered command list rather than against behaviour. `lisa doctor` reports
 * dirty worktrees and work at risk, and the registered commands were
 * `kane · probe · run · pilot · doctor · health · version · update · sync · ui
 * · cross-pollinate · apply · setup-project · setup-wiki` — no worktree verb
 * and no stash verb. An agent told its worktrees are dirty, with no vetted way
 * to clean them, does not clean them, and the disk keeps filling.
 * @module tests/unit/cli/prune-commands
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { createProgram } from "../../../src/cli/index.js";
import { buildWorktreeRemoveArgs } from "../../../src/cli/worktree-prune.js";

/**
 * Find a registered subcommand by name.
 * @param parent - Command to search
 * @param name - Subcommand name
 * @returns The subcommand, or undefined when it is not registered
 */
function subcommand(parent: Command, name: string): Command | undefined {
  return parent.commands.find(command => command.name() === name);
}

/**
 * Names of the options one command accepts.
 * @param command - Command to inspect
 * @returns Long option flags
 */
function optionNames(command: Command): readonly string[] {
  return command.options.map(option => option.long ?? option.short ?? "");
}

describe("lisa cleanup verbs", () => {
  it("registers a worktree command group", () => {
    expect(subcommand(createProgram(), "worktree")).toBeDefined();
  });

  it("registers `lisa worktree prune`", () => {
    const worktree = subcommand(createProgram(), "worktree");
    expect(worktree).toBeDefined();
    expect(subcommand(worktree as Command, "prune")).toBeDefined();
  });

  it("registers `lisa worktree claim`", () => {
    const worktree = subcommand(createProgram(), "worktree");
    expect(worktree).toBeDefined();
    expect(subcommand(worktree as Command, "claim")).toBeDefined();
  });

  it("registers `lisa stash prune`", () => {
    const stash = subcommand(createProgram(), "stash");
    expect(stash).toBeDefined();
    expect(subcommand(stash as Command, "prune")).toBeDefined();
  });

  it("makes `lisa worktree prune` a dry run until --apply is passed", () => {
    const prune = subcommand(
      subcommand(createProgram(), "worktree") as Command,
      "prune"
    ) as Command;
    expect(optionNames(prune)).toContain("--apply");
    expect(prune.description()).toContain("dry run");
  });

  it("makes `lisa stash prune` a dry run until --apply is passed", () => {
    const prune = subcommand(
      subcommand(createProgram(), "stash") as Command,
      "prune"
    ) as Command;
    expect(optionNames(prune)).toContain("--apply");
    expect(prune.description()).toContain("dry run");
  });

  it("never passes --force to git worktree remove", () => {
    const args = buildWorktreeRemoveArgs("/workspace/wt-1");
    expect(args).toEqual(["worktree", "remove", "/workspace/wt-1"]);
    expect(args).not.toContain("--force");
    expect(args.some(argument => argument.startsWith("-f"))).toBe(false);
  });
});
