/**
 * The fixed list of host-project names the shape guard cannot see, stored so
 * the list itself is never published.
 *
 * `downstream-references.ts` detects a *shape* — `github.com/owner/repo` and
 * workflow `uses:` — and deliberately refuses to match bare `a/b` in prose,
 * because that shape collides with file paths, date fractions and option
 * syntax, and a guard with false positives gets disabled. That reasoning is
 * sound and is left intact. It is also, measured on this repository, blind to
 * every occurrence that actually happens: a host name in running prose, in a
 * code comment, or inside a local absolute path, with no `github.com` in front
 * of it and frequently no slash anywhere in it.
 *
 * A known list has no false-positive problem at all, which is the entire
 * objection to widening the regex — a token either is one of a handful of known
 * names or it is not, and `2026/08/20`, `src/core/index.ts` and `--flag=a/b`
 * are none of them. The recorded objection to a list was different: a plaintext
 * denylist in a public repository publishes the very names it exists to
 * protect.
 *
 * **So the names are stored as truncated salted digests.** Be precise about
 * what that buys, because overclaiming here would be worse than not doing it:
 *
 * - It prevents *enumeration*. Nobody can read this file, grep it, or receive
 *   it in an npm tarball and come away with a list of names.
 * - It does **not** prevent *confirmation*. Anyone holding a specific guess can
 *   hash it and check. That is unavoidable for any in-tree denylist — the guard
 *   must be able to answer "is this token a host name?", and so must anyone
 *   holding the data that lets it. Truncation to 40 bits blunts even that:
 *   a brute force over plausible slugs returns thousands of preimages per
 *   digest, so a recovered candidate is not a recovered name.
 *
 * A name too sensitive to appear even as a digest belongs in
 * `LISA_DOWNSTREAM_NAMES` instead — an out-of-tree, environment-supplied
 * extension. The cost of that choice is stated plainly: an environment
 * variable absent from required CI means the guard bites locally and not in
 * CI, so it is the weaker of the two placements, not the stronger.
 * @module core/downstream-names
 */
import { createHash } from "node:crypto";

/**
 * Domain separator mixed into every digest.
 *
 * Not a secret — it ships in this file and must, because required CI has to
 * reproduce the digests. Its job is to make these values specific to this
 * guard, so a digest here cannot be matched against a digest computed anywhere
 * else for any other purpose.
 */
const DIGEST_SALT = "lisa/downstream-name/v1";

/**
 * Hex characters kept from each SHA-256 digest — 40 bits.
 *
 * Chosen against two opposing errors. Too wide and each digest has a single
 * preimage, which turns "you can test a guess" into "you can recover the
 * name". Too narrow and unrelated text collides: the tracked tree yields on the
 * order of 10^7 candidate spellings per scan, so at 32 bits a handful of
 * entries would be expected to produce a spurious hit roughly once every few
 * dozen runs — a flaky guard, which is a disabled guard.
 */
const DIGEST_HEX_LENGTH = 10;

/**
 * Most words one name may span.
 *
 * Covers a company name written out in full (`Some Host Systems`) without
 * paying for windows nobody uses.
 */
const MAX_NAME_WORDS = 3;

/**
 * The single characters allowed to sit between two words of one name.
 *
 * A name may be written spaced, hyphenated, underscored, dotted or slashed, and
 * all of those must reach the same entry. A sentence boundary must not: `". "`
 * is two characters, so `…the api. Creator of…` cannot join into `apicreator`.
 */
const NAME_SEPARATORS = new Set([" ", "-", "_", ".", "/", "\\"]);

/**
 * Shortest name that may be added at runtime.
 *
 * A three-character entry matches an initialism somewhere in almost any
 * repository. Refusing it is the difference between a list with no
 * false-positive problem and a list that reintroduces the one the shape guard
 * was written to avoid.
 */
export const MIN_NAME_LENGTH = 5;

/**
 * Strip a name to the form the digests are taken over.
 *
 * Case and separators are spelling, not identity: `Some-Host`, `some host` and
 * `SomeHost` are one name.
 * @param raw - A name or a candidate span of source text.
 * @returns Lowercased, alphanumerics only.
 */
export function normalizeName(raw: string): string {
  return raw.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "");
}

/**
 * The stored form of one name: its normalized length, then its digest.
 *
 * The length is carried in the clear on purpose. It is what lets a scan reject
 * the overwhelming majority of candidate spellings with an integer comparison
 * instead of a hash, and knowing that some name is eight characters long
 * identifies nobody.
 * @param raw - The name to encode.
 * @returns `"<length>:<digest>"`.
 */
export function nameEntry(raw: string): string {
  const normalized = normalizeName(raw);
  const digest = createHash("sha256")
    .update(DIGEST_SALT)
    .update(normalized)
    .digest("hex")
    .slice(0, DIGEST_HEX_LENGTH);
  return `${normalized.length}:${digest}`;
}

/**
 * Host org and company names, as entries.
 *
 * Org and company slugs only. The two other identity shapes this repository
 * carries — host repository names and a host tracker's project-key prefix — are
 * deliberately absent; arming them is a several-hundred-file rewrite and an
 * owner decision, not a cleanup. See
 * `.agents/rules/never-name-downstream-projects.md` for how to add one.
 *
 * Sorted, so the order of this array says nothing about the order the names
 * were added or how they relate to each other.
 */
export const HOST_NAME_ENTRIES: readonly string[] = [
  "10:53a6dbd968",
  "12:b6c1d2ff60",
  "14:503e0725ea",
  "6:cd2afeda7f",
  "7:bf13141dea",
  "8:3ad5ab7f19",
  "8:c712a72605",
];

/** Environment variable carrying extra names, comma-separated, in plaintext. */
export const NAME_ENV_VAR = "LISA_DOWNSTREAM_NAMES";

/**
 * Everything a scan needs to test a candidate span, prepared once.
 *
 * `lengths` is not a convenience: deriving it per line would cost more than the
 * matching does, and it is the filter that lets almost every candidate be
 * rejected on an integer comparison instead of a hash.
 */
export interface NameMatcher {
  /** `"<length>:<digest>"` for every known name. */
  readonly entries: ReadonlySet<string>;
  /** Every normalized length present in {@link entries}. */
  readonly lengths: ReadonlySet<number>;
  /** The longest normalized length present, used to stop widening a window. */
  readonly maxLength: number;
}

/**
 * Read the process environment through one narrow, reviewable exception.
 *
 * The ban exists so application code reaches configuration through a config
 * service. This is a repository scanner with no project config to reach, and
 * the variable it reads is the escape hatch for a name too sensitive to commit
 * even as a digest.
 * @returns The current process environment.
 */
function readProcessEnv(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- a repository scanner has no config service to read
  return process.env;
}

/**
 * Matchers already built, keyed by the environment value they were built from.
 *
 * Returning the same object for the same environment is what makes the
 * per-matcher answer cache reachable across files; rebuilding per file would
 * leave every scan hashing from cold. In practice this holds one entry.
 */
const built = new Map<string, NameMatcher>();

/**
 * Assemble a matcher from the committed entries plus a raw environment value.
 * @param raw - Comma-separated extra names, possibly empty.
 * @returns A prepared matcher.
 */
function buildMatcher(raw: string): NameMatcher {
  const extra = raw
    .split(",")
    .map(part => normalizeName(part))
    .filter(name => name.length >= MIN_NAME_LENGTH)
    .map(name => nameEntry(name));
  const entries = new Set([...HOST_NAME_ENTRIES, ...extra]);
  const lengths = [...entries].map(entry =>
    Number(entry.slice(0, entry.indexOf(":")))
  );
  return {
    entries,
    lengths: new Set(lengths),
    maxLength: Math.max(0, ...lengths),
  };
}

/**
 * The matcher a scan should use: the committed entries plus any supplied by
 * the environment.
 *
 * Environment names shorter than {@link MIN_NAME_LENGTH} are dropped rather
 * than rejected loudly — a scan is not the place to fail a run over a malformed
 * environment variable, and a silently-ignored short name is visible the moment
 * anyone checks whether the guard bites.
 * @param env - Environment to read; defaults to the process environment.
 * @returns A prepared matcher.
 */
export function hostNameEntries(
  env: NodeJS.ProcessEnv = readProcessEnv()
): NameMatcher {
  const raw = env[NAME_ENV_VAR] ?? "";
  const existing = built.get(raw);
  if (existing !== undefined) return existing;
  const matcher = buildMatcher(raw);
  // eslint-disable-next-line functional/immutable-data -- a pure memo of a pure function; it changes how long an answer takes, never the answer
  built.set(raw, matcher);
  return matcher;
}

/** Maximal runs of alphanumerics — the only thing a name can be made of. */
const WORD = /[A-Za-z0-9]+/gu;

/**
 * Per-matcher memo of which candidate spellings are names.
 *
 * A repository scan asks about the same handful of words several million times,
 * and a digest costs three orders of magnitude more than a map lookup. Keyed by
 * matcher rather than globally, because the answer depends on which entries are
 * loaded — one shared cache would let a matcher answer another matcher's
 * question, which is how a guard starts reporting a stale verdict.
 */
const answered = new WeakMap<NameMatcher, Map<string, boolean>>();

/**
 * Whether a candidate spelling is one of the known names.
 * @param candidate - Alphanumerics only, in whatever case the source used.
 * @param matcher - Prepared matcher.
 * @returns True when the candidate hashes to a known entry.
 */
function isKnownName(candidate: string, matcher: NameMatcher): boolean {
  const cache = answered.get(matcher) ?? new Map<string, boolean>();
  if (!answered.has(matcher)) answered.set(matcher, cache);
  const remembered = cache.get(candidate);
  if (remembered !== undefined) return remembered;
  const known = matcher.entries.has(nameEntry(candidate));
  // eslint-disable-next-line functional/immutable-data -- same memo, same guarantee
  cache.set(candidate, known);
  return known;
}

/**
 * Whether `next` continues the name that `previous` started.
 *
 * Exactly one separator may sit between them. A sentence boundary is two
 * characters, so `the api. Creator of` cannot join into `apicreator`.
 * @param text - The line both words came from.
 * @param previous - The earlier word match.
 * @param next - The later word match.
 * @returns True when the two words belong to one name.
 */
function continues(
  text: string,
  previous: RegExpExecArray,
  next: RegExpExecArray
): boolean {
  const gap = previous.index + previous[0].length;
  return next.index - gap === 1 && NAME_SEPARATORS.has(text[gap] ?? "");
}

/* eslint-disable functional/no-let, functional/immutable-data -- a scan this size cannot afford an allocation per word, and neither accumulator escapes the call */
/**
 * Every span starting at one word that spells a known host name.
 *
 * The window stops widening as soon as it is longer than the longest known
 * name, because adding a word can only make it longer still.
 * @param text - The line being scanned.
 * @param words - Every word on the line.
 * @param first - Index of the word the window starts at.
 * @param matcher - Prepared matcher.
 * @returns The matched source spans.
 */
function namesStartingAt(
  text: string,
  words: readonly RegExpExecArray[],
  first: number,
  matcher: NameMatcher
): readonly string[] {
  const start = words[first]?.index ?? 0;
  const found: string[] = [];
  let candidate = "";
  let previous: RegExpExecArray | undefined;
  for (const word of words.slice(first, first + MAX_NAME_WORDS)) {
    if (previous !== undefined && !continues(text, previous, word)) break;
    previous = word;
    candidate += word[0];
    if (candidate.length > matcher.maxLength) break;
    if (
      matcher.lengths.has(candidate.length) &&
      isKnownName(candidate, matcher)
    ) {
      found.push(text.slice(start, word.index + word[0].length));
    }
  }
  return found;
}
/* eslint-enable functional/no-let, functional/immutable-data -- back to repository defaults */

/**
 * Every span of one line that spells a known host name.
 *
 * Matching is anchored to word boundaries at both ends, which is what keeps a
 * name from firing inside a longer word: an entry for `somehost` does not match
 * `somehosting`.
 * @param text - The line to scan.
 * @param matcher - Prepared matcher from {@link hostNameEntries}.
 * @returns The matched source spans, in order.
 */
export function findHostNames(
  text: string,
  matcher: NameMatcher
): readonly string[] {
  const words = [...text.matchAll(WORD)];
  return words.flatMap((_word, first) =>
    namesStartingAt(text, words, first, matcher)
  );
}
