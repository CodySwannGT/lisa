/**
 * What the register refuses in a declaration the gate registry accepts.
 *
 * The gate registry ships to repositories that do not carry the criterion
 * catalogue, so it checks only how a gate's `criteria` ids are written. The
 * register is generated where the catalogue is in reach, so whether each id
 * names a requirement is checked here.
 *
 * ## Adding a rule
 *
 * A rule is a function from the declaration and the catalogue to one line per
 * problem, each saying what is wrong and what to do about it in words a person
 * who has never read the specification can act on. Write it here, or in a
 * module of its own, and add it to {@link CONTROL_REGISTER_RULES}. Any problem
 * stops the register from being written or compared.
 *
 * A rule on this list sees the declaration only. One that depends on where a
 * gate turns out to be enforced cannot be written that way, because that is
 * known only once the entries are built: the rule that refuses a gate declared
 * `authoritative` with no required point beyond its author's machine is such
 * a rule, and lives in `./register-tier-rule.ts`. `./register.ts` runs it on
 * the built entries, and its problems stop the register the same way.
 * @module controls/register-rules
 */
import type { CatalogueCriterion, CriterionCatalogue } from "./catalogue.js";
import {
  GATES_DECLARATION_PATH,
  type GatesDeclaration,
} from "./gates-declaration.js";
import { partsAreEvidenced } from "./register-evidence-rule.js";
import { declarationHoldsNoSecretValues } from "./register-secrets-rule.js";
import { executorsAgree } from "./pull-request-executor.js";

/** What a rule is given. */
export interface ControlRegisterRuleContext {
  /** The declaration, already valid as far as the gate registry can tell. */
  readonly declaration: GatesDeclaration;
  /** The criterion catalogue of the running Lisa package. */
  readonly catalogue: CriterionCatalogue;
}

/** One reason to refuse a declaration; returns one line per problem. */
export type ControlRegisterRule = (
  context: ControlRegisterRuleContext
) => readonly string[];

/**
 * Say why one declared id cannot be used, when it cannot.
 * @param gate - The gate that declares it
 * @param id - The declared requirement id
 * @param criterion - The catalogue entry with that id, when there is one
 * @returns The problem, or `null` when the id names a requirement in scope
 */
function criterionProblem(
  gate: string,
  id: string,
  criterion: CatalogueCriterion | undefined
): string | null {
  const opening = `The gate "${gate}" in ${GATES_DECLARATION_PATH} says it serves "${id}"`;
  if (criterion === undefined) {
    return `${opening}, but there is no requirement with that id. Write the id exactly as the audit report shows it, or remove it from the gate's criteria.`;
  }
  if (criterion.in_scope) return null;
  const reason =
    typeof criterion.excluded_reason === "string"
      ? ` ${criterion.excluded_reason}`
      : "";
  return `${opening} (${criterion.title}), but that requirement is not one this level checks.${reason} Remove it from the gate's criteria.`;
}

/**
 * Every requirement id a gate says it serves must be a requirement the
 * catalogue lists as in scope.
 * @param context - The declaration and the catalogue
 * @returns One line per id that is not
 */
export const criteriaAreCatalogued: ControlRegisterRule = context => {
  const { declaration, catalogue } = context;
  const byId = new Map(
    catalogue.criteria.map(criterion => [criterion.id, criterion])
  );
  return Object.entries(declaration.gates).flatMap(([gate, declared]) => {
    const ids = Array.isArray(declared.criteria)
      ? (declared.criteria as readonly string[])
      : [];
    return ids
      .map(id => criterionProblem(gate, id, byId.get(id)))
      .filter((problem): problem is string => problem !== null);
  });
};

/** Every rule a declaration is held to before a register is made from it. */
export const CONTROL_REGISTER_RULES: readonly ControlRegisterRule[] = [
  criteriaAreCatalogued,
  partsAreEvidenced,
  executorsAgree,
  declarationHoldsNoSecretValues,
];
