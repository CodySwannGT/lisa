/**
 * Reading a repository's `gates` declaration, already validated.
 *
 * The `gates` block of `.lisa.config.json` is the only authored source of
 * control declarations. What a valid one is, and what it resolves to at each
 * moment, is decided in one place: the gate registry script Lisa ships
 * (`all/copy-overwrite/scripts/lisa-gates.mjs`). This module does not restate
 * any of it. It imports that script from the running Lisa package, the same
 * way `lisa doctor` does, and calls it: `readGates` to read the block,
 * `validateGates` to refuse an invalid one, `resolveMoment` to say what runs.
 *
 * So the control commands and the gate runner can never disagree about what a
 * declaration means, and they work in a repository where Lisa was never
 * applied: nothing is read from the host but `.lisa.config.json` and, for the
 * task names it ships, `package.json` when there is one.
 * @module controls/gates-declaration
 */
import { importGateRegistry } from "../cli/gate-registry-source.js";
import { readProofPreparation } from "./proof-preparation-declaration.js";

/** The file the declaration lives in, from the repository root. */
export const GATES_DECLARATION_PATH = ".lisa.config.json";

/** One gate at one moment, as the shipped registry resolves it. */
export interface ResolvedGate {
  /** The gate's id. */
  readonly id: string;
  /** `required` or `optional`; a gate declared off is not resolved. */
  readonly level: string;
  /** `run`, `await`, `intercept` or `builtin`. */
  readonly mode: string;
  /** The awaited check's name, when the mode is `await`. */
  readonly awaits: unknown;
  /** The app allowed to report the awaited check, when one is pinned. */
  readonly postedBy: unknown;
  /** The task that runs, when the mode is `run`. */
  readonly task: unknown;
  /** The runner and the task together, when the mode is `run`. */
  readonly command: unknown;
  /** The folder, present only on an entry resolved from a gate's `parts`. */
  readonly scope?: string;
  /** The argument list, present only on an entry resolved from `parts`. */
  readonly argv?: readonly string[] | null;
}

/** The slice of the shipped gate registry the control commands call. */
export interface GatesModule {
  /** The fixed moments, in the order a change reaches them. */
  readonly MOMENTS: readonly string[];
  /** The moment families that take an `:<environment>` suffix. */
  readonly MOMENT_FAMILIES: readonly string[];
  readonly isMoment: (moment: string) => boolean;
  readonly momentFamily: (moment: string) => string;
  readonly readGates: (cwd: string) => {
    readonly runner: string;
    readonly gates: Record<string, unknown>;
  };
  readonly projectScripts: (cwd: string) => Record<string, string> | null;
  readonly validateGates: (gates: unknown) => string[];
  readonly resolveMoment: (options: {
    readonly gates: unknown;
    readonly moment: string;
    readonly runner: string;
    readonly scripts: Record<string, string> | null;
  }) => ResolvedGate[];
}

/** One gate of a validated declaration: its settings and its moments. */
export type DeclaredGate = Readonly<Record<string, unknown>>;

/** A `gates` declaration that passed validation. */
export interface GatesDeclaration {
  /** Every declared gate by id, the runner already taken out. */
  readonly gates: Readonly<Record<string, DeclaredGate>>;
  /** The task-runner prefix, for example `npm run`. */
  readonly runner: string;
  /** The repository's package scripts, or `null` when there is no manifest. */
  readonly scripts: Readonly<Record<string, string>> | null;
}

/** A validated declaration, or what is wrong with the one found. */
export type GatesDeclarationRead =
  | { readonly problems: null; readonly declaration: GatesDeclaration }
  | { readonly problems: readonly string[] };

/**
 * Import the gate registry script from the running Lisa package.
 * @returns The registry
 * @throws {Error} When this copy of Lisa does not hold the script
 */
export async function loadGatesModule(): Promise<GatesModule> {
  const registry = await importGateRegistry<GatesModule>();
  if (registry === null) {
    throw new Error(
      "The gate registry is missing from this copy of Lisa (expected all/copy-overwrite/scripts/lisa-gates.mjs). Reinstall Lisa."
    );
  }
  return registry;
}

/**
 * Read and validate the `gates` declaration of a repository.
 *
 * A repository with no `.lisa.config.json`, or with one that declares no
 * gates, has a valid declaration with nothing in it.
 * @param root - Real path of the repository
 * @param registry - The shipped gate registry
 * @returns The declaration, or one line per problem
 */
export function readGatesDeclaration(
  root: string,
  registry: GatesModule
): GatesDeclarationRead {
  try {
    const { gates, runner } = registry.readGates(root);
    const { problem } = readProofPreparation(root);
    const problems = [
      ...registry.validateGates(gates),
      ...(problem === null ? [] : [problem]),
    ];
    return problems.length > 0
      ? { problems }
      : {
          problems: null,
          declaration: {
            gates: gates as Readonly<Record<string, DeclaredGate>>,
            runner,
            scripts: registry.projectScripts(root),
          },
        };
  } catch (error) {
    return {
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }
}
