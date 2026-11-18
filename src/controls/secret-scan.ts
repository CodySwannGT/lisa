/**
 * Finding and taking out values shaped like a credential, in one piece of
 * text.
 *
 * The audit report, the control register, the evidence and the verdict are
 * committed or shared, so a credential that reached one of them would be
 * published. They refer to a secret by its name. This module is the one
 * place that decides whether a piece of text holds a secret's value instead:
 * every write point calls it, so no two of them can disagree about the same
 * string.
 *
 * ## What counts, in this order
 *
 * 1. **A shape only a credential has.** A provider's own prefix or
 *    structure: a private key block, a GitHub or cloud token, a signed web
 *    token, and the rest of `./secret-shapes.ts`. Found anywhere.
 * 2. **A web address that carries a user name or a password**, and the value
 *    after `Bearer` or `Basic`.
 * 3. **A long random-looking run, only beside a name that says it is a
 *    secret**: `token`, `secret`, `password`, `passphrase`, `credential`,
 *    `authorization`, `api_key`, `access_key`, `private_key`, written as
 *    `name=value`, `name: value`, `--name value`, or as the JSON key the
 *    text is the value of.
 *
 * ## What does not count
 *
 * A long random-looking run with no such name beside it is left alone,
 * because most of them are not secrets and a refusal blocks the operator: a
 * commit hash, a SHA-256 digest, a UUID, a file path, an encoded image, an
 * evidence record's id. A provider prefix followed only by lower-case words
 * and short numbers is a name, not a value (`pypi-internal-mirror-01`), and
 * so is a secret's own name (`Bearer GITHUB_TOKEN`, `${{ secrets.TOKEN }}`).
 *
 * It is a guard for the shapes that are recognisable, not a proof that
 * nothing secret is left: a short password, or a random value with no name
 * beside it, passes. The repository's own credential scan on every commit
 * stays the second line.
 *
 * ## Nothing found is ever returned
 *
 * Every function here answers with what a value was shaped like, or with the
 * text after the value was taken out. None returns, logs or throws the value
 * itself, so no caller can print it by accident.
 * @module controls/secret-scan
 */
import {
  AUTHORIZATION_KIND,
  CREDENTIAL_SHAPES,
  NAMED_SECRET_KIND,
  PRIVATE_KEY_KIND,
  URL_CREDENTIALS_KIND,
  credentialPlaceholder,
  type CredentialShape,
} from "./secret-shapes.js";

/** What is known about a piece of text beyond the text itself. */
export interface CredentialContext {
  /**
   * The name the text is the value of: the JSON key it sits under, or the
   * command-line flag in front of it.
   */
  readonly name?: string;
}

/** A piece of text with every credential-shaped value taken out. */
export interface RedactedText {
  /** The text, with a placeholder where each value was. */
  readonly text: string;
  /** What each value taken out was shaped like, each kind once. */
  readonly kinds: readonly string[];
}

/** A list of arguments with every credential-shaped value taken out. */
export interface RedactedArguments {
  readonly argv: readonly string[];
  readonly kinds: readonly string[];
}

/** One run to take out: where it is and what goes in its place. */
interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly kind: string;
  readonly put: string;
}

/** Decides what to do about one match; `null` leaves it alone. */
type Decide = (match: RegExpMatchArray, start: number) => Replacement | null;

/** The names that say the value beside them is a secret. */
const SECRET_NAME_SOURCE =
  "authorization|passw(?:or)?d|passphrase|secret|token|credential|api[_-]?key|access[_-]?key|private[_-]?key";

/** A name that says its value is a secret, anywhere in a word. */
const SECRET_NAME = new RegExp(SECRET_NAME_SOURCE, "iu");

/**
 * The most blank space taken to still join a name to its value. Text laid
 * out in columns puts a run of spaces between the two; a bound keeps every
 * pattern here linear in the length of the text.
 */
const GAP = 40;

/** The characters a credential's value is made of. */
const VALUE_SOURCE = "[A-Za-z0-9+=_.~-]{16,}";

/** `name=value`, `name: value` and `"name": "value"`, with an optional scheme. */
const NAMED_VALUE = new RegExp(
  `(${SECRET_NAME_SOURCE})[\\w-]{0,24}["']?\\s{0,${GAP}}[:=]\\s{0,${GAP}}["']?(?:(?:bearer|basic|token)\\s{1,${GAP}})?(${VALUE_SOURCE})`,
  "giu"
);

/** `--name value`, the way a command line passes a secret. */
const FLAG_VALUE = new RegExp(
  `--?[\\w-]{0,24}(?:${SECRET_NAME_SOURCE})[\\w-]{0,24}\\s{1,${GAP}}["']?(${VALUE_SOURCE})`,
  "giu"
);

/** A whole flag that names a secret, as one argument of a command. */
const SECRET_FLAG = new RegExp(
  `^--?[\\w-]{0,24}(?:${SECRET_NAME_SOURCE})[\\w-]{0,24}$`,
  "iu"
);

/** A credential scheme followed by a run long enough to be a credential. */
const SCHEME_VALUE = /\b(?:bearer|basic)\s{1,40}([\w+/.~=-]{16,})/giu;

/** A web address with something before an `@` in front of the host. */
const WEB_ADDRESS_USER: CredentialShape = {
  kind: URL_CREDENTIALS_KIND,
  re: /\b(https?:\/\/)[^\s/?#@:]+@/giu,
  replace: "$1[REDACTED:URL_CREDENTIALS]@",
};

/** A whole value that is nothing but the characters a credential is made of. */
const WHOLE_VALUE = /^[A-Za-z0-9+/=_.~-]{16,}$/u;

/** A run of the characters a random token is made of. */
const TOKEN_RUN = /[A-Za-z0-9+=]{16,}/gu;

/** A hexadecimal number as long as the shortest common token of that form. */
const LONG_HEXADECIMAL = /^[0-9a-f]{32,}$/iu;

/** One piece of a name: a lower-case or upper-case word, or a short number. */
const NAME_PIECE = /^(?:[a-z]{0,15}|[A-Z]{1,15}|\d{1,4})$/u;

/** What separates the pieces of a name. */
const NAME_SEPARATOR = /[-_.]/u;

/** The least varied a run may be, in bits per character, and still count. */
const MINIMUM_ENTROPY = 3;

/** One change of character class in this many characters marks a token. */
const CLASS_CHANGE_SPAN = 3;

/**
 * Sort a character into the class a token mixes: digit, capital, small
 * letter, or anything else.
 * @param character - One character
 * @returns The class
 */
function characterClass(character: string): string {
  if (/\d/u.test(character)) return "digit";
  if (/[A-Z]/u.test(character)) return "capital";
  return /[a-z]/u.test(character) ? "small" : "other";
}

/**
 * Measure how varied a run of characters is.
 * @param run - The run
 * @returns Its Shannon entropy, in bits per character
 */
function entropy(run: string): number {
  const characters = [...run];
  const counts = characters.reduce<Readonly<Record<string, number>>>(
    (seen, character) => ({
      ...seen,
      [character]: (seen[character] ?? 0) + 1,
    }),
    {}
  );
  return Object.values(counts).reduce((bits, count) => {
    const share = count / characters.length;
    return bits - share * Math.log2(share);
  }, 0);
}

/**
 * Tell whether a run of token characters looks random rather than written.
 *
 * A word or a name, however long, stays in one class of character for most
 * of its length. A token changes class every few characters. So a run counts
 * as random-looking when it mixes letters with digits, is varied, and changes
 * class at least once in every {@link CLASS_CHANGE_SPAN} characters.
 * @param run - A run of token characters
 * @returns Whether it looks like a credential
 */
function looksRandom(run: string): boolean {
  const classes = [...run].map(character => characterClass(character));
  const changes = classes.filter(
    (kind, index) => index > 0 && kind !== classes[index - 1]
  ).length;
  return (
    classes.includes("digit") &&
    (classes.includes("capital") || classes.includes("small")) &&
    entropy(run) >= MINIMUM_ENTROPY &&
    changes * CLASS_CHANGE_SPAN >= run.length
  );
}

/**
 * Tell whether a value holds a long random-looking run.
 *
 * The run is looked for between separators, so a version, a date or a dotted
 * file name, which are short pieces joined together, never counts.
 * @param value - The value beside a name that says it is a secret
 * @returns Whether it does
 */
function holdsRandomRun(value: string): boolean {
  return (value.match(TOKEN_RUN) ?? []).some(
    run => looksRandom(run) || isLongHexadecimal(run)
  );
}

/**
 * Tell whether a run is a long hexadecimal number.
 *
 * Many tokens are one. On its own such a run is a commit hash or a digest
 * and is left alone; this is only asked about a value that sits beside a
 * name that says it is a secret.
 * @param run - A run of token characters
 * @returns Whether it is
 */
function isLongHexadecimal(run: string): boolean {
  return LONG_HEXADECIMAL.test(run) && /\d/u.test(run) && /[a-f]/iu.test(run);
}

/**
 * Tell whether a run that starts like a provider's token is only a name:
 * lower-case words and short numbers joined by hyphens, underscores or dots.
 * @param run - The matched run
 * @returns Whether it reads as a name
 */
function readsAsName(run: string): boolean {
  return run.split(NAME_SEPARATOR).every(piece => NAME_PIECE.test(piece));
}

/**
 * Tell whether the value after `Bearer` or `Basic` is a value and not the
 * name of one. A secret's name in capitals is a name.
 * @param value - What follows the scheme
 * @returns Whether it is shaped like a credential
 */
function isSchemeValue(value: string): boolean {
  return /\d/u.test(value) || (/[a-z]/u.test(value) && /.[A-Z]/u.test(value));
}

/**
 * Tell whether a name says the value beside it is a secret.
 * @param name - A JSON key, a flag or a word
 * @returns Whether it does
 */
export function namesSecret(name: string): boolean {
  return SECRET_NAME.test(name);
}

/**
 * The kind a value beside a name is reported as.
 * @param name - The name
 * @returns The authorization kind for an authorization header, else the
 *   kind of any named secret
 */
function namedKind(name: string): string {
  return /authorization/iu.test(name) ? AUTHORIZATION_KIND : NAMED_SECRET_KIND;
}

/**
 * Drop the full stops a piece of text ends with.
 * @param text - Any text
 * @returns The text up to its last character that is not a full stop
 */
function withoutClosingStops(text: string): string {
  return text.endsWith(".") ? withoutClosingStops(text.slice(0, -1)) : text;
}

/**
 * Take the last group of a match out, and nothing else.
 * @param match - The match; its last group is the value
 * @param start - Where the match begins
 * @param kind - What the value is shaped like
 * @returns The replacement
 */
function lastGroup(
  match: RegExpMatchArray,
  start: number,
  kind: string
): Replacement {
  const group = match.at(-1) ?? "";
  // A full stop that ends the sentence is not part of the value.
  const value = withoutClosingStops(group);
  const from = start + match[0].lastIndexOf(group);
  return {
    start: from,
    end: from + value.length,
    kind,
    put: credentialPlaceholder(kind),
  };
}

/**
 * Decide what to do about a run one provider's shape found.
 * @param shape - The shape
 * @returns The decision for each match
 */
function shapeDecision(shape: CredentialShape): Decide {
  return (match, start) => {
    const [found] = match;
    const put =
      shape.replace === undefined
        ? credentialPlaceholder(shape.kind)
        : shape.replace.replace("$1", match[1] ?? "");
    // Already taken out, or a name that only starts like a token.
    const leave =
      put === found ||
      (shape.replace === undefined &&
        shape.kind !== PRIVATE_KEY_KIND &&
        readsAsName(found));
    return leave
      ? null
      : { start, end: start + found.length, kind: shape.kind, put };
  };
}

/**
 * Take out every run a pattern finds and a decision accepts.
 * @param state - The text so far, and the kinds already taken out
 * @param pattern - Finds candidate runs; global
 * @param decide - Says what to do about each
 * @returns The text after, and every kind taken out so far
 */
function rewrite(
  state: RedactedText,
  pattern: RegExp,
  decide: Decide
): RedactedText {
  const { text } = state;
  const taken = [...text.matchAll(pattern)].flatMap(match => {
    const replacement = decide(match, match.index);
    return replacement === null ? [] : [replacement];
  });
  if (taken.length === 0) return state;
  const pieces = taken.map(
    (span, index) =>
      text.slice(index === 0 ? 0 : (taken[index - 1]?.end ?? 0), span.start) +
      span.put
  );
  return {
    text: `${pieces.join("")}${text.slice(taken.at(-1)?.end ?? 0)}`,
    kinds: [...new Set([...state.kinds, ...taken.map(span => span.kind)])],
  };
}

/**
 * Take a whole value out when the name it sits under says it is a secret.
 * @param state - The text so far
 * @param name - The name the text is the value of, when it has one
 * @returns The text after
 */
function underName(
  state: RedactedText,
  name: string | undefined
): RedactedText {
  const value = state.text.trim();
  if (
    name === undefined ||
    !namesSecret(name) ||
    !WHOLE_VALUE.test(value) ||
    !holdsRandomRun(value)
  ) {
    return state;
  }
  const kind = namedKind(name);
  return {
    text: credentialPlaceholder(kind),
    kinds: [...new Set([...state.kinds, kind])],
  };
}

/**
 * Take every credential-shaped value out of a piece of text.
 *
 * Running it on its own output changes nothing and finds nothing.
 * @param text - Any text
 * @param context - What is known about the text beyond its content
 * @returns The text with a placeholder where each value was, and what each
 *   value was shaped like
 */
export function redactCredentials(
  text: string,
  context: CredentialContext = {}
): RedactedText {
  const shaped = [...CREDENTIAL_SHAPES, WEB_ADDRESS_USER].reduce<RedactedText>(
    (state, shape) => rewrite(state, shape.re, shapeDecision(shape)),
    { text, kinds: [] }
  );
  const schemed = rewrite(shaped, SCHEME_VALUE, (match, start) =>
    isSchemeValue(match[1] ?? "")
      ? lastGroup(match, start, AUTHORIZATION_KIND)
      : null
  );
  const named = rewrite(schemed, NAMED_VALUE, (match, start) =>
    holdsRandomRun(match[2] ?? "")
      ? lastGroup(match, start, namedKind(match[1] ?? ""))
      : null
  );
  const flagged = rewrite(named, FLAG_VALUE, (match, start) =>
    holdsRandomRun(match[1] ?? "")
      ? lastGroup(match, start, NAMED_SECRET_KIND)
      : null
  );
  return underName(flagged, context.name);
}

/**
 * Say what the credential-shaped values in a piece of text are shaped like.
 * @param text - Any text
 * @param context - What is known about the text beyond its content
 * @returns Each kind once, in the order found; empty when there is none
 */
export function credentialKinds(
  text: string,
  context: CredentialContext = {}
): readonly string[] {
  return redactCredentials(text, context).kinds;
}

/**
 * The name one item of a list is the value of.
 *
 * A command line passes a secret as a flag and then its value, as two
 * arguments. So an item that follows a flag naming a secret is that flag's
 * value. Any other item is a value of whatever the list itself sits under.
 * @param items - The list
 * @param index - The item's position
 * @param listName - The name the list sits under, when it has one
 * @returns The context to scan the item with
 */
export function itemContext(
  items: readonly unknown[],
  index: number,
  listName?: string
): CredentialContext {
  const previous = index > 0 ? items[index - 1] : undefined;
  if (typeof previous === "string" && SECRET_FLAG.test(previous)) {
    return { name: previous };
  }
  return listName === undefined ? {} : { name: listName };
}

/**
 * Take every credential-shaped value out of a command's arguments.
 * @param argv - One item per argument
 * @returns The arguments, and what each value taken out was shaped like
 */
export function redactArguments(argv: readonly string[]): RedactedArguments {
  const redacted = argv.map((argument, index) =>
    redactCredentials(argument, itemContext(argv, index))
  );
  return {
    argv: redacted.map(each => each.text),
    kinds: [...new Set(redacted.flatMap(each => each.kinds))],
  };
}
