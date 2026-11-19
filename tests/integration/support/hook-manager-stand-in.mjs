#!/usr/bin/env node
/**
 * Stands in for a hook manager's own git hook (CodySwannGT/lisa#4989).
 *
 * Lefthook and the pre-commit framework are programs a repository installs
 * for itself; neither is available where the suite runs. What each does at a
 * hook is small and documented: read its committed configuration, and run
 * what the configuration declares for that hook, in order, failing the hook
 * when anything fails. This does exactly that and no more, so a suite can
 * prove that a configuration `lisa controls install-carriers` wrote still
 * runs what was there and now runs the carrier too.
 *
 * It is not the manager. A suite that uses it proves what the configuration
 * says, not how a given version of the manager reads it.
 *
 * Usage: `node hook-manager-stand-in.mjs <lefthook|pre-commit> <hook>`,
 * started from the repository root.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { load } from "js-yaml";

/** The shell a manager runs a declared command with. */
const SHELL = "/bin/sh";

/**
 * The commands Lefthook runs at a hook, in the order the file lists them.
 * @param {string} hook The git hook.
 * @returns {string[]} One shell command per declared command.
 */
function lefthookCommands(hook) {
  const config = load(readFileSync("lefthook.yml", "utf8")) ?? {};
  return Object.values(config[hook]?.commands ?? {}).map(
    command => command.run
  );
}

/**
 * The entries the pre-commit framework runs at a hook, in file order.
 * @param {string} hook The git hook, which is also the stage's name.
 * @returns {string[]} One shell command per hook declared for the stage.
 */
function preCommitEntries(hook) {
  const config = load(readFileSync(".pre-commit-config.yaml", "utf8")) ?? {};
  return (config.repos ?? [])
    .flatMap(repo => repo.hooks ?? [])
    .filter(entry => entry.stages === undefined || entry.stages.includes(hook))
    .map(entry => entry.entry);
}

const [manager, hook] = process.argv.slice(2);
const commands =
  manager === "lefthook" ? lefthookCommands(hook) : preCommitEntries(hook);
// Every command runs, as both managers do by default, and the hook fails
// when any of them failed.
const failed = commands.filter(
  command =>
    spawnSync(SHELL, ["-c", command], { stdio: "inherit" }).status !== 0
);
process.exitCode = failed.length === 0 ? 0 : 1;
