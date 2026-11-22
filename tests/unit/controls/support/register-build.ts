/**
 * Building the control register of a declaration in-process, with the gate
 * registry and the criterion catalogue Lisa ships, for the suites that check
 * what the register says (CodySwannGT/lisa#4983).
 * @module tests/unit/controls/support/register-build
 */
import { loadCriterionCatalogue } from "../../../../src/controls/catalogue.js";
import {
  buildControlRegister,
  type ControlRegisterBuild,
} from "../../../../src/controls/register.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
} from "../../../../src/controls/register-types.js";
import {
  declarationOf,
  shippedGates,
  type GatesBlock,
} from "../../../helpers/control-register.js";

/**
 * Build the register of a declaration, refused or not.
 * @param block - The `gates` block
 * @param scripts - The repository's package scripts, `null` for no manifest
 * @returns The register, or the problems it was refused for
 */
export async function buildOf(
  block: GatesBlock,
  scripts: Readonly<Record<string, string>> | null = null
): Promise<ControlRegisterBuild> {
  return buildControlRegister({
    declaration: declarationOf(block, scripts),
    registry: await shippedGates(),
    catalogue: loadCriterionCatalogue(),
  });
}

/**
 * Build the register of a declaration, failing the case when it is refused.
 * @param block - The `gates` block
 * @param scripts - The repository's package scripts, `null` for no manifest
 * @returns The register
 */
export async function registerOf(
  block: GatesBlock,
  scripts: Readonly<Record<string, string>> | null = null
): Promise<ControlRegister> {
  const built = await buildOf(block, scripts);
  if (built.problems !== null) throw new Error(built.problems.join("\n"));
  return built.register;
}

/**
 * Find one entry of a register.
 * @param register - The register
 * @param id - The entry's identifier
 * @returns The entry
 */
export function entryOf(
  register: ControlRegister,
  id: string
): ControlRegisterEntry {
  const found = register.entries.find(candidate => candidate.id === id);
  if (found === undefined) {
    throw new Error(
      `no entry ${id}; the register has ${register.entries.map(candidate => candidate.id).join(", ")}`
    );
  }
  return found;
}
