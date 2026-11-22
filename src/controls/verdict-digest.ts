/**
 * The digest that binds a verdict to the files it was computed from.
 *
 * A digest is taken over the canonical text of a JSON value: object keys in
 * code-unit order at every depth, no spaces, lists in their own order (see
 * `./canonical-json.ts`). Two files that hold the same values give the same
 * digest however they are indented, and any change to a value — a result
 * flipped, a time moved, a record removed — gives a different one.
 *
 * The digest of the two inputs together is taken over one object that holds
 * both, `{ "evidence": …, "register": … }`, so nobody checking it needs a
 * rule for how two texts were joined.
 * @module controls/verdict-digest
 */
import { createHash } from "node:crypto";

import { canonicalText } from "./canonical-json.js";
import {
  VERDICT_DIGEST_ALGORITHM,
  type VerdictDigest,
} from "./verdict-types.js";

/**
 * The SHA-256 digest of a JSON value's canonical text.
 * @param value - Any JSON value
 * @returns The digest, in lower-case hexadecimal
 */
export function digestOf(value: unknown): string {
  return createHash(VERDICT_DIGEST_ALGORITHM)
    .update(canonicalText(value), "utf8")
    .digest("hex");
}

/**
 * The digest of a register and an evidence file, apart and together.
 * @param register - The control register
 * @param evidence - The evidence file
 * @returns The three digests
 */
export function verdictDigest(
  register: unknown,
  evidence: unknown
): VerdictDigest {
  return {
    algorithm: VERDICT_DIGEST_ALGORITHM,
    register: digestOf(register),
    evidence: digestOf(evidence),
    value: digestOf({ evidence, register }),
  };
}
