/**
 * The control register: one committed record of what governs a repository,
 * generated from its `gates` declaration.
 *
 * The declaration in `.lisa.config.json` is the only thing a person or an
 * agent writes. The register at {@link CONTROL_REGISTER_PATH} is produced from
 * it, so it cannot say something the declaration does not, and the same
 * declaration always produces the same bytes: keys are in a fixed order,
 * entries are ordered by gate and then by folder, and nothing in the file
 * depends on when or where it was generated.
 *
 * It works in a repository where Lisa was never applied, with or without a
 * `package.json`, and for a declaration with no `parts` at all: such a gate
 * gets one entry for the whole repository, taken from how the shipped gate
 * registry resolves it today.
 * @module controls/register
 */
import { canonicalize, compareCodeUnits } from "./canonical-json.js";
import {
  loadCriterionCatalogue,
  type CriterionCatalogue,
} from "./catalogue.js";
import {
  GATES_DECLARATION_PATH,
  loadGatesModule,
  readGatesDeclaration,
  type GatesDeclaration,
  type GatesModule,
} from "./gates-declaration.js";
import { entriesForGate } from "./register-entries.js";
import { resolveEnforcementPoints } from "./register-points.js";
import { CONTROL_REGISTER_RULES } from "./register-rules.js";
import {
  CONTROL_REGISTER_SCHEMA_VERSION,
  type ControlRegister,
  type ControlRegisterEntry,
} from "./register-types.js";

/** What a register is built from. */
export interface ControlRegisterInputs {
  /** The validated `gates` declaration. */
  readonly declaration: GatesDeclaration;
  /** The shipped gate registry, which says what each declaration runs. */
  readonly registry: GatesModule;
  /** The criterion catalogue. */
  readonly catalogue: CriterionCatalogue;
}

/** A register, or one line per reason there is none. */
export type ControlRegisterBuild =
  | { readonly problems: null; readonly register: ControlRegister }
  | { readonly problems: readonly string[] };

/** A generated register and its file content, or why there is none. */
export type ControlRegisterGeneration =
  | {
      readonly problems: null;
      readonly register: ControlRegister;
      /** Exactly what `lisa controls register` writes. */
      readonly text: string;
    }
  | { readonly problems: readonly string[] };

/**
 * Report entries that would share an identifier.
 *
 * It can only happen when a gate's own name contains the character that joins
 * a gate to its folder, and it is refused rather than resolved: an identifier
 * that names two entries would attach one entry's evidence to the other.
 * @param entries - The entries, in register order
 * @returns One line per shared identifier
 */
function sharedIdentifiers(
  entries: readonly ControlRegisterEntry[]
): readonly string[] {
  const sharing = entries.filter(
    (entry, index) =>
      entries.findIndex(other => other.id === entry.id) !== index
  );
  return [...new Set(sharing.map(entry => entry.id))].map(id => {
    const holders = entries
      .filter(entry => entry.id === id)
      .map(entry => `the gate "${entry.gate}" for the folder "${entry.scope}"`)
      .join(" and ");
    return `Two entries would share the identifier "${id}": ${holders}. Rename one of the gates in ${GATES_DECLARATION_PATH} so each entry can be told apart.`;
  });
}

/**
 * Build the control register from a validated declaration.
 * @param inputs - The declaration, the gate registry and the catalogue
 * @returns The register, or one line per problem
 */
export function buildControlRegister(
  inputs: ControlRegisterInputs
): ControlRegisterBuild {
  const { declaration, registry, catalogue } = inputs;
  const refused = CONTROL_REGISTER_RULES.flatMap(rule =>
    rule({ declaration, catalogue })
  );
  if (refused.length > 0) return { problems: refused };

  const resolved = resolveEnforcementPoints(declaration, registry);
  const entries = Object.keys(declaration.gates)
    .sort(compareCodeUnits)
    .flatMap(gateId =>
      entriesForGate({
        gateId,
        gate: declaration.gates[gateId] ?? {},
        points: resolved.points,
        catalogue,
      })
    );
  const problems = [...resolved.problems, ...sharedIdentifiers(entries)];
  return problems.length > 0
    ? { problems }
    : {
        problems: null,
        register: { schema_version: CONTROL_REGISTER_SCHEMA_VERSION, entries },
      };
}

/**
 * Write a register as the text of its file.
 *
 * Keys are ordered at every depth, the indent is two spaces and the file ends
 * with one newline, so the same register is always the same bytes.
 * @param register - The register
 * @returns The file content
 */
export function serializeControlRegister(register: ControlRegister): string {
  return `${JSON.stringify(canonicalize(register), null, 2)}\n`;
}

/** What generating needs from outside, each replaceable in a test. */
export interface ControlRegisterSources {
  /** Loads the shipped gate registry. */
  readonly loadGates?: () => Promise<GatesModule>;
  /** Loads the criterion catalogue. */
  readonly loadCatalogue?: () => CriterionCatalogue;
}

/**
 * Generate the control register of a repository from its declaration.
 *
 * Nothing is written. A declaration the gate registry refuses, a requirement
 * id the catalogue does not list as in scope, and a declaration that cannot
 * be read each come back as problems instead of a register.
 * @param root - Real path of the repository
 * @param sources - Replaceable collaborators
 * @returns The register and its file content, or one line per problem
 */
export async function generateControlRegister(
  root: string,
  sources: ControlRegisterSources = {}
): Promise<ControlRegisterGeneration> {
  try {
    const registry = await (sources.loadGates ?? loadGatesModule)();
    const read = readGatesDeclaration(root, registry);
    if (read.problems !== null) return { problems: read.problems };
    const built = buildControlRegister({
      declaration: read.declaration,
      registry,
      catalogue: (sources.loadCatalogue ?? loadCriterionCatalogue)(),
    });
    return built.problems === null
      ? { ...built, text: serializeControlRegister(built.register) }
      : built;
  } catch (error) {
    return {
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }
}
