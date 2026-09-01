/**
 * Strict, ambiguity-free surgical editing for UI config documents.
 *
 * Strict parsing and the prospective semantic edit stay paired here so the
 * source-relative planner can be checked by reparsing before publication.
 * @module cli/ui-config-write-document
 */
import { applyEdits, parseTree, type Node as JsonNode } from "jsonc-parser";
import {
  getAtPropertyPath,
  isJsonObject,
  jsonEquals,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";
import {
  planConfigTextEdits,
  type ConfigDocumentEdit,
} from "./ui-config-write-patch-plan.js";

/** Minimum source image needed for one surgical render. */
export interface ConfigDocumentSource {
  /** Fixed public filename used only in safe diagnostics. */
  readonly filename: string;
  /** Strict UTF-8 JSON source. */
  readonly text: string;
  /** Semantic source document paired with the text. */
  readonly document: JsonObject;
}

/** Fully checked textual and semantic prospective document. */
export interface RenderedConfigDocument {
  /** Surgical strict-JSON text ready for atomic persistence. */
  readonly text: string;
  /** Reparsing result proven structurally equal to the requested edits. */
  readonly document: JsonObject;
  /** Whether any owner set or non-owner cleanup changed the source. */
  readonly changed: boolean;
}

/** Running semantic state before source-relative text edits are planned. */
interface SemanticState {
  readonly document: JsonObject;
  readonly changed: boolean;
  readonly touched: readonly ConfigDocumentEdit[];
}

/**
 * Parse one strict, unambiguous object document.
 *
 * `JSON.parse` deliberately accepts duplicate object properties using
 * last-value-wins semantics, while a positional syntax-tree lookup can select
 * an earlier occurrence. Rejecting duplicates prevents those two views from
 * claiming a successful write to different semantic documents.
 * @param text - Strict JSON source or rendered candidate
 * @param filename - Safe fixed filename used in diagnostics
 * @returns Parsed JSON object with exactly one value per property
 */
export function parseConfigDocument(
  text: string,
  filename: string
): JsonObject {
  const parsed = parseUnambiguousJson(text, filename);
  if (!isJsonObject(parsed)) {
    throw new Error(`${filename} must contain a JSON object`);
  }
  return parsed;
}

/**
 * Parse strict JSON while refusing recursively duplicated property names.
 *
 * This remains separate from the object-document contract because HTTP input
 * must reject ambiguity before payload shape validation, while preserving the
 * existing shape-specific 400 responses for valid arrays and scalars.
 * @param text - Strict JSON source from a bounded, fatal UTF-8 decode
 * @param filename - Safe fixed label used in diagnostics
 * @returns Parsed JSON value with exactly one value per object property
 */
export function parseUnambiguousJson(text: string, filename: string): unknown {
  const parsed = JSON.parse(text) as unknown;
  const tree = parseTree(text, [], {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (tree === undefined || hasDuplicateObjectKey(tree)) {
    throw new Error(`${filename} contains duplicate object keys`);
  }
  return parsed;
}

/**
 * Apply owner sets after non-owner removals and prove both representations
 * agree. Ordering is significant for overlapping ancestor/descendant inputs.
 * @param source - Strict source image to edit
 * @param removals - Routed owner paths removed from this non-owner document
 * @param changes - Routed values owned by this document
 * @param exactRemovals - Exact property paths whose segments may contain dots
 * @returns Reparsing-verified prospective document and surgical text
 */
export function renderConfigChanges(
  source: ConfigDocumentSource,
  removals: readonly string[],
  changes: Readonly<Record<string, JsonValue>>,
  exactRemovals: readonly (readonly string[])[] = []
): RenderedConfigDocument {
  const edits: readonly ConfigDocumentEdit[] = [
    ...removals.map(key => ({ kind: "remove", path: key.split(".") }) as const),
    ...exactRemovals.map(path => ({ kind: "remove", path }) as const),
    ...Object.entries(changes).map(
      ([key, value]) => ({ kind: "set", path: key.split("."), value }) as const
    ),
  ];
  const prospective = edits.reduce<SemanticState>(
    (state, edit) => applySemanticEdit(state, edit),
    {
      document: source.document,
      changed: false,
      touched: [],
    }
  );
  if (!prospective.changed) {
    return { text: source.text, document: source.document, changed: false };
  }
  const tree = requireConfigTree(source.text, source.filename);
  const textEdits = planConfigTextEdits(
    source.text,
    tree,
    source.document,
    prospective.document,
    prospective.touched
  );
  const renderedText = applyEdits(source.text, [...textEdits]);
  const reparsed = parseConfigDocument(renderedText, source.filename);
  if (!jsonEquals(reparsed, prospective.document)) {
    throw new Error(`${source.filename} surgical edit was ambiguous`);
  }
  return { text: renderedText, document: reparsed, changed: true };
}

/**
 * Detect ambiguity recursively because a changed path may sit below a duplicate
 * ancestor even when its own final property appears only once.
 * @param node - Strict JSON syntax tree node
 * @returns Whether any object contains the same property more than once
 */
function hasDuplicateObjectKey(node: JsonNode): boolean {
  if (node.type === "object") {
    const keys = (node.children ?? [])
      .map(property => property.children?.[0]?.value)
      .filter((key): key is string => typeof key === "string");
    if (new Set(keys).size !== keys.length) {
      return true;
    }
  }
  return (node.children ?? []).some(hasDuplicateObjectKey);
}

/**
 * Apply one edit to the prospective object before planning source ranges.
 * @param state - Semantic result accumulated from earlier ordered edits
 * @param edit - Owner set or non-owner removal
 * @returns Prospective state plus only the edits that changed semantics
 */
function applySemanticEdit(
  state: SemanticState,
  edit: ConfigDocumentEdit
): SemanticState {
  if (edit.kind === "remove") {
    assertRemovalPathIsReachable(state.document, edit.path);
  }
  const current = getAtPropertyPath(state.document, edit.path);
  if (
    (edit.kind === "remove" && current === undefined) ||
    (edit.kind === "set" && jsonEquals(current, edit.value))
  ) {
    return state;
  }
  return {
    document:
      edit.kind === "remove"
        ? removeAtPropertyPath(state.document, edit.path)
        : setAtPropertyPath(state.document, edit.path, edit.value),
    changed: true,
    touched: [...state.touched, edit],
  };
}

/**
 * Reparse the already validated source into the positional tree used for edits.
 * @param text - Original strict JSON bytes decoded as text
 * @param filename - Safe fixed filename used in diagnostics
 * @returns Root object node whose offsets all refer to the original text
 */
function requireConfigTree(text: string, filename: string): JsonNode {
  const tree = parseTree(text, [], {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (tree?.type !== "object") {
    throw new Error(`${filename} must contain a JSON object`);
  }
  return tree;
}

/**
 * Refuse descendant cleanup when a scalar or array ancestor shadows its owner.
 * Deleting that ancestor would also delete data outside the routed path, while
 * treating the cleanup as a no-op would leave overlay precedence unchanged.
 * @param root - Non-owner document being reconciled
 * @param propertyPath - Exact routed owner path that must become absent here
 */
function assertRemovalPathIsReachable(
  root: JsonObject,
  propertyPath: readonly string[]
): void {
  const ancestors = propertyPath.slice(0, -1);
  assertObjectAncestors(root, ancestors);
}

/**
 * Walk only present ancestors: an absent branch cannot shadow anything, while
 * every present branch must remain an object for exact descendant removal.
 * @param node - Present object at the current path depth
 * @param segments - Remaining ancestor segments before the routed leaf
 */
function assertObjectAncestors(
  node: JsonObject,
  segments: readonly string[]
): void {
  const [head, ...rest] = segments;
  if (head === undefined) return;
  const child = node[head];
  if (child === undefined) return;
  if (!isJsonObject(child)) {
    throw new Error("Config owner cleanup is blocked by a non-object ancestor");
  }
  assertObjectAncestors(child, rest);
}

/**
 * Remove exactly one property path while retaining every ancestor and sibling.
 * @param root - Prospective object to copy
 * @param propertyPath - Exact path being removed from the non-owner document
 * @returns Object without that path and with unrelated siblings intact
 */
function removeAtPropertyPath(
  root: JsonObject,
  propertyPath: readonly string[]
): JsonObject {
  const [head, ...rest] = propertyPath;
  if (head === undefined) {
    throw new Error("Config root removal is not writable");
  }
  if (rest.length === 0) {
    const { [head]: _removed, ...remaining } = root;
    return remaining;
  }
  const child = root[head];
  if (!isJsonObject(child)) {
    return root;
  }
  return { ...root, [head]: removeAtPropertyPath(child, rest) };
}

/**
 * Immutably set an exact property path, creating missing object ancestors.
 * @param root - Object to copy
 * @param propertyPath - Exact decoded property names
 * @param value - JSON value to write
 * @returns Updated object
 */
function setAtPropertyPath(
  root: JsonObject,
  propertyPath: readonly string[],
  value: JsonValue
): JsonObject {
  const [head, ...rest] = propertyPath;
  if (head === undefined) {
    if (!isJsonObject(value)) {
      throw new Error("Config root replacement requires an object value");
    }
    return value;
  }
  if (rest.length === 0) {
    return { ...root, [head]: value };
  }
  const child = root[head];
  return {
    ...root,
    [head]: setAtPropertyPath(isJsonObject(child) ? child : {}, rest, value),
  };
}
