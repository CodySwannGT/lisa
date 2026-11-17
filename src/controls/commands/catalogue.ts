/**
 * `lisa controls catalogue`: print the requirements an audit must answer.
 *
 * The audit is run by an agent in a repository where Lisa may never have been
 * applied. There is no `spec/` folder there, so the agent cannot read the
 * requirements from the repository it is auditing. This command hands them
 * over instead: it prints the Level 1 requirements from the catalogue inside
 * the Lisa package the command runs from, each with the plain question an
 * operator is asked.
 *
 * What it prints is exactly the set `report-check` holds a report to, because
 * both read the same catalogue through `../catalogue.ts`. Each requirement is
 * printed with its `answered` value, which says whether it has one answer for
 * the repository or one for each part. An agent that answers every requirement
 * printed here where that value says has covered everything the check will
 * count.
 *
 * It reads nothing from the repository it is run in and writes nothing
 * anywhere.
 * @module controls/commands/catalogue
 */
import type { Command } from "commander";

import {
  inScopeCriteria,
  loadCriterionCatalogue,
  type CriterionCatalogue,
  type InScopeCriterion,
} from "../catalogue.js";

/** The subcommand's name under `lisa controls`. */
export const CATALOGUE_COMMAND = "catalogue";

/** The document the command prints. */
export interface CatalogueListing {
  /** The specification the requirements come from, as the catalogue names it. */
  readonly specification: unknown;
  /** The version of that specification. */
  readonly specification_version: unknown;
  /** The conformance level the requirements belong to. */
  readonly level: unknown;
  /**
   * Every requirement the Level 1 verdict covers, in the specification's
   * order, each exactly as the catalogue holds it.
   */
  readonly criteria: readonly InScopeCriterion[];
}

/** What the command needs from outside, each replaceable in a test. */
export interface CatalogueDependencies {
  /** Reads the catalogue; the running package's own by default. */
  readonly loadCatalogue?: () => CriterionCatalogue;
  /** Where the document goes, in one call. */
  readonly stdout?: (line: string) => void;
  /** Where a failure goes, in one call. */
  readonly stderr?: (line: string) => void;
}

/**
 * Reduce a catalogue to what an audit must answer.
 * @param catalogue - The catalogue
 * @returns Where the requirements come from, and the in-scope ones
 */
export function catalogueListing(
  catalogue: CriterionCatalogue
): CatalogueListing {
  return {
    specification: catalogue.specification,
    specification_version: catalogue.specification_version,
    level: catalogue.level,
    criteria: inScopeCriteria(catalogue),
  };
}

/**
 * Print the requirements an audit must answer, as one JSON document.
 * @param dependencies - Replaceable collaborators
 * @returns The exit code: 0 when the document was printed, 1 when the
 *   catalogue could not be read
 */
export function runCatalogue(dependencies: CatalogueDependencies = {}): number {
  const stdout =
    dependencies.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const load = dependencies.loadCatalogue ?? (() => loadCriterionCatalogue());
  try {
    stdout(JSON.stringify(catalogueListing(load()), null, 2));
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stderr(`catalogue: FAIL. ${detail.replaceAll(/\s+/gu, " ")}`);
    return 1;
  }
}

/** The collaborator the registration needs, replaceable in a test. */
export interface CatalogueCommandDependencies {
  readonly runCatalogue: () => number;
}

/**
 * Register `catalogue` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerCatalogue(
  group: Command,
  dependencies: CatalogueCommandDependencies = {
    runCatalogue: () => runCatalogue(),
  }
): void {
  group
    .command(CATALOGUE_COMMAND)
    .description(
      "Print the requirements an audit must answer, each with its plain question, as JSON"
    )
    .action(() => {
      const code = dependencies.runCatalogue();
      if (code !== 0) process.exitCode = code;
    });
}
