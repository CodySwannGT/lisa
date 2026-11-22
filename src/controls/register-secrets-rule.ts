/**
 * The register refuses a declaration that holds a secret's value.
 *
 * The control register is committed, and everything in it is copied from
 * the `gates` block of `.lisa.config.json`: a gate's name and owner, a
 * part's folder and command, the names and values of its parameters, its
 * proof files and failure text, the check a gate waits for. So a credential
 * written into the declaration would be published twice, in the declaration
 * and in the register. The declaration refers to a secret by its name; a
 * check reads the value from its environment when it runs.
 *
 * A person or an agent wrote the declaration and can take the value out, so
 * the declaration is refused and nothing is written or compared: not the
 * register, and not anything the attest step would write from it. Each line
 * names the place in the declaration by the keys and positions that lead to
 * it, for example `gates.code-style.parts[0].parameters.limit.value`, and
 * never repeats what it found there.
 *
 * What counts as the shape of a credential is decided by the scanner every
 * control command shares (`./secret-scan.ts`).
 *
 * A leaf module on purpose: it imports nothing from `./register-rules.ts`,
 * so that list can import this rule without a cycle.
 * @module controls/register-secrets-rule
 */
import {
  GATES_DECLARATION_PATH,
  type GatesDeclaration,
} from "./gates-declaration.js";
import {
  scanJsonForCredentials,
  secretFindingLine,
} from "./secret-scan-json.js";

/** The key of `.lisa.config.json` the declaration is written under. */
const GATES_KEY = "gates";

/**
 * Nothing in the declaration is shaped like a credential.
 * @param context - What a register rule is given
 * @param context.declaration - The declaration, already valid as far as the
 *   gate registry can tell
 * @returns One line per place and shape, in the order of the declaration
 */
export function declarationHoldsNoSecretValues(context: {
  readonly declaration: GatesDeclaration;
}): readonly string[] {
  const { gates, runner } = context.declaration;
  return scanJsonForCredentials({ runner, ...gates }, GATES_KEY).map(finding =>
    secretFindingLine(GATES_DECLARATION_PATH, finding)
  );
}
