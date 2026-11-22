/**
 * Shared declarations for the suites that validate the control keys a gate
 * may declare (`criteria`, `owner`, `tier` and `parts`).
 *
 * The suites were one file under `tests/unit/scripts/` until the control-audit
 * tests moved under `tests/unit/controls/` (planning decision P4 of
 * CodySwannGT/lisa#4961). That folder holds each suite under the line limit, so
 * the file was split by topic and what every part reads lives here.
 * @module tests/unit/controls/support/lisa-gates-parts-helpers
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROOF_DIRECTORY,
  validateGates,
} from "../../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** The repository root, from this folder. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

/** A gate this project invented, so the registry has no opinion about it. */
export const GATE = "x-lint";

/** Where every problem about that gate's parts is reported. */
export const PARTS = `gates."${GATE}".parts`;

/** The accountable party the examples name. */
export const OWNER = "Platform team";

/** The title shared by every table of malformed values. */
export const REFUSED_WHEN = "is refused when it is %s";

export const API_COMMAND = ["go", "vet", "./..."];
export const WEB_COMMAND = ["npm", "run", "lint"];
export const VIOLATION = `${PROOF_DIRECTORY}x-lint-api.violation.patch`;
export const CLEAN = `${PROOF_DIRECTORY}x-lint-api.clean.patch`;

/** One part of the repository, as a gate declares it. */
type Part = Record<string, unknown>;

/**
 * A gates block holding one custom gate with the given parts.
 * @param parts - The gate's `parts` value, well-formed or not
 * @param extra - Further keys for the gate entry
 * @returns The gates block
 */
const blockWith = (
  parts: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  [GATE]: { commit: "required", parts, ...extra },
});

/**
 * The problems reported for one custom gate with the given parts.
 * @param parts - The gate's `parts` value
 * @param extra - Further keys for the gate entry
 * @returns Every problem validation reports
 */
export const problemsFor = (
  parts: unknown,
  extra: Record<string, unknown> = {}
): string[] => validateGates(blockWith(parts, extra));

/**
 * The problems reported for a single part that is otherwise well-formed.
 * @param overrides - Keys to set on the part; `undefined` removes one
 * @returns Every problem validation reports
 */
export const problemsForPart = (overrides: Part): string[] => {
  const part: Part = { scope: "api", command: API_COMMAND, ...overrides };
  const declared = Object.fromEntries(
    Object.entries(part).filter(([, value]) => value !== undefined)
  );
  return problemsFor([declared]);
};

/**
 * The problems reported for a part whose proof block is the given value.
 * @param proof - The part's `proof` value
 * @returns Every problem validation reports
 */
export const problemsForProof = (proof: unknown): string[] =>
  problemsForPart({ proof });

/**
 * The problems reported for a part with one named parameter.
 * @param parameter - The parameter's declared value
 * @returns Every problem validation reports
 */
export const problemsForParameter = (parameter: unknown): string[] =>
  problemsForPart({ parameters: { coverage: parameter } });

/**
 * The problems reported for a gate-level key on an otherwise valid gate.
 * @param key - The gate-level key
 * @param value - Its declared value
 * @returns Every problem validation reports
 */
export const problemsForGateKey = (key: string, value: unknown): string[] =>
  validateGates({ [GATE]: { run: "lint", commit: "required", [key]: value } });
