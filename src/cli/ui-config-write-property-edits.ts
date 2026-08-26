/**
 * @file ui-config-write-property-edits.ts
 * @description Minimal strict-JSON property edits against original source offsets.
 * @module cli/ui-config-write-property-edits
 */
import {
  findNodeAtLocation,
  type Edit as JsonTextEdit,
  type Node as JsonNode,
} from "jsonc-parser";
import type { JsonValue } from "../sync/json-path.js";

/** One minimal source-relative property mutation after overlap collapse. */
export interface ConfigPatch {
  /** Original syntax-tree path to replace, remove, or insert. */
  readonly path: readonly string[];
  /** Final value, or undefined when the property must be absent. */
  readonly value: JsonValue | undefined;
  /** Stable request order used for grouped insertions. */
  readonly order: number;
}

/** Direct child mutations sharing one original object node. */
export interface ObjectPatchGroup {
  /** Original path of the object containing the direct children. */
  readonly parentPath: readonly string[];
  /** Direct property names to remove. */
  readonly removals: readonly string[];
  /** Missing direct properties to insert in request order. */
  readonly insertions: readonly ConfigPatch[];
}

/**
 * Plan direct child changes inside one original object.
 * @param text - Original strict JSON text
 * @param tree - Original syntax tree
 * @param group - Direct removals and insertions for one object
 * @returns Minimal edits for this object, all against original offsets
 */
export function planObjectPatchEdits(
  text: string,
  tree: JsonNode,
  group: ObjectPatchGroup
): readonly JsonTextEdit[] {
  const objectNode = findObjectNode(tree, group.parentPath);
  const properties = objectNode.children ?? [];
  const kept = properties.filter(
    property => !group.removals.includes(propertyKey(property))
  );
  if (
    properties.length > 0 &&
    kept.length === 0 &&
    group.insertions.length > 0
  ) {
    const first = requireNode(properties[0]);
    const last = requireNode(properties.at(-1));
    return [
      {
        offset: first.offset,
        length: nodeEnd(last) - first.offset,
        content: renderInsertedProperties(text, objectNode, group.insertions),
      },
    ];
  }
  return [
    ...planPropertyRemovals(text, properties, group.removals),
    ...planPropertyInsertions(
      text,
      objectNode,
      properties,
      kept,
      group.insertions
    ),
  ];
}

/**
 * Serialize a JSON value while refusing the impossible `undefined` result.
 * @param value - Registry-validated JSON value
 * @returns Strict JSON syntax for only the targeted value span
 */
export function serializeConfigValue(value: JsonValue): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Config value is not JSON-serializable");
  }
  return serialized;
}

/**
 * Resolve and require an original object node at a property path.
 * @param tree - Original strict-JSON syntax tree
 * @param path - Object property path
 * @returns Original object node at that path
 */
function findObjectNode(tree: JsonNode, path: readonly string[]): JsonNode {
  const node = path.length === 0 ? tree : findNodeAtLocation(tree, [...path]);
  if (node?.type !== "object") {
    throw new Error("Config surgical edit parent is not an object");
  }
  return node;
}

/**
 * Require a syntax node that an earlier length check proved exists.
 * @param node - Candidate property node
 * @returns Present node or a deterministic planning failure
 */
function requireNode(node: JsonNode | undefined): JsonNode {
  if (node === undefined) {
    throw new Error("Config surgical edit lost its source property");
  }
  return node;
}

/**
 * Read a property node's decoded key.
 * @param property - Original direct property node
 * @returns Decoded strict-JSON property name
 */
function propertyKey(property: JsonNode): string {
  const key = property.children?.[0]?.value;
  if (property.type !== "property" || typeof key !== "string") {
    throw new Error("Config surgical edit encountered an invalid property");
  }
  return key;
}

/**
 * Compute a node's exclusive original-text end offset.
 * @param node - Original syntax-tree node
 * @returns First source offset after the node
 */
function nodeEnd(node: JsonNode): number {
  return node.offset + node.length;
}

/**
 * Delete consecutive target properties with one delimiter-aware edit per run.
 * @param text - Original strict JSON text
 * @param properties - Direct properties in original source order
 * @param removalKeys - Direct keys absent from the prospective object
 * @returns Non-overlapping deletions that retain every kept property byte
 */
function planPropertyRemovals(
  text: string,
  properties: readonly JsonNode[],
  removalKeys: readonly string[]
): readonly JsonTextEdit[] {
  const indices = properties
    .map((property, index) =>
      removalKeys.includes(propertyKey(property)) ? index : -1
    )
    .filter(index => index >= 0);
  const runs = indices.reduce<readonly (readonly [number, number])[]>(
    (result, index) => {
      const previous = result.at(-1);
      return previous !== undefined && previous[1] + 1 === index
        ? [...result.slice(0, -1), [previous[0], index] as const]
        : [...result, [index, index] as const];
    },
    []
  );
  return runs.map(([firstIndex, lastIndex]) => {
    const first = requireNode(properties[firstIndex]);
    const last = requireNode(properties[lastIndex]);
    const next = properties[lastIndex + 1];
    if (next !== undefined) {
      return {
        offset: first.offset,
        length: next.offset - first.offset,
        content: "",
      };
    }
    const previous = properties[firstIndex - 1];
    if (previous === undefined) {
      return {
        offset: first.offset,
        length: nodeEnd(last) - first.offset,
        content: "",
      };
    }
    const comma = requireComma(text, nodeEnd(previous), first.offset);
    return { offset: comma, length: nodeEnd(last) - comma, content: "" };
  });
}

/**
 * Locate the strict-JSON comma separating adjacent property nodes.
 * @param text - Original strict JSON text
 * @param start - End offset of the preceding property
 * @param end - Start offset of the following property
 * @returns Comma offset between those properties
 */
function requireComma(text: string, start: number, end: number): number {
  const comma = text.indexOf(",", start);
  if (comma === -1 || comma >= end) {
    throw new Error("Config surgical edit could not locate a property comma");
  }
  return comma;
}

/**
 * Insert missing properties beside a retained anchor or inside an empty object.
 * @param text - Original strict JSON text
 * @param objectNode - Original parent object
 * @param properties - All original direct properties
 * @param kept - Direct properties not removed by this transaction
 * @param insertions - Missing properties with final prospective values
 * @returns Zero or one source-relative insertion
 */
function planPropertyInsertions(
  text: string,
  objectNode: JsonNode,
  properties: readonly JsonNode[],
  kept: readonly JsonNode[],
  insertions: readonly ConfigPatch[]
): readonly JsonTextEdit[] {
  if (insertions.length === 0) return [];
  const content = renderInsertedProperties(text, objectNode, insertions);
  const anchor = kept.at(-1);
  if (anchor !== undefined) {
    return [
      {
        offset: nodeEnd(anchor),
        length: 0,
        content: `${inferPropertySeparator(text, objectNode, properties)}${content}`,
      },
    ];
  }
  const interior = text.slice(objectNode.offset + 1, nodeEnd(objectNode) - 1);
  const prefix = interior.includes("\n")
    ? `${inferEol(text)}${inferChildIndent(text, objectNode)}`
    : "";
  return [
    {
      offset: objectNode.offset + 1,
      length: 0,
      content: `${prefix}${content}`,
    },
  ];
}

/**
 * Render only new property syntax; existing property text never enters here.
 * @param text - Original strict JSON text
 * @param objectNode - Parent object supplying separator style
 * @param insertions - Missing properties in stable request order
 * @returns Strict JSON property fragments
 */
function renderInsertedProperties(
  text: string,
  objectNode: JsonNode,
  insertions: readonly ConfigPatch[]
): string {
  const separator = inferPropertySeparator(
    text,
    objectNode,
    objectNode.children ?? []
  );
  return insertions
    .map(patch => {
      const key = patch.path.at(-1);
      if (key === undefined || patch.value === undefined) {
        throw new Error("Config insertion is missing a property value");
      }
      return `${JSON.stringify(key)}: ${serializeConfigValue(patch.value)}`;
    })
    .join(separator);
}

/**
 * Reuse an original property separator, falling back to inferred indentation.
 * @param text - Original strict JSON text
 * @param objectNode - Parent object supplying the fallback style
 * @param properties - Original direct properties
 * @returns Comma plus whitespace before the next property
 */
function inferPropertySeparator(
  text: string,
  objectNode: JsonNode,
  properties: readonly JsonNode[]
): string {
  const [first, second] = properties;
  if (first !== undefined && second !== undefined) {
    const comma = requireComma(text, nodeEnd(first), second.offset);
    return text.slice(comma, second.offset);
  }
  if (first === undefined) return ",";
  const prefix = text.slice(objectNode.offset + 1, first.offset);
  if (prefix.includes("\n")) {
    return `,${inferEol(text)}${lineIndentAt(text, first.offset)}`;
  }
  return prefix.length > 0 ? `,${prefix}` : ",";
}

/**
 * Infer the original newline sequence without normalizing source bytes.
 * @param text - Original strict JSON text
 * @returns CRLF when present, otherwise LF
 */
function inferEol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Read exact indentation immediately before a node on its source line.
 * @param text - Original strict JSON text
 * @param offset - Node start offset
 * @returns Whitespace-only line prefix, or empty for inline nodes
 */
function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const prefix = text.slice(lineStart, offset);
  return /^[ \t]*$/u.test(prefix) ? prefix : "";
}

/**
 * Infer one child indentation level for a genuinely empty multiline object.
 * @param text - Original strict JSON text
 * @param objectNode - Empty object receiving its first property
 * @returns Parent indentation plus the document's indentation unit
 */
function inferChildIndent(text: string, objectNode: JsonNode): string {
  const indentation = /\r?\n([ \t]+)"/u.exec(text)?.[1] ?? "  ";
  return `${lineIndentAt(text, objectNode.offset)}${indentation}`;
}
