/**
 * Reading the commands a hook manager is configured to run
 * (CodySwannGT/lisa#5000).
 *
 * Lefthook and the pre-commit framework write git's hook files themselves,
 * so what a hook runs is in the manager's committed configuration, not in
 * the hook file. `lisa controls reconcile` reads that configuration and
 * reports each configured command with the moment it runs at and the line it
 * is on. The entry `lisa controls install-carriers` adds is Lisa's own
 * carrier and is never reported.
 */
import { describe, expect, it } from "vitest";

import { lefthookWith } from "../../../src/controls/carrier-lefthook.js";
import { preCommitWith } from "../../../src/controls/carrier-pre-commit.js";
import { CARRIER_MOMENTS } from "../../../src/controls/carrier-types.js";
import type { ManagerFileEdit } from "../../../src/controls/carrier-yaml-lines.js";
import {
  lefthookCommands,
  type ManagerCommand,
  type ManagerRead,
  preCommitCommands,
} from "../../../src/controls/reconcile-manager-commands.js";

const LINT = "npm run lint";

const LEFTHOOK = [
  "pre-commit:",
  "  parallel: true",
  "  commands:",
  "    lint:",
  "      run: npm run lint",
  "    audit:",
  "      run: npm audit && npm run licences",
  "pre-push:",
  "  jobs:",
  "    - run: npm test",
  "    - name: python",
  "      group:",
  "        jobs:",
  "          - run: ruff check .",
  "    - script: slow-checks.sh",
  "commit-msg:",
  "  commands:",
  "    words:",
  "      run: npx commitlint --edit",
  "",
].join("\n");

const PRE_COMMIT = [
  "default_stages: [pre-commit]",
  "repos:",
  "  - repo: https://example.test/hooks/ruff",
  "    rev: v1.0.0",
  "    hooks:",
  "      - id: ruff",
  "        args: [--fix]",
  "  - repo: local",
  "    hooks:",
  "      - id: unit",
  "        name: unit tests",
  "        entry: python -m pytest -q",
  "        language: system",
  "        stages: [pre-push]",
  "      - id: notes",
  "        entry: ./scripts/notes.sh",
  "        language: system",
  "        stages: [manual]",
  "",
].join("\n");

/**
 * Unwrap a read that was expected to succeed.
 * @param read - The read
 * @returns The commands
 */
function commandsOf(read: ManagerRead): readonly ManagerCommand[] {
  if (read.problem !== null) throw new Error(read.problem);
  return read.commands;
}

/**
 * Write every carrier into a manager's configuration, as the installer does.
 * @param text - The configuration
 * @param add - The manager's own way of adding a carrier
 * @returns The configuration with both carriers in it
 */
function withCarriers(
  text: string,
  add: (text: string, moment: "commit" | "push") => ManagerFileEdit
): string {
  return CARRIER_MOMENTS.reduce((so, moment) => {
    const edit = add(so, moment);
    if (edit.problem !== null) throw new Error(edit.problem);
    return edit.text;
  }, text);
}

/**
 * A command as a suite compares it.
 * @param moment - The moment it runs at
 * @param line - The line it is on
 * @param command - The command as written
 * @returns The command with its words
 */
function at(moment: "commit" | "push", line: number, command: string) {
  return { command, line, moment, words: command.split(" ") };
}

describe("the commands a Lefthook configuration runs", () => {
  it("reports commands, jobs and scripts of the commit and push hooks", () => {
    expect(commandsOf(lefthookCommands(LEFTHOOK))).toEqual([
      at("commit", 5, LINT),
      at("commit", 7, "npm audit"),
      at("commit", 7, "npm run licences"),
      at("push", 10, "npm test"),
      at("push", 14, "ruff check ."),
      at("push", 15, "slow-checks.sh"),
    ]);
  });

  it("does not report the carrier the installer added", () => {
    const wired = withCarriers(LEFTHOOK, lefthookWith);

    expect(wired).toContain("lisa-gates");
    expect(
      commandsOf(lefthookCommands(wired)).map(command => command.command)
    ).toEqual(
      commandsOf(lefthookCommands(LEFTHOOK)).map(command => command.command)
    );
  });

  it("reads a configuration written as JSON", () => {
    const json = JSON.stringify(
      { "pre-commit": { commands: { lint: { run: LINT } } } },
      null,
      2
    );

    expect(commandsOf(lefthookCommands(json))).toEqual([at("commit", 5, LINT)]);
  });

  it("finds nothing in a configuration with no commit or push hook", () => {
    expect(
      commandsOf(lefthookCommands("commit-msg:\n  commands: {}\n"))
    ).toEqual([]);
  });

  it("says so when the configuration is not something it can read", () => {
    const toml = "[pre-commit.commands.lint]\nrun = LINT\n";

    expect(lefthookCommands(toml).problem).toMatch(/YAML or JSON/u);
  });

  /**
   * A Lefthook configuration that runs one line at commit.
   * @param run - The line
   * @returns The configuration, with the line on its fourth line
   */
  const running = (run: string): string =>
    `pre-commit:\n  commands:\n    lint:\n      run: ${run}\n`;

  it("reads the command a configured line captures the output of", () => {
    const captured = running(
      'OUT=$(npx eslint . 2>&1) || { echo "$OUT"; exit 1; }'
    );

    expect(commandsOf(lefthookCommands(captured))).toEqual([
      at("commit", 4, "npx eslint ."),
    ]);
  });

  it("says the configuration was not read, and does not throw, when a configured line is more than it takes on", () => {
    const endless = running(`npm test && x${")".repeat(100_000)}`);

    const read = lefthookCommands(endless);

    expect(read.problem).toContain("characters long");
    expect(read).not.toHaveProperty("commands");
  });
});

describe("the hooks a pre-commit framework configuration runs", () => {
  it("reports each hook at the stages it runs at, by its entry or its id", () => {
    expect(commandsOf(preCommitCommands(PRE_COMMIT))).toEqual([
      at("commit", 6, "ruff --fix"),
      at("push", 10, "python -m pytest -q"),
    ]);
  });

  it("reports a hook with no stage at both moments", () => {
    const text =
      "repos:\n  - repo: local\n    hooks:\n      - id: lint\n        entry: npm run lint\n";

    expect(commandsOf(preCommitCommands(text))).toEqual([
      at("commit", 4, LINT),
      at("push", 4, LINT),
    ]);
  });

  it("does not report the carriers the installer added", () => {
    const wired = withCarriers(PRE_COMMIT, preCommitWith);

    expect(wired).toContain("lisa-gates-commit");
    expect(commandsOf(preCommitCommands(wired))).toEqual(
      commandsOf(preCommitCommands(PRE_COMMIT))
    );
  });

  it("says so when the configuration has no list of hook sources", () => {
    expect(preCommitCommands("repos: nothing\n").problem).toMatch(/"repos"/u);
  });
});
