/**
 * Telling whether a committed control register still says what the `gates`
 * declaration produces, and where it does not.
 *
 * The register is generated, so the only correct content is what generating
 * it again would write. Anything else is drift: someone edited the file by
 * hand, or changed the declaration and did not regenerate. Each difference is
 * reported against the entry it is in, by the entry's identifier, so a person
 * can see which rule the file misstates without comparing two files by eye.
 * @module controls/register-drift
 */
import { isJsonObject } from "../sync/json-path.js";
import { canonicalText, compareCodeUnits } from "./canonical-json.js";
import { STATUS_DRIFT_NOTE } from "./pull-request-executor.js";
import { serializeControlRegister } from "./register.js";
import {
  CONTROL_REGISTER_PATH,
  type ControlRegister,
} from "./register-types.js";

/** The key of the register that holds its entries. */
const ENTRIES_KEY = "entries";

/** The key of an entry that comes from the evidence file. */
const STATUS_KEY = "status";

/** A committed entry, matched to its identifier when it has one. */
interface CommittedEntry {
  /** The entry's `id`, or `null` when it has none. */
  readonly id: string | null;
  /** Its place in the file, counted from one. */
  readonly position: number;
  /** The entry as parsed. */
  readonly value: unknown;
}

/**
 * Say "differs" or "differ" to agree with a list of names.
 * @param names - What differs
 * @returns The names and the verb
 */
function differing(names: readonly string[]): string {
  return `${names.join(", ")} ${names.length === 1 ? "differs" : "differ"}`;
}

/**
 * The keys two objects disagree on.
 * @param left - First value
 * @param right - Second value
 * @param except - Keys to leave out
 * @returns Each key present in only one, or holding different values, sorted
 */
function differingKeys(
  left: unknown,
  right: unknown,
  except: readonly string[] = []
): readonly string[] {
  const first = isJsonObject(left) ? left : {};
  const second = isJsonObject(right) ? right : {};
  return [...new Set([...Object.keys(first), ...Object.keys(second)])]
    .filter(key => !except.includes(key))
    .filter(key => canonicalText(first[key]) !== canonicalText(second[key]))
    .sort(compareCodeUnits);
}

/**
 * Report entries of the committed file that cannot be matched by identifier.
 * @param committed - The committed entries
 * @returns One line per entry with no identifier, or with one used twice
 */
function unmatchable(committed: readonly CommittedEntry[]): readonly string[] {
  const unnamed = committed
    .filter(entry => entry.id === null)
    .map(
      entry =>
        `Entry number ${entry.position} in ${CONTROL_REGISTER_PATH} has no id, so it cannot be matched to a gate.`
    );
  const ids = committed.flatMap(entry => (entry.id === null ? [] : [entry.id]));
  const repeated = [...new Set(ids)]
    .filter(id => ids.indexOf(id) !== ids.lastIndexOf(id))
    .map(
      id =>
        `The entry "${id}" appears more than once in ${CONTROL_REGISTER_PATH}.`
    );
  return [...unnamed, ...repeated];
}

/**
 * Compare the committed entries with the generated ones, entry by entry.
 * @param committed - The committed entries
 * @param expected - The register the declaration produces
 * @returns One line per entry that is missing, unexpected or different
 */
function entryDifferences(
  committed: readonly CommittedEntry[],
  expected: ControlRegister
): readonly string[] {
  const found = new Map(committed.map(entry => [entry.id, entry.value]));
  const produced = new Set(expected.entries.map(entry => entry.id));
  const fromDeclaration = expected.entries.flatMap(entry => {
    if (!found.has(entry.id)) {
      return [
        `The entry "${entry.id}" is missing from ${CONTROL_REGISTER_PATH}: the gates declaration produces it.`,
      ];
    }
    const fields = differingKeys(found.get(entry.id), entry);
    const note = fields.includes(STATUS_KEY) ? ` ${STATUS_DRIFT_NOTE}` : "";
    return fields.length === 0
      ? []
      : [
          `The entry "${entry.id}" in ${CONTROL_REGISTER_PATH} does not match the gates declaration: ${differing(fields)}.${note}`,
        ];
  });
  const unexpected = [...new Set(committed.map(entry => entry.id))]
    .filter((id): id is string => id !== null && !produced.has(id))
    .map(
      id =>
        `The entry "${id}" is in ${CONTROL_REGISTER_PATH}, but nothing in the gates declaration produces it.`
    );
  return [...fromDeclaration, ...unexpected];
}

/**
 * Report a file whose content is right and whose form is not.
 * @param committed - The committed entries
 * @param expected - The register the declaration produces
 * @returns One line saying what about the form differs
 */
function formDifference(
  committed: readonly CommittedEntry[],
  expected: ControlRegister
): string {
  const inOrder = expected.entries.every(
    (entry, index) => committed[index]?.id === entry.id
  );
  return inOrder
    ? `Every entry in ${CONTROL_REGISTER_PATH} matches the gates declaration, but the file's spacing or the order of its keys is not what is generated.`
    : `Every entry in ${CONTROL_REGISTER_PATH} matches the gates declaration, but the entries are not in the order they are generated in.`;
}

/**
 * Parse the committed file.
 * @param committedText - The committed file's content
 * @returns The parsed JSON, or the one-line reason it cannot be compared
 */
function parseCommitted(
  committedText: string
):
  | { readonly problem: null; readonly document: unknown }
  | { readonly problem: string } {
  try {
    return { problem: null, document: JSON.parse(committedText) as unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      problem: `${CONTROL_REGISTER_PATH} is not valid JSON, so it cannot be compared with the gates declaration. (${detail})`,
    };
  }
}

/**
 * Compare a committed register with the one its declaration produces.
 * @param committedText - The committed file's content
 * @param expected - The register the declaration produces
 * @returns One line per difference, each naming the entry it is in; empty
 *   when the file is byte for byte what would be generated
 */
export function controlRegisterDrift(
  committedText: string,
  expected: ControlRegister
): readonly string[] {
  if (committedText === serializeControlRegister(expected)) return [];
  const parsed = parseCommitted(committedText);
  if (parsed.problem !== null) return [parsed.problem];
  const { document } = parsed;
  if (!isJsonObject(document) || !Array.isArray(document[ENTRIES_KEY])) {
    return [
      `${CONTROL_REGISTER_PATH} is not a control register: it has no list of entries.`,
    ];
  }
  const committed = (document[ENTRIES_KEY] as readonly unknown[]).map(
    (value, index): CommittedEntry => ({
      id: isJsonObject(value) && typeof value.id === "string" ? value.id : null,
      position: index + 1,
      value,
    })
  );
  const outside = differingKeys(document, expected, [ENTRIES_KEY]);
  const differences = [
    ...unmatchable(committed),
    ...entryDifferences(committed, expected),
    ...(outside.length === 0
      ? []
      : [
          `${CONTROL_REGISTER_PATH} does not match the gates declaration outside its entries: ${differing(outside)}.`,
        ]),
  ];
  return differences.length > 0
    ? differences
    : [formDifference(committed, expected)];
}
