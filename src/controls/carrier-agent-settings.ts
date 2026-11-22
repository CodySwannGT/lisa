/**
 * Adding one hook entry to a settings file a coding agent reads, without
 * disturbing anything else in it.
 *
 * Claude Code, Codex, Cursor and Devin each read their hooks from a JSON file
 * the repository may already have and may have filled with its own settings.
 * That file is the repository's, so it is never rewritten: the carrier's
 * entry is added to the one list it belongs in, and every other byte of the
 * file stays as it was, including keys this code has never heard of and an
 * entry beside Lisa's that the repository wrote on one line. The text is
 * edited by position (`./carrier-json-place.ts`), and the result is used
 * only when it parses to exactly what the file meant before with Lisa's
 * handlers taken out and the entry added.
 *
 * ## How Lisa's entry is told from the repository's
 *
 * By its command, compared exactly. No marker key is added, because these
 * schemas belong to the agents and an unknown key can make an agent refuse
 * the whole file. A hook of the repository's own that happens to start the
 * same script alongside something else is a different command, and is left
 * alone.
 *
 * ## What a run does
 *
 * - No entry holds the command: the entry is appended to the list, and the
 *   list and the keys leading to it are created when they are missing.
 * - Exactly one entry holds it and is what would be written: nothing.
 * - Anything else (an older matcher, the command twice, the command beside
 *   handlers of the repository's): Lisa's handlers are taken out and the
 *   entry is appended once.
 *
 * A file that is not JSON, whose list is something other than a list, or
 * that cannot be added to without changing what it means, is not touched;
 * the caller reports the entry to add by hand.
 * @module controls/carrier-agent-settings
 */
import {
  findNodeAtLocation,
  getNodeValue,
  parse,
  parseTree,
  type JSONPath,
  type Node,
  type ParseError,
} from "jsonc-parser";

import {
  isJsonObject,
  jsonEquals,
  setAtPath,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";

import { withAppended, withoutItem } from "./carrier-json-place.js";

import {
  AGENT_HOOK_TIMEOUT_SECONDS,
  type MergedRegistration,
} from "./carrier-agent-surfaces.js";
import type { CallState } from "./carrier-types.js";

/** A settings file with the entry in it, or why it was left alone. */
export type HookEntryMerge =
  | {
      readonly problem: null;
      /** The file's new content. */
      readonly text: string;
      /** Whether the entry was already right, added, or rewritten. */
      readonly state: Exclude<CallState, "absent">;
    }
  | { readonly problem: string };

/** Where one of Lisa's handlers is in the list of hooks. */
interface Found {
  /** The index of the entry in the list. */
  readonly entry: number;
  /** The index of the handler in a nested entry; `null` in a flat one. */
  readonly handler: number | null;
  /** Whether taking it out leaves the entry with no handler. */
  readonly emptiesEntry: boolean;
}

/**
 * The entry as it is written into an agent's list of hooks.
 * @param registration - Where the entry goes and how it is written
 * @param command - The command the hook runs
 * @returns The entry
 */
export function hookEntry(
  registration: MergedRegistration,
  command: string
): JsonObject {
  return registration.shape === "flat"
    ? { command, matcher: registration.matcher }
    : {
        matcher: registration.matcher,
        hooks: [
          { type: "command", command, timeout: AGENT_HOOK_TIMEOUT_SECONDS },
        ],
      };
}

/**
 * The content of a settings file that holds nothing but the entry.
 * @param registration - Where the entry goes and how it is written
 * @param command - The command the hook runs
 * @returns The file's content, ending with a newline
 */
function freshFile(registration: MergedRegistration, command: string): string {
  const list: unknown = [hookEntry(registration, command)];
  const nested = registration.path.reduceRight<unknown>(
    (inner, key) => ({ [key]: inner }),
    list
  );
  return `${JSON.stringify({ ...registration.skeleton, ...(nested as object) }, null, 2)}\n`;
}

/**
 * Tell whether a handler runs one of Lisa's commands.
 * @param handler - A handler, or a flat entry
 * @param owned - Every command Lisa has written for this agent
 * @returns Whether its command is one of them, compared exactly
 */
function runsLisa(handler: unknown, owned: readonly string[]): boolean {
  return (
    isJsonObject(handler) &&
    typeof handler.command === "string" &&
    owned.includes(handler.command)
  );
}

/**
 * Find every handler in a list of hooks that runs one of Lisa's commands.
 * @param list - The list of hooks for the event
 * @param shape - How an entry of the list is written
 * @param owned - Every command Lisa has written for this agent
 * @returns Where each one is, last first, so they can be taken out in order
 */
function lisaHandlers(
  list: readonly unknown[],
  shape: MergedRegistration["shape"],
  owned: readonly string[]
): readonly Found[] {
  const found = list.flatMap((entry, index): readonly Found[] => {
    if (shape === "flat") {
      return runsLisa(entry, owned)
        ? [{ emptiesEntry: true, entry: index, handler: null }]
        : [];
    }
    const handlers =
      isJsonObject(entry) && Array.isArray(entry.hooks) ? entry.hooks : [];
    const ours = handlers.flatMap((handler, at) =>
      runsLisa(handler, owned) ? [at] : []
    );
    return ours.map(at => ({
      emptiesEntry: ours.length === handlers.length,
      entry: index,
      handler: at,
    }));
  });
  return [...found].reverse();
}

/**
 * Take Lisa's handlers out of a file, leaving everything else as it was.
 * @param text - The file's content
 * @param registration - Where the list is
 * @param found - Where the handlers are, last first
 * @returns The file's content without them
 */
function withoutHandlers(
  text: string,
  registration: MergedRegistration,
  found: readonly Found[]
): string {
  // Last first, so taking one out never moves one still to be taken out. An
  // entry left with no handler goes as a whole, once.
  const targets = found.flatMap((each, index): readonly JSONPath[] => {
    if (each.handler !== null && !each.emptiesEntry) {
      return [[...registration.path, each.entry, "hooks", each.handler]];
    }
    return found.findIndex(other => other.entry === each.entry) === index
      ? [[...registration.path, each.entry]]
      : [];
  });
  return targets.reduce(
    (current, target) => withoutItem(current, target),
    text
  );
}

/**
 * The list of hooks as it must read once Lisa's handlers are out of it and
 * the entry is at its end: what the edited file is held to.
 * @param entries - The list as the file has it
 * @param registration - How an entry of the list is written
 * @param owned - Every command Lisa has written for this agent
 * @param wanted - The entry to add
 * @returns The list the edited file must parse to
 */
function expectedList(
  entries: readonly unknown[],
  registration: MergedRegistration,
  owned: readonly string[],
  wanted: JsonObject
): readonly unknown[] {
  const kept = entries.flatMap((entry): readonly unknown[] => {
    if (registration.shape === "flat") {
      return runsLisa(entry, owned) ? [] : [entry];
    }
    if (!isJsonObject(entry) || !Array.isArray(entry.hooks)) return [entry];
    const theirs = entry.hooks.filter(handler => !runsLisa(handler, owned));
    if (theirs.length === entry.hooks.length) return [entry];
    return theirs.length === 0 ? [] : [{ ...entry, hooks: theirs }];
  });
  return [...kept, wanted];
}

/** The list of hooks for the event, as a settings file holds it. */
interface HookList {
  /** The list; `null` when the file does not have it yet. */
  readonly entries: readonly unknown[] | null;
  /** The key that holds something a list cannot be under or at, or `null`. */
  readonly inTheWay: string | null;
}

/** The path and shape of an edit-time settings list. */
type SettingsList = Pick<MergedRegistration, "file" | "path" | "shape">;

/**
 * Read the list of hooks for the event out of a parsed settings file.
 * @param document - The parsed file
 * @param registration - Where the list is
 * @returns The list, that it is not there yet, or the key that is in the way
 */
function hookList(document: JsonObject, registration: SettingsList): HookList {
  const walked = registration.path.reduce<{
    readonly at: unknown;
    readonly trail: readonly string[];
    readonly inTheWay: string | null;
  }>(
    (state, key) => {
      if (state.inTheWay !== null || state.at === undefined) return state;
      return isJsonObject(state.at)
        ? { at: state.at[key], inTheWay: null, trail: [...state.trail, key] }
        : { ...state, inTheWay: state.trail.join(".") };
    },
    { at: document, inTheWay: null, trail: [] }
  );
  if (walked.inTheWay !== null) {
    return { entries: null, inTheWay: walked.inTheWay };
  }
  if (walked.at === undefined) return { entries: null, inTheWay: null };
  return Array.isArray(walked.at)
    ? { entries: walked.at, inTheWay: null }
    : { entries: null, inTheWay: registration.path.join(".") };
}

/** The parsed settings and the event list used by install and reconcile. */
type ReadSettings =
  | { readonly problem: string }
  | {
      readonly problem: null;
      readonly document: JsonObject;
      readonly entries: readonly unknown[];
      readonly tree: Node;
    };

/**
 * Read and validate the hook list using the same semantics for both commands.
 * @param text - The settings file's text
 * @param registration - Where the hook list lives
 * @returns The list and its source tree, or why it could not be read
 */
function readSettings(text: string, registration: SettingsList): ReadSettings {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  const document: unknown = tree === undefined ? undefined : getNodeValue(tree);
  if (errors.length > 0 || tree === undefined || !isJsonObject(document)) {
    return {
      problem: `${registration.file} could not be read as a JSON object, so it was left untouched.`,
    };
  }
  const list = hookList(document, registration);
  return list.inTheWay === null
    ? { document, entries: list.entries ?? [], problem: null, tree }
    : {
        problem: `${registration.file} holds something other than a list of hooks at "${list.inTheWay}", so it was left untouched.`,
      };
}

/** An edit-time command and the line of the settings file where it is written. */
interface RegisteredCommand {
  readonly command: string;
  readonly line: number;
  readonly matcher: unknown;
}

/**
 * Count the newlines before an offset using the source's sorted newline positions.
 * @param breaks - Absolute offsets of newline characters
 * @param offset - Offset of the command value
 * @param start - Start of the search range
 * @param end - Exclusive end of the search range
 * @returns The command's one-based line number
 */
function lineFor(
  breaks: readonly number[],
  offset: number,
  start = 0,
  end = breaks.length
): number {
  if (start >= end) return start + 1;
  const mid = Math.floor((start + end) / 2);
  return (breaks[mid] ?? end) < offset
    ? lineFor(breaks, offset, mid + 1, end)
    : lineFor(breaks, offset, start, mid);
}

/**
 * Read the shell commands an agent registers at edit time.
 * @param text - The settings file, after the caller checked its size
 * @param registration - Where and how the event is registered
 * @param keys - The fields that hold shell commands for this agent
 * @returns The commands or the same settings problem the installer would report
 */
export function registeredHookCommands(
  text: string,
  registration: SettingsList,
  keys: readonly string[] = ["command"]
): {
  readonly problem: string | null;
  readonly commands: readonly RegisteredCommand[];
} {
  const read = readSettings(text, registration);
  if (read.problem !== null) return { commands: [], problem: read.problem };
  const copilot = keys.includes("bash");
  if (copilot && read.document.disableAllHooks === true) {
    return { commands: [], problem: null };
  }
  const commands = read.entries.flatMap((entry, index) => {
    if (!isJsonObject(entry)) return [];
    const nested = registration.shape === "nested";
    const handlers =
      nested && Array.isArray(entry.hooks) ? entry.hooks : [entry];
    return handlers.flatMap((handler, position) => {
      if (
        !isJsonObject(handler) ||
        ((nested || copilot) && handler.type !== "command")
      )
        return [];
      const base = [
        ...registration.path,
        index,
        ...(nested ? ["hooks", position] : []),
      ];
      return keys.flatMap(key => {
        const command = handler[key];
        if (typeof command !== "string") return [];
        const offset =
          findNodeAtLocation(read.tree, [...base, key])?.offset ?? 0;
        return [{ command, matcher: entry.matcher, offset }];
      });
    });
  });
  const breaks = Array.from(text.matchAll(/\n/gu), match => match.index);
  const ordered = [...commands].sort(
    (left, right) => left.offset - right.offset
  );
  return {
    commands: ordered.map(({ offset, ...command }) => ({
      ...command,
      line: lineFor(breaks, offset),
    })),
    problem: null,
  };
}

/**
 * Put the carrier's entry into an agent's settings file.
 * @param text - The file's content; `null` or blank when there is no file
 * @param registration - Where the entry goes and how it is written
 * @param owned - Every command Lisa has written for this agent, the one to
 *   write first
 * @returns The new content and what changed, or why the file was left alone
 */
export function mergeHookEntry(
  text: string | null,
  registration: MergedRegistration,
  owned: readonly [string, ...string[]]
): HookEntryMerge {
  const [command] = owned;
  if (text === null || text.trim() === "") {
    return {
      problem: null,
      state: "added",
      text: freshFile(registration, command),
    };
  }
  const read = readSettings(text, registration);
  if (read.problem !== null) return { problem: read.problem };
  const { document, entries } = read;
  const wanted = hookEntry(registration, command);
  const found = lisaHandlers(entries, registration.shape, owned);
  const [only] = found;
  if (
    found.length === 1 &&
    only !== undefined &&
    jsonEquals(entries[only.entry], wanted)
  ) {
    return { problem: null, state: "present", text };
  }
  const next = withAppended(
    withoutHandlers(text, registration, found),
    registration.path,
    wanted
  );
  // The file is edited by position, so the edit is held to its meaning: what
  // it now parses to must be what it was, with exactly this change.
  const expected = setAtPath(
    document,
    registration.path.join("."),
    expectedList(entries, registration, owned, wanted) as JsonValue
  );
  const reread: ParseError[] = [];
  const kept =
    next !== null &&
    jsonEquals(parse(next, reread, { allowTrailingComma: true }), expected) &&
    reread.length === 0;
  return kept
    ? {
        problem: null,
        state: found.length === 0 ? "added" : "replaced",
        text: next,
      }
    : {
        problem: `${registration.file} could not be added to without changing something else in it, so it was left untouched.`,
      };
}
