/**
 * The register refuses a part that says nothing about what supports it.
 *
 * A register entry is a statement that a rule governs a folder. It may be
 * written only where something supports it: a place the audit found the check,
 * or a question a person answered. A part of a gate records that in its
 * `evidence`, and this rule is what makes leaving it off a refusal instead of
 * an entry nobody can trace.
 *
 * ## Exactly which entries it applies to
 *
 * Every entry of every gate's `parts`, and nothing else. A gate with no
 * `parts` is not looked at: its one entry for the whole repository comes from
 * the declarations Lisa ships for a supported project type, it has no part to
 * carry evidence, and it must go on generating exactly as it does today.
 *
 * ## What it does not check
 *
 * Only that the part names something. How `evidence` is written is checked by
 * the gate registry before this rule ever runs, so a part that reaches it
 * with `evidence` has at least one place or one question. Whether that place
 * is one the audit reported, and whether that question has an answer, are
 * facts about the audit report. The register must be the same bytes on every
 * machine and in every pipeline, where the report may not be, so it never
 * reads the report; `lisa controls declaration-check` holds the declaration
 * to it.
 *
 * A leaf module on purpose: it imports nothing from `./register-rules.ts`, so
 * that list can import this rule without a cycle.
 * @module controls/register-evidence-rule
 */
import { describeScope } from "./audit-report-wording.js";
import {
  GATES_DECLARATION_PATH,
  type GatesDeclaration,
} from "./gates-declaration.js";

/** The key of a part that says what supports it. */
export const PART_EVIDENCE_KEY = "evidence";

/**
 * Say that one part names nothing that supports it.
 * @param gate - The gate the part belongs to
 * @param scope - The folder the part covers
 * @returns The problem, in words an operator can act on
 */
export function unevidencedPartProblem(gate: string, scope: string): string {
  return `The gate "${gate}" in ${GATES_DECLARATION_PATH} has a part for the ${describeScope(scope)} that says nothing about what supports it. A rule is recorded only where the audit found its check or a person answered a question about it. Add "${PART_EVIDENCE_KEY}" to that part, naming the place the audit report gives ("locators") or the answered question ("questions"), or remove the part.`;
}

/**
 * Every part of every gate must say what supports it.
 * @param context - What a register rule is given
 * @param context.declaration - The declaration, already valid as far as the
 *   gate registry can tell
 * @returns One line per part that carries no `evidence`
 */
export function partsAreEvidenced(context: {
  readonly declaration: GatesDeclaration;
}): readonly string[] {
  return Object.entries(context.declaration.gates).flatMap(([gate, declared]) =>
    (Array.isArray(declared.parts)
      ? (declared.parts as readonly Readonly<Record<string, unknown>>[])
      : []
    )
      .filter(part => part[PART_EVIDENCE_KEY] === undefined)
      .map(part => unevidencedPartProblem(gate, String(part.scope)))
  );
}
