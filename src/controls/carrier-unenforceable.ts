/**
 * Writing down, in the gates declaration, that a coding agent cannot enforce
 * the edit-time moment.
 *
 * An agent with no hook that can refuse a file write gets no carrier. The gap
 * is recorded where the control register is generated from: on the
 * `post-tool` entry of every gate that is checked there.
 *
 * ```json
 * "post-tool": { "level": "required", "unenforceable_on": ["agy"] }
 * ```
 *
 * `.lisa.config.json` is a file people write, so it is edited in place and
 * never rewritten: only the one value is added, every other byte stays as it
 * was, and a gate that already names the agent is not touched. A short entry
 * (`"post-tool": "required"`) becomes the long form above, because the short
 * form has nowhere to hold the list.
 *
 * Agents are only ever added. A name already in a list is kept even when the
 * agent is not on this run's roster: a person may have written it, and
 * nothing here can tell.
 *
 * A gate declared `off` at the moment is skipped: nothing is enforced there,
 * so there is nothing an agent could fail to enforce. When nothing at all is
 * declared at the moment there is nothing to write, and the result says so.
 * @module controls/carrier-unenforceable
 */
import { findNodeAtLocation, parseTree, type ParseError } from "jsonc-parser";

import {
  EDIT_TIME_MOMENT,
  inAgentOrder,
  isCodingAgent,
  type CodingAgent,
} from "./coding-agents.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { UNENFORCEABLE_ON_KEY } from "./unenforceable-agents.js";

/** The widest line written on one line; a wider entry is written expanded. */
const LINE_WIDTH = 80;

/** The levels at which a gate is checked at a moment; `off` is neither. */
const ENFORCED_LEVELS: readonly unknown[] = ["required", "optional"];

/** The declaration with the gap recorded, or why it could not be. */
export type GapRecord =
  | {
      readonly problem: null;
      /** The file's content; the content given when nothing changed. */
      readonly text: string;
      /** The gates checked at the moment, in the order they are declared. */
      readonly gates: readonly string[];
      /** The agents this run adds to at least one gate. */
      readonly added: readonly CodingAgent[];
    }
  | { readonly problem: string };

/** A node of the parsed file. */
type JsonNode = NonNullable<ReturnType<typeof parseTree>>;

/**
 * Write a list of agents on one line.
 * @param agents - The list
 * @returns For example `["agy", "copilot"]`
 */
function inlineList(agents: readonly unknown[]): string {
  return `[${agents.map(agent => JSON.stringify(agent)).join(", ")}]`;
}

/**
 * The whitespace a line starts with.
 * @param text - The file's content
 * @param offset - Any position on the line
 * @returns The line's indentation
 */
function indentAt(text: string, offset: number): string {
  const line = text.slice(text.lastIndexOf("\n", offset - 1) + 1);
  return /^[ \t]*/u.exec(line)?.[0] ?? "";
}

/**
 * One step of indentation, as the file writes it.
 * @param text - The file's content
 * @returns The whitespace one level of nesting adds
 */
function indentUnit(text: string): string {
  return /^([ \t]+)\S/mu.exec(text)?.[1] ?? "  ";
}

/**
 * Replace part of a text.
 * @param text - The text
 * @param node - The node whose text is replaced
 * @param content - What replaces it
 * @returns The new text
 */
function replaced(text: string, node: JsonNode, content: string): string {
  return `${text.slice(0, node.offset)}${content}${text.slice(node.offset + node.length)}`;
}

/**
 * Turn a short entry, a level on its own, into the long form with the list.
 * @param text - The file's content
 * @param node - The short entry
 * @param agents - The agents to name
 * @returns The new content
 */
function fromShortEntry(
  text: string,
  node: JsonNode,
  agents: readonly CodingAgent[]
): string {
  const level = JSON.stringify(node.value);
  const list = `"${UNENFORCEABLE_ON_KEY}": ${inlineList(agents)}`;
  const inline = `{ "level": ${level}, ${list} }`;
  const lineStart = text.lastIndexOf("\n", node.offset - 1) + 1;
  const lineEnd = text.indexOf("\n", node.offset);
  const rest = text.slice(
    node.offset + node.length,
    lineEnd === -1 ? text.length : lineEnd
  );
  if (node.offset - lineStart + inline.length + rest.length <= LINE_WIDTH) {
    return replaced(text, node, inline);
  }
  const outer = indentAt(text, node.offset);
  const inner = `${outer}${indentUnit(text)}`;
  return replaced(
    text,
    node,
    `{\n${inner}"level": ${level},\n${inner}${list}\n${outer}}`
  );
}

/**
 * Add the list to a long entry that does not have it.
 * @param text - The file's content
 * @param node - The long entry, holding at least its level
 * @param agents - The agents to name
 * @returns The new content
 */
function intoLongEntry(
  text: string,
  node: JsonNode,
  agents: readonly CodingAgent[]
): string {
  const last = node.children?.at(-1);
  if (last === undefined) return text;
  const end = last.offset + last.length;
  const expanded = text.slice(node.offset, end).includes("\n");
  const list = `"${UNENFORCEABLE_ON_KEY}": ${inlineList(agents)}`;
  const separator = expanded ? `,\n${indentAt(text, last.offset)}` : ", ";
  return `${text.slice(0, end)}${separator}${list}${text.slice(end)}`;
}

/** What one gate's entry at the moment needs. */
type EntryStep =
  | { readonly kind: "skip" }
  | { readonly kind: "refuse"; readonly why: string }
  | {
      readonly kind: "name";
      /** Whether the entry already names every agent. */
      readonly complete: boolean;
      /** The agents the entry does not name yet. */
      readonly missing: readonly CodingAgent[];
      /** Writes the list into the file. */
      readonly write: (text: string, node: JsonNode) => string;
    };

/**
 * Decide what one gate's entry at the moment needs.
 * @param gate - The gate's id
 * @param node - The entry
 * @param agents - The agents that cannot enforce the moment
 * @returns What to do about it
 */
function entryStep(
  gate: string,
  node: JsonNode,
  agents: readonly CodingAgent[]
): EntryStep {
  if (node.type === "string") {
    return ENFORCED_LEVELS.includes(node.value)
      ? {
          complete: false,
          kind: "name",
          missing: agents,
          write: (text, entry) => fromShortEntry(text, entry, agents),
        }
      : { kind: "skip" };
  }
  if (node.type !== "object") return { kind: "skip" };
  const level = findNodeAtLocation(node, ["level"]);
  if (!ENFORCED_LEVELS.includes(level?.value)) return { kind: "skip" };
  const list = findNodeAtLocation(node, [UNENFORCEABLE_ON_KEY]);
  if (list === undefined) {
    return {
      complete: false,
      kind: "name",
      missing: agents,
      write: (text, entry) => intoLongEntry(text, entry, agents),
    };
  }
  if (list.type !== "array") {
    return {
      kind: "refuse",
      why: `gates."${gate}"."${EDIT_TIME_MOMENT}".${UNENFORCEABLE_ON_KEY} is not a list`,
    };
  }
  const named: readonly unknown[] = (list.children ?? []).map(
    child => child.value as unknown
  );
  const missing = agents.filter(agent => !named.includes(agent));
  const known = inAgentOrder([...named.filter(isCodingAgent), ...missing]);
  const others = named.filter(name => !isCodingAgent(name));
  return {
    complete: missing.length === 0,
    kind: "name",
    missing,
    write: (text, entry) => {
      const current = findNodeAtLocation(entry, [UNENFORCEABLE_ON_KEY]);
      return current === undefined
        ? text
        : replaced(text, current, inlineList([...known, ...others]));
    },
  };
}

/**
 * Parse the declaration file.
 * @param text - The file's content
 * @returns The tree, or `null` when it is not one JSON object
 */
function treeOf(text: string): JsonNode | null {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true });
  return tree !== undefined && errors.length === 0 && tree.type === "object"
    ? tree
    : null;
}

/**
 * Find one gate's entry at the edit-time moment.
 * @param text - The file's content
 * @param gate - The gate's id
 * @returns The entry, or `undefined` when the gate is not declared there
 */
function entryOf(text: string, gate: string): JsonNode | undefined {
  const tree = treeOf(text);
  return tree === null
    ? undefined
    : findNodeAtLocation(tree, ["gates", gate, EDIT_TIME_MOMENT]);
}

/**
 * Record, on every gate checked at the edit-time moment, the agents that
 * cannot enforce it.
 * @param text - The content of `.lisa.config.json`; `null` when there is none
 * @param agents - The agents, in the order Lisa writes them
 * @returns The new content and what it records, or why nothing was recorded
 */
export function recordUnenforceable(
  text: string | null,
  agents: readonly CodingAgent[]
): GapRecord {
  if (text === null) return { added: [], gates: [], problem: null, text: "" };
  const tree = treeOf(text);
  if (tree === null) {
    return {
      problem: `${GATES_DECLARATION_PATH} could not be read as a JSON object, so it was left untouched.`,
    };
  }
  const gates = findNodeAtLocation(tree, ["gates"]);
  if (gates === undefined) return { added: [], gates: [], problem: null, text };
  if (gates.type !== "object") {
    return {
      problem: `The "gates" setting of ${GATES_DECLARATION_PATH} is not an object, so it was left untouched.`,
    };
  }
  const steps = (gates.children ?? []).flatMap(property => {
    const [key, value] = property.children ?? [];
    const entry =
      value?.type === "object"
        ? findNodeAtLocation(value, [EDIT_TIME_MOMENT])
        : undefined;
    return key === undefined || entry === undefined
      ? []
      : [
          {
            gate: String(key.value),
            step: entryStep(String(key.value), entry, agents),
          },
        ];
  });
  const refused = steps.flatMap(({ step }) =>
    step.kind === "refuse" ? [step.why] : []
  );
  if (refused.length > 0) {
    return {
      problem: `In ${GATES_DECLARATION_PATH}, ${refused.join(", and ")}, so the file was left untouched.`,
    };
  }
  const named = steps.flatMap(({ gate, step }) =>
    step.kind === "name" ? [{ gate, step }] : []
  );
  // One gate at a time, each against the text the one before it left, so a
  // position read from the file is never used after the file has moved.
  const next = named.reduce((current, { gate, step }) => {
    const entry = step.complete ? undefined : entryOf(current, gate);
    return entry === undefined ? current : step.write(current, entry);
  }, text);
  return {
    added: inAgentOrder(named.flatMap(({ step }) => step.missing)),
    gates: named.map(({ gate }) => gate),
    problem: null,
    text: next,
  };
}
