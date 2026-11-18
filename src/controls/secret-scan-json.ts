/**
 * Finding and taking out credential-shaped values in a whole document, and
 * saying where each one is without saying what it is.
 *
 * `./secret-scan.ts` judges one piece of text. This module walks a parsed
 * JSON document, hands each string to it with the name the string sits
 * under, and names every place a value was found by its path in the
 * document: `findings[3].what`, `gates.code-style.parts[0].parameters.limit
 * .value`. A path is made of the document's own key names and positions and
 * never of a value, so a message built from it can be printed.
 *
 * ## Two things a caller can do with what is found
 *
 * - **Refuse.** Text a person or an agent wrote (a finding, a question, a
 *   parameter in the gates declaration) is refused, because whoever wrote it
 *   can take the value out. {@link scanJsonForCredentials} lists the places
 *   and {@link secretFindingLine} writes the line that names one.
 * - **Take the value out.** Text captured from a program that ran (what a
 *   check printed, the arguments it was started with) is never a reason to
 *   lose the run. {@link redactJsonCredentials} returns the same document
 *   with a placeholder where each value was.
 *
 * ## Every file that is committed or shared goes through here
 *
 * A step that writes a new file under `.lisa/` must pass what it writes
 * through one of the two, or write it with `writeControlFile`
 * (`./control-files.ts`), which refuses a file that still holds one.
 * @module controls/secret-scan-json
 */
import {
  credentialKinds,
  itemContext,
  redactCredentials,
  type CredentialContext,
} from "./secret-scan.js";
import { describeCredentialKind } from "./secret-shapes.js";

/** One place in a document that holds something shaped like a credential. */
export interface SecretFinding {
  /**
   * Where it is: the keys and positions that lead to it, never the value.
   * For a finding in a name, the place whose names were looked at.
   */
  readonly path: string;
  /** What it is shaped like, for example `GITHUB_TOKEN`. */
  readonly kind: string;
  /** Whether it is a key's own name that is shaped like a credential. */
  readonly inName: boolean;
}

/** What every line about a finding ends with. */
export const VALUE_NOT_REPEATED = "The value is not repeated here.";

/** What stands in a path for a key that is itself shaped like a credential. */
const HIDDEN_NAME = "(name not shown)";

/** How the top of a document is named in a line. */
const TOP_LEVEL = "the top level";

/** The most places one line names before it counts the rest. */
const NAMED_PLACES = 3;

/**
 * A key that says nothing about what its value is. The value takes the name
 * of the key above it: a parameter is written `{ "<name>": { "value": … } }`.
 */
const TRANSPARENT_KEYS: ReadonlySet<string> = new Set(["value"]);

/** A key that can be written in a path without quotes. */
const PLAIN_KEY = /^[A-Za-z_][\w-]*$/u;

/**
 * Add one key to a path.
 * @param path - The path so far; empty at the top
 * @param key - The key
 * @returns The longer path
 */
function withKey(path: string, key: string): string {
  if (!PLAIN_KEY.test(key)) return `${path}[${JSON.stringify(key)}]`;
  return path === "" ? key : `${path}.${key}`;
}

/**
 * Tell whether a value is a JSON object.
 * @param value - Any JSON value
 * @returns Whether it is an object and not a list or `null`
 */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The context one item of a list is scanned with.
 * @param items - The list
 * @param index - The item's position
 * @param context - The context of the list itself
 * @returns The item's context
 */
function contextOfItem(
  items: readonly unknown[],
  index: number,
  context: CredentialContext
): CredentialContext {
  return typeof items[index] === "string"
    ? itemContext(items, index, context.name)
    : context;
}

/**
 * The context the value under one key is scanned with.
 * @param key - The key
 * @param context - The context of the object the key is in
 * @returns The value's context
 */
function contextOfKey(
  key: string,
  context: CredentialContext
): CredentialContext {
  return TRANSPARENT_KEYS.has(key) ? context : { name: key };
}

/**
 * List what is found under one key of an object: in its name, then in its
 * value.
 * @param key - The key
 * @param value - Its value
 * @param path - Where the object is
 * @param context - The name the object itself sits under
 * @returns The findings
 */
function underKey(
  key: string,
  value: unknown,
  path: string,
  context: CredentialContext
): readonly SecretFinding[] {
  const inName = credentialKinds(key);
  return [
    ...inName.map(kind => ({ path, kind, inName: true })),
    ...findingsIn(
      value,
      withKey(path, inName.length > 0 ? HIDDEN_NAME : key),
      contextOfKey(key, context)
    ),
  ];
}

/**
 * List every credential-shaped value at or below one place of a document.
 * @param value - The JSON value there
 * @param path - Where it is
 * @param context - The name it sits under
 * @returns The findings, in document order
 */
function findingsIn(
  value: unknown,
  path: string,
  context: CredentialContext
): readonly SecretFinding[] {
  if (typeof value === "string") {
    return credentialKinds(value, context).map(kind => ({
      path,
      kind,
      inName: false,
    }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) =>
      findingsIn(
        item,
        `${path}[${index}]`,
        contextOfItem(value, index, context)
      )
    );
  }
  return isObject(value)
    ? Object.entries(value).flatMap(([key, item]) =>
        underKey(key, item, path, context)
      )
    : [];
}

/**
 * List every place in a document that holds something shaped like a
 * credential.
 * @param document - Any parsed JSON
 * @param root - A path to put in front of every place, when the document is
 *   part of a larger file
 * @returns One finding per place and shape, in document order; empty when
 *   the document holds none
 */
export function scanJsonForCredentials(
  document: unknown,
  root = ""
): readonly SecretFinding[] {
  return findingsIn(document, root, {});
}

/**
 * Take every credential-shaped value out of one place of a document.
 * @param value - The JSON value there
 * @param context - The name it sits under
 * @returns The same value with a placeholder where each value was
 */
function redactedIn(value: unknown, context: CredentialContext): unknown {
  if (typeof value === "string") return redactCredentials(value, context).text;
  if (Array.isArray(value)) {
    return value.map((item: unknown, index) =>
      redactedIn(item, contextOfItem(value, index, context))
    );
  }
  return isObject(value)
    ? Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          redactedIn(item, contextOfKey(key, context)),
        ])
      )
    : value;
}

/**
 * Take every credential-shaped value out of a document.
 *
 * Keys are left as they are: a key is a name, and a document whose names are
 * credentials is refused by {@link scanJsonForCredentials}, not rewritten.
 * A document that holds nothing to take out comes back equal to itself.
 * @param document - Any JSON value
 * @returns The same document with a placeholder where each value was
 */
export function redactJsonCredentials<Document>(document: Document): Document {
  return redactedIn(document, {}) as Document;
}

/**
 * Write the line that says where one credential-shaped value is.
 * @param file - The file the document is, from the repository root
 * @param finding - The place and the shape
 * @returns One line that names the file, the place and the shape, and never
 *   the value
 */
export function secretFindingLine(
  file: string,
  finding: SecretFinding
): string {
  const shape = describeCredentialKind(finding.kind);
  if (finding.inName) {
    const where = finding.path === "" ? TOP_LEVEL : finding.path;
    return `${file} holds a name that is itself shaped like a credential, among the names at ${where}: ${shape}. Give it a name that is not a secret. ${VALUE_NOT_REPEATED}`;
  }
  const where = finding.path === "" ? TOP_LEVEL : finding.path;
  return `${file} holds something shaped like a credential at ${where}: ${shape}. Take the value out and write the name it goes by instead. ${VALUE_NOT_REPEATED}`;
}

/**
 * List what is found in the text of a file, whatever it holds.
 * @param text - The file's content: JSON, or any other text
 * @returns The findings; a file that is not JSON is read line by line
 */
function findingsInFile(text: string): readonly SecretFinding[] {
  try {
    return scanJsonForCredentials(JSON.parse(text) as unknown);
  } catch {
    return text.split("\n").flatMap((line, index) =>
      credentialKinds(line).map(kind => ({
        path: `line ${index + 1}`,
        kind,
        inName: false,
      }))
    );
  }
}

/**
 * Say why a file must not be written as it is, when it holds something
 * shaped like a credential.
 *
 * This is the last check before a write. Everything that reaches a file has
 * already been refused or had its values taken out where it came in, so a
 * problem here means a way in that nothing covers.
 * @param file - The file, from the repository root
 * @param text - The content about to be written
 * @returns One line naming the file and the places, or `null` when the
 *   content holds nothing shaped like a credential
 */
export function credentialProblemIn(file: string, text: string): string | null {
  const findings = findingsInFile(text);
  const [first] = findings;
  if (first === undefined) return null;
  const places = [...new Set(findings.map(finding => finding.path))];
  const named = places
    .slice(0, NAMED_PLACES)
    .map(place => (place === "" ? TOP_LEVEL : place))
    .join(", ");
  const rest = places.length - NAMED_PLACES;
  const more = rest > 0 ? ` and ${rest} more` : "";
  return `${file} was not written, because it would hold something shaped like a credential at ${named}${more}: ${describeCredentialKind(first.kind)}. ${VALUE_NOT_REPEATED} Take the value out of what this file is written from and write the name it goes by instead, then run this again.`;
}

/**
 * Take every credential-shaped value out of lines about to be printed.
 *
 * A line that reports a problem often quotes what it found. Passing every
 * such line through here means no report can repeat a value, whichever rule
 * wrote it.
 * @param lines - The lines
 * @returns The same lines with a placeholder where each value was
 */
export function withoutCredentials(
  lines: readonly string[]
): readonly string[] {
  return lines.map(line => redactCredentials(line).text);
}

/** What starts the piece of a file a JSON parser quotes in its message. */
const QUOTED_EXCERPT = [', "', ", ..."];

/**
 * Say why text could not be read as JSON, without the piece of the text the
 * parser quotes.
 *
 * A parser's message repeats a few characters from around the place it
 * stopped. In a file that holds a secret's value those characters can be
 * part of it, too short for any shape to recognise. So the message is cut
 * where the quotation begins: what went wrong stays, what was there goes.
 * @param error - What the parser threw
 * @returns The message up to the quoted excerpt
 */
export function parseProblemWithoutExcerpt(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const starts = QUOTED_EXCERPT.map(mark => message.indexOf(mark)).filter(
    index => index !== -1
  );
  return starts.length === 0 ? message : message.slice(0, Math.min(...starts));
}
