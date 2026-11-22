/**
 * What makes a command a hook runs "declared".
 *
 * A hook runs commands. Some of them are the checks the register lists; the
 * rest run with nothing on record that says what they prove. The reconciler
 * reports the rest, so the line between the two has to be exact and has to
 * be narrow enough not to flood an operator with their own declared checks.
 *
 * The rule: **a command is declared when a register entry's measuring
 * mechanism at that moment is that command.** For an entry that names a
 * command, that is its argument list. For an entry that names a task, it is
 * the task runner and the task together, as the register records them. The
 * comparison is word for word, after the hook's line has been split into
 * words the way a shell would and the words shell puts in front of a command
 * have been dropped.
 *
 * Three things follow, and each is deliberate:
 *
 * - The moment counts. A linter declared at commit and also run by hand in
 *   the push hook is undeclared at push: nothing in the register says it is
 *   checked there.
 * - The words count, all of them. `ruff check src` does not declare
 *   `ruff check .`: it checks something else.
 * - The folder does not count. A hook that runs `cd api && ruff check .`
 *   is compared as `ruff check .`, because where a hook line ends up running
 *   cannot be read from the line.
 *
 * A check of any other kind (an awaited external check, an interceptor, a
 * built-in job) is no command, so it declares none.
 * @module controls/reconcile-declared
 */
import {
  mechanismAt,
  type ControlRegister,
  type ControlRegisterEntry,
  type EnforcementPoint,
} from "./register-types.js";

/**
 * The words of the command that measures an entry at one of its points.
 * @param entry - The entry
 * @param point - One of its enforcement points
 * @returns The command's words, or `null` when no command measures it there
 */
export function declaredWords(
  entry: ControlRegisterEntry,
  point: EnforcementPoint
): readonly string[] | null {
  const mechanism = mechanismAt(entry, point);
  if (mechanism.kind === "command") return mechanism.argv;
  return mechanism.kind === "task"
    ? mechanism.command.trim().split(/\s+/u)
    : null;
}

/**
 * Tell whether two commands are the same, word for word.
 * @param left - One command's words
 * @param right - The other's
 * @returns Whether every word matches, in order
 */
function sameWords(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((word, index) => word === right[index])
  );
}

/**
 * Name the register entries that declare a command at a moment.
 * @param register - The control register
 * @param moment - The moment the command runs at
 * @param words - The command's words, as a hook runs it
 * @returns The ids of the entries whose check at that moment is that
 *   command, in register order; empty when none declares it
 */
export function declaredBy(
  register: ControlRegister,
  moment: string,
  words: readonly string[]
): readonly string[] {
  return register.entries
    .filter(entry =>
      entry.enforcement_points.some(point => {
        const declared = declaredWords(entry, point);
        return (
          point.moment === moment &&
          declared !== null &&
          sameWords(declared, words)
        );
      })
    )
    .map(entry => entry.id);
}
