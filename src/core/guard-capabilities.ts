/**
 * The capability marker a Lisa-owned guard uses to declare what it defends
 * against, so refresh can compare two copies by *what they stop* rather than by
 * bytes.
 *
 * A byte comparison answers "are these the same?" and nothing else. It cannot
 * answer the only question refresh actually needs answered — "is the host's copy
 * behind mine, or ahead of it?" — and guessing "behind" is how a host's stronger
 * guard gets silently replaced by a weaker upstream one.
 *
 * The marker is one comment line in the guard's header:
 *
 * ```
 * # lisa-guard-capabilities: no-verify-abbrev, hookspath-allowlist, config-env
 * ```
 *
 * Deliberately a *set*, not a version number. A monotonic `lisa-guard-version: N`
 * is easier to compare but lies the moment two hosts harden different vectors
 * independently — which is exactly what happened: `propswapllc/frontend` closed
 * the `GIT_CONFIG_KEY_<n>` bypass while `tunnl-infrastructure` closed a different
 * one. Both would have bumped to the same number and one would have silently
 * won. Two sets stay two sets, and set difference names precisely what each copy
 * has that the other does not.
 *
 * Only the header window is scanned. A guard whose *body* greps for the marker
 * string, or a test fixture that quotes one, must not be read as declaring it.
 * @module core/guard-capabilities
 */

/**
 * How much of a file counts as its header.
 *
 * Generous enough for the long rationale comments Lisa's guards carry, small
 * enough that the marker cannot be smuggled in from a file's body.
 */
const HEADER_BYTES = 4096;

/** The token that introduces a declaration. */
const MARKER = "lisa-guard-capabilities:";

/**
 * Characters allowed between the start of a line and the marker.
 *
 * Covers every comment syntax Lisa's owned artifacts use: `#` for shell, `//`
 * and `*` for JS/TS. Requiring the marker to be preceded by nothing else is what
 * makes it a declaration rather than a mention inside prose or a quoted string.
 */
const COMMENT_PREFIX = new Set([" ", "\t", "#", "/", "*"]);

/** A guard's declared capability set, normalised for comparison. */
export type CapabilitySet = ReadonlySet<string>;

/**
 * Read the capabilities a guard's header declares.
 *
 * Absence is not an error and not a failure signal — it means the artifact has
 * not been enrolled, and every caller treats that as "no declaration made"
 * rather than "declares nothing dangerous". That is what lets the marker roll
 * out one guard at a time with no flag day.
 * Scanned line by line with plain string operations rather than a regular
 * expression. A header is untrusted input — it arrives from whatever repository
 * the "host" copy came from — and a linear scan cannot be made to backtrack.
 * @param bytes - Full contents of the guard file
 * @returns The declared capabilities, lower-cased and de-duplicated
 */
export function readGuardCapabilities(bytes: Buffer): CapabilitySet {
  const header = bytes.subarray(0, HEADER_BYTES).toString("utf8");
  const declared = header
    .split("\n")
    .flatMap(line => declarationOn(line))
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0);
  return new Set(declared);
}

/**
 * The capabilities one line declares, if it is a declaration at all.
 * @param line - A single line from the header
 * @returns Raw comma-separated entries, or nothing when the line declares none
 */
function declarationOn(line: string): readonly string[] {
  const at = line.indexOf(MARKER);
  if (at === -1) return [];
  for (const character of line.slice(0, at)) {
    if (!COMMENT_PREFIX.has(character)) return [];
  }
  return line.slice(at + MARKER.length).split(",");
}

/**
 * The capabilities the host declares that Lisa's copy does not.
 *
 * A non-empty result is the whole signal: the host copy defends something
 * upstream does not, so overwriting it removes protection. This is set
 * *difference*, not a strict-superset test, on purpose — a host that hardened
 * vector A while upstream hardened vector B is not a superset of upstream, yet
 * overwriting it still deletes A. Asking only "is the host a superset?" would
 * clobber precisely the divergent-hardening case the set representation exists
 * to handle.
 * @param host - Capabilities declared by the installed copy
 * @param lisa - Capabilities declared by the packaged copy
 * @returns Capabilities present on the host and absent upstream, sorted
 */
export function capabilitiesOnlyOnHost(
  host: CapabilitySet,
  lisa: CapabilitySet
): readonly string[] {
  return [...host]
    .filter(capability => !lisa.has(capability))
    .sort((left, right) => left.localeCompare(right));
}
