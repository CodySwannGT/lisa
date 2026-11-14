/**
 * Machine-token candidates inside a pinned phrase (CodySwannGT/lisa#4867).
 *
 * A Markdown assertion pins either WORDING (prose an agent reads) or a token
 * that something mechanical consumes: a marker, a trailer key, a flag, an
 * identifier, a path. This module only finds the token-shaped substrings of a
 * phrase; `classify.mjs` then decides whether shipped code actually reads any
 * of them. Plain English — including kebab-case words such as `re-request`
 * and emphasis capitals such as `NEVER` — is deliberately not token-shaped.
 * @module scripts/lib/markdown-assertions/tokens
 */

/** Capitalised emphasis words that are prose, not identifiers. */
const EMPHASIS_WORDS = new Set(
  (
    "ALL ALSO ALWAYS AND ANY ARE AFTER BEFORE BOTH CANNOT DO DOES DONE EACH EVER EVERY " +
    "FIRST FROM HAVE INTO JUST LAST MUST NEVER NONE ONCE ONLY OUTSIDE OVER SAME SHOULD " +
    "SOME STOP THAT THEN THERE THIS THOSE UNLESS UNTIL WHAT WHEN WHERE WHICH WILL WITH " +
    "WITHOUT NOT NOTE ONE TWO YOUR YOU THEY EXACTLY STILL HERE ITSELF REQUIRED OPTIONAL " +
    "IMPORTANT CRITICAL WARNING HARD RULE RULES TRUE FALSE NEXT ELSE BUT CAN MAY"
  ).split(" ")
);

/** Token shapes, each a global regular expression. */
const TOKEN_SHAPES = Object.freeze([
  // [lisa-human-gate], [EVIDENCE-REF: ...] — bracketed markers.
  /\[[A-Za-z][\w:-]*\w(?=[\]:])/gu,
  // <!-- lisa:review-substitute — HTML-comment markers.
  /<!--\s*[\w.:-]+/gu,
  // Work-Item:, Co-Authored-By: — multi-word trailer keys.
  /\b[A-Z][a-z]+(?:-[A-Za-z][a-z]+)+:/gu,
  // snake_case and SCREAMING_SNAKE identifiers.
  /\b[A-Za-z][A-Za-z0-9]*_\w+\b/gu,
  // camelCase identifiers.
  /\b[a-z]+[A-Z][A-Za-z0-9]*\b/gu,
  // SCREAMING-KEBAB identifiers.
  /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu,
  // --cli-flags.
  /(?<![\w-])--[a-z][a-z0-9-]+/gu,
  // $VARIABLES and ${...} expansions.
  /\$\{?[A-Za-z_]\w*/gu,
  // file names with a code or config extension.
  /[\w.-]*\w\.(?:mjs|cjs|js|ts|json|jsonc|sh|md|mdc|yml|yaml|toml|py)\b/gu,
  // repository paths.
  /\b[\w.-]+\/[\w.-]+(?:\/[\w.-]*)*/gu,
  // lisa skill / command references: /lisa-x, lisa:x, $lisa-x.
  /\blisa[-:][a-z0-9][a-z0-9:-]*/gu,
  // namespaced labels such as status:ready or type:Bug.
  /\b[a-z]+:[A-Za-z][A-Za-z0-9-]+\b/gu,
]);

/** All-capital words of four or more letters (filtered by EMPHASIS_WORDS). */
const CAPITAL_WORD = /(?<![\w-])[A-Z]{4,}(?![\w-])/gu;

/** A code span's content that reads as code: one word with code punctuation, or all capitals. */
const CODE_SPAN_TOKEN =
  /^(?:[\w$.[<@/-][^\s]*[_\-./:$@#=<>[\]][^\s]*|[A-Z][A-Z0-9_]+)$/u;

/** Characters that mark a phrase as a code snippet rather than prose. */
const CODE_PUNCTUATION = /[={}|]|\(\)|=>|&&|\$\(/u;

/** Backtick code spans. */
const CODE_SPAN = /`([^`\n]+)`/gu;

/** Shortest token worth looking up; shorter ones match code by accident. */
export const MIN_TOKEN_LENGTH = 4;

/**
 * Token-shaped substrings of a phrase.
 * @param {string} text - The phrase (for a pattern, its literal text).
 * @returns {string[]} Unique tokens, longest first.
 */
export function tokenCandidates(text) {
  const found = new Set(
    TOKEN_SHAPES.flatMap(shape => [...text.matchAll(shape)].map(m => m[0]))
  );
  for (const match of text.matchAll(CAPITAL_WORD)) {
    if (!EMPHASIS_WORDS.has(match[0])) found.add(match[0]);
  }
  for (const match of text.matchAll(CODE_SPAN)) {
    const inner = match[1] ?? "";
    if (CODE_SPAN_TOKEN.test(inner)) found.add(inner);
  }
  const trimmed = text.trim();
  if (CODE_PUNCTUATION.test(trimmed)) found.add(trimmed);
  return [...found]
    .map(token =>
      token.replace(/[.,;:)]+$/u, match => (match === ":" ? match : ""))
    )
    .filter(token => token.length >= MIN_TOKEN_LENGTH)
    .filter((token, index, all) => all.indexOf(token) === index)
    .sort((a, b) => b.length - a.length);
}

/** Escapes that stand for a class of characters, not a literal. */
const CLASS_ESCAPES = new Set(["S", "b", "B", "d", "D", "w", "W", "n", "t"]);

/**
 * A character class's literal stand-in: `[Ee]` (one letter in two cases)
 * reads as its first letter; any other class breaks the fragment.
 * @param {string} body - The class body between the brackets.
 * @returns {string} The stand-in.
 */
function classStandIn(body) {
  return body.length === 2 &&
    /^[A-Za-z]{2}$/u.test(body) &&
    body[0]?.toLowerCase() === body[1]?.toLowerCase()
    ? (body[0] ?? "")
    : "\n";
}

/**
 * The literal text a regular expression source spells, close enough to find
 * its tokens: escapes are unescaped, `\s` becomes a space, a case class such
 * as `[Ee]` becomes its first letter, and alternation, groups, wildcards and
 * other classes become line breaks between fragments.
 * @param {string} source - A RegExp source.
 * @returns {string} Literal fragments separated by newlines.
 */
export function patternLiteral(source) {
  return [...source.matchAll(REGEX_PIECE)]
    .map(([piece]) => literalPiece(piece))
    .join("")
    .replaceAll(/[ \t]+/gu, " ");
}

/** One syntactic piece of a RegExp source, in matching priority. */
const REGEX_PIECE = new RegExp(
  [
    /\\[\s\S]/u, // an escape
    /\[(?:\\[\s\S]|[^\]\\])*\]/u, // a character class
    /\{\d+(?:,\d*)?\}/u, // a counted quantifier
    /\(\?(?:[:=!]|<[=!]|<\w+>)/u, // a group prefix
    /[\s\S]/u, // any other character
  ]
    .map(piece => piece.source)
    .join("|"),
  "gu"
);

/**
 * The literal stand-in for one RegExp piece.
 * @param {string} piece - A piece matched by REGEX_PIECE.
 * @returns {string} Its literal text, a fragment break, or nothing.
 */
function literalPiece(piece) {
  if (piece.startsWith("\\")) {
    const next = piece.slice(1);
    if (next === "s") return " ";
    return CLASS_ESCAPES.has(next) ? "\n" : next;
  }
  if (piece.length > 1 && piece.startsWith("[")) {
    return classStandIn(piece.slice(1, -1));
  }
  if (piece.startsWith("{") && piece.length > 1) return "";
  if (piece.startsWith("(?") || "()|^$.".includes(piece)) return "\n";
  return "*+?".includes(piece) ? "" : piece;
}
