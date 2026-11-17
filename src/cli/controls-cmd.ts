/**
 * The `lisa controls` command group.
 *
 * The audit, configure, enforce and attest steps are driven by agents, but
 * everything that decides an outcome is code, and that code lives behind this
 * one group. The steps call these subcommands; they never compute a result
 * themselves.
 *
 * ## Adding a subcommand
 *
 * This file is only a list. A subcommand lives in its own module under
 * `src/controls/commands/` and exports one function that registers it on the
 * group it is handed. To add one, write that module and add its function to
 * {@link CONTROLS_SUBCOMMANDS}: one import and one entry. A new flag on an
 * existing subcommand is a change to that subcommand's module alone.
 * @module cli/controls-cmd
 */
import type { Command } from "commander";

import { registerCatalogue } from "../controls/commands/catalogue.js";
import { registerDeclarationCheck } from "../controls/commands/declaration-check.js";
import { registerGaps } from "../controls/commands/gaps.js";
import { registerProposeThreshold } from "../controls/commands/propose-threshold.js";
import { registerProtect } from "../controls/commands/protect.js";
import { registerRegister } from "../controls/commands/register.js";
import { registerReportCheck } from "../controls/commands/report-check.js";
import { registerSeed } from "../controls/commands/seed.js";

/** The group's name on the command line. */
export const CONTROLS_COMMAND = "controls";

/** Registers one subcommand on the `controls` group. */
export type ControlsSubcommand = (group: Command) => void;

/** Every subcommand of `lisa controls`, in the order help lists them. */
export const CONTROLS_SUBCOMMANDS: readonly ControlsSubcommand[] = [
  registerCatalogue,
  registerReportCheck,
  registerGaps,
  registerSeed,
  registerProposeThreshold,
  registerDeclarationCheck,
  registerRegister,
  registerProtect,
];

/**
 * Register the `controls` group and its subcommands.
 * @param program - Commander program to mutate
 * @param subcommands - The subcommands to register
 */
export function addControlsCommand(
  program: Command,
  subcommands: readonly ControlsSubcommand[] = CONTROLS_SUBCOMMANDS
): void {
  const group = program
    .command(CONTROLS_COMMAND)
    .description(
      "Check and record the controls that govern a repository, on any stack"
    );
  subcommands.forEach(register => {
    register(group);
  });
}
