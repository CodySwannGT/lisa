/**
 * Adding the carrier to a Lefthook configuration, as one more command.
 *
 * Lefthook owns git's hook files and rewrites them, so the only place a
 * command survives is its configuration. The carrier becomes a command named
 * `lisa-gates` under the hook's `commands`, beside the ones already there:
 * Lefthook runs them all and fails the hook when any of them fails. At push
 * the command asks for the hook's standard input, which is where git says
 * what is being pushed.
 *
 * The lines sit between this command's markers, so a later run finds and
 * replaces them, and a person can remove them.
 * @module controls/carrier-lefthook
 */
import { isDeepStrictEqual } from "node:util";

import { carrierMarkers, carrierScriptPath } from "./carrier-script.js";
import { CARRIER_HOOKS, type CarrierMoment } from "./carrier-types.js";
import {
  afterLastContent,
  blockEnd,
  firstContent,
  indented,
  indentOf,
  insertedAt,
  keyLine,
  parseMapping,
  verifiedEdit,
  withoutMarkedBlock,
  type ManagerFileEdit,
} from "./carrier-yaml-lines.js";

/** The name of the command the carrier is added as. */
export const LEFTHOOK_COMMAND = "lisa-gates";

/** The key Lefthook reads a hook's commands from. */
const COMMANDS = "commands";

/** How far a nested block is indented when this command opens it. */
const STEP = 2;

/**
 * The command as Lefthook reads it.
 * @param moment - The moment
 * @returns The command's settings
 */
export function lefthookCommand(
  moment: CarrierMoment
): Readonly<Record<string, unknown>> {
  const run = `sh ${carrierScriptPath(moment)}`;
  return moment === "push" ? { run, use_stdin: true } : { run };
}

/**
 * The command as it is written in the file.
 * @param moment - The moment
 * @returns Its lines, the command's name first
 */
function commandLines(moment: CarrierMoment): readonly string[] {
  return [
    `${LEFTHOOK_COMMAND}:`,
    ...indented(
      Object.entries(lefthookCommand(moment)).map(
        ([key, value]) => `${key}: ${String(value)}`
      ),
      STEP
    ),
  ];
}

/**
 * Read a mapping out of a parsed value.
 * @param value - The value
 * @returns The mapping; empty when the key had no value; `null` when the
 *   value is something else
 */
function mappingOf(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || value === undefined) return {};
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/**
 * The commands a parsed configuration holds for one hook.
 * @param document - The parsed configuration
 * @param hook - The hook
 * @returns The commands by name, or `null` when they are not a mapping
 */
function commandsOf(
  document: Readonly<Record<string, unknown>>,
  hook: string
): Readonly<Record<string, unknown>> | null {
  const settings = mappingOf(document[hook]);
  return settings === null ? null : mappingOf(settings[COMMANDS]);
}

/**
 * Add the marked command to a configuration's lines.
 * @param lines - The file's lines, without any earlier marked block
 * @param moment - The moment
 * @returns The new lines, or `null` when the place cannot be found
 */
function withCommand(
  lines: readonly string[],
  moment: CarrierMoment
): readonly string[] | null {
  const hook = CARRIER_HOOKS[moment];
  const { begin, end } = carrierMarkers(moment);
  const marked = (inner: readonly string[]): readonly string[] => [
    begin,
    ...inner,
    end,
  ];
  const underCommands = [
    `${COMMANDS}:`,
    ...indented(commandLines(moment), STEP),
  ];
  const key = keyLine(lines, hook, 0);
  if (key === "inline") return null;
  if (key === "absent") {
    const gap = lines.length > 0 && lines.at(-1)?.trim() !== "" ? [""] : [];
    return [
      ...lines,
      ...gap,
      ...marked([`${hook}:`, ...indented(underCommands, STEP)]),
    ];
  }
  const hookEnd = blockEnd(lines, key, 0);
  const first = firstContent(lines, key + 1, hookEnd);
  const childIndent = first === -1 ? STEP : indentOf(lines[first] ?? "");
  const commands = keyLine(lines, COMMANDS, childIndent, key + 1, hookEnd);
  if (commands === "inline" || childIndent === 0) return null;
  if (commands === "absent") {
    return insertedAt(
      lines,
      afterLastContent(lines, key + 1, hookEnd),
      indented(marked(underCommands), childIndent)
    );
  }
  const commandsEnd = blockEnd(lines, commands, childIndent);
  const entry = firstContent(lines, commands + 1, commandsEnd);
  const entryIndent =
    entry === -1 ? childIndent + STEP : indentOf(lines[entry] ?? "");
  return entryIndent <= childIndent
    ? null
    : insertedAt(
        lines,
        afterLastContent(lines, commands + 1, commandsEnd),
        indented(marked(commandLines(moment)), entryIndent)
      );
}

/**
 * Add the carrier for one moment to a Lefthook configuration.
 * @param text - The file's content
 * @param moment - The moment
 * @returns The new content, or why the file was left alone
 */
export function lefthookWith(
  text: string,
  moment: CarrierMoment
): ManagerFileEdit {
  const hook = CARRIER_HOOKS[moment];
  const command = lefthookCommand(moment);
  const byHand = `Add a command named "${LEFTHOOK_COMMAND}" under "${hook}" by hand, with these settings: ${JSON.stringify(command)}`;
  const already = commandsOf(parseMapping(text) ?? {}, hook);
  if (isDeepStrictEqual(already?.[LEFTHOOK_COMMAND], command)) {
    return { problem: null, state: "present", text };
  }
  const bare = withoutMarkedBlock(text, moment);
  if (bare.problem !== null) return { problem: `${bare.problem}. ${byHand}` };
  const commands = commandsOf(bare.document, hook);
  if (commands === null) {
    return {
      problem: `its "${hook}" entry is not written as a block of settings. ${byHand}`,
    };
  }
  if (commands[LEFTHOOK_COMMAND] !== undefined) {
    return {
      problem: `"${hook}" already has a command named "${LEFTHOOK_COMMAND}" that this command did not write. Rename or remove it, then run this again.`,
    };
  }
  return verifiedEdit(
    bare,
    withCommand(bare.lines, moment),
    {
      ...bare.document,
      [hook]: {
        ...mappingOf(bare.document[hook]),
        [COMMANDS]: { ...commands, [LEFTHOOK_COMMAND]: command },
      },
    },
    `the place to add a command could not be found safely. ${byHand}`
  );
}
