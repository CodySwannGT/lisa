/**
 * ESLint 9 Flat Config - Process Environment Bans
 *
 * Every stack that bans `process.env` does so to send configuration through
 * one place (a config service, a validated env module, a config file). Banning
 * only the `process.env` member expression left the same read open through
 * other spellings, so the ban covers every direct route to the environment
 * object:
 *
 * - `process.env` (and `process.env.X`), and the computed `process["env"]`
 * - `globalThis.process.env` (or any `<object>.process.env`), plain or computed
 * - `import { env } from "node:process"` / `"process"`, renamed or not
 * - `import * as anything from "node:process"` (whose `.env` is the same object)
 * - a default import of the module under any name other than `process`
 *   (`process.env` is already caught by the first selector)
 * - `const { env } = process`
 *
 * An alias (`const p = process; p.env`) is not followed: a selector cannot
 * track which identifiers hold the process object, and flagging every `.env`
 * would ban unrelated objects. That route is visible in review as an alias of
 * `process` and is the one this ban does not close.
 *
 * Each stack passes its own message naming where configuration should come
 * from. Files a stack already exempts (config files, tests, scripts) stay
 * exempt because they turn the whole rule off.
 * @module configs/eslint/process-environment-bans
 */

/** The `node:process` module, imported with or without the scheme. */
const PROCESS_MODULE = "ImportDeclaration[source.value=/^(node:)?process$/]";

/** One `no-restricted-syntax` entry. */
interface RestrictedSyntax {
  readonly selector: string;
  readonly message: string;
}

/**
 * Builds the `no-restricted-syntax` entries that close every direct route to
 * the process environment.
 * @param message - What the stack's code should use instead
 * @returns Entries to spread after the rule's severity
 */
export function processEnvironmentBans(
  message: string
): readonly RestrictedSyntax[] {
  return [
    "MemberExpression[object.name='process'][property.name='env']",
    "MemberExpression[object.name='process'][property.value='env']",
    "MemberExpression[object.property.name='process'][property.name='env']",
    "MemberExpression[object.property.name='process'][property.value='env']",
    "MemberExpression[object.property.value='process'][property.name='env']",
    "MemberExpression[object.property.value='process'][property.value='env']",
    `${PROCESS_MODULE} > ImportSpecifier[imported.name='env']`,
    `${PROCESS_MODULE} > ImportNamespaceSpecifier`,
    `${PROCESS_MODULE} > ImportDefaultSpecifier[local.name!='process']`,
    "VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name='env']",
  ].map(selector => ({ selector, message }));
}
