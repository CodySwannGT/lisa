/**
 * Strict, ambiguity-free surgical editing for UI config documents.
 *
 * Keeping the textual edit and semantic-object edit in one module matters:
 * `jsonc-parser` preserves hand-authored bytes, but its duplicate-key lookup can
 * disagree with `JSON.parse`. Every result is therefore reparsed and compared
 * before the persistence layer is allowed to publish it.
 * @module cli/ui-config-write-document
 */
import {
  applyEdits,
  modify,
  parseTree,
  type FormattingOptions,
  type Node as JsonNode,
} from "jsonc-parser";
import {
  getAtPath,
  isJsonObject,
  jsonEquals,
  setAtPath,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";

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

/** Running state for ordered, overlapping dot-path edits. */
interface RenderState {
  readonly text: string;
  readonly document: JsonObject;
  readonly changed: boolean;
}

/** One ordered mutation applied to a surgical config render. */
type ConfigEdit =
  | { readonly kind: "remove"; readonly key: string }
  | { readonly kind: "set"; readonly key: string; readonly value: JsonValue };

/**
 * Parse one strict, unambiguous object document.
 *
 * `JSON.parse` deliberately accepts duplicate object properties using
 * last-value-wins semantics, while `jsonc-parser.modify` can edit an earlier
 * occurrence. Rejecting duplicates prevents those two views from claiming a
 * successful write to different semantic documents.
 * @param text - Strict JSON source or rendered candidate
 * @param filename - Safe fixed filename used in diagnostics
 * @returns Parsed JSON object with exactly one value per property
 */
export function parseConfigDocument(
  text: string,
  filename: string
): JsonObject {
  const parsed = JSON.parse(text) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(`${filename} must contain a JSON object`);
  }
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
 * @returns Reparsing-verified prospective document and surgical text
 */
export function renderConfigChanges(
  source: ConfigDocumentSource,
  removals: readonly string[],
  changes: Readonly<Record<string, JsonValue>>
): RenderedConfigDocument {
  const formattingOptions = inferFormatting(source.text);
  const edits: readonly ConfigEdit[] = [
    ...removals.map(key => ({ kind: "remove", key }) as const),
    ...Object.entries(changes).map(
      ([key, value]) => ({ kind: "set", key, value }) as const
    ),
  ];
  const rendered = edits.reduce<RenderState>(
    (state, edit) => applyConfigEdit(state, edit, formattingOptions),
    { text: source.text, document: source.document, changed: false }
  );
  const reparsed = parseConfigDocument(rendered.text, source.filename);
  if (!jsonEquals(reparsed, rendered.document)) {
    throw new Error(`${source.filename} surgical edit was ambiguous`);
  }
  return { ...rendered, document: reparsed };
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
 * Apply one semantic edit and its matching textual operation together.
 * @param state - Render accumulated from earlier overlapping paths
 * @param edit - Owner set or non-owner removal
 * @param formattingOptions - Existing file indentation and newline policy
 * @returns Matching text/document state after the edit
 */
function applyConfigEdit(
  state: RenderState,
  edit: ConfigEdit,
  formattingOptions: FormattingOptions
): RenderState {
  const current = getAtPath(state.document, edit.key);
  if (
    (edit.kind === "remove" && current === undefined) ||
    (edit.kind === "set" && jsonEquals(current, edit.value))
  ) {
    return state;
  }
  const value = edit.kind === "remove" ? undefined : edit.value;
  return {
    text: applyEdits(
      state.text,
      modify(state.text, edit.key.split("."), value, { formattingOptions })
    ),
    document:
      edit.kind === "remove"
        ? removeAtPath(state.document, edit.key)
        : setAtPath(state.document, edit.key, edit.value),
    changed: true,
  };
}

/**
 * Remove exactly one dot path while retaining every ancestor and sibling.
 * @param root - Prospective object to copy
 * @param dotPath - Routed owner path being removed from the non-owner document
 * @returns Object without that path and with unrelated siblings intact
 */
function removeAtPath(root: JsonObject, dotPath: string): JsonObject {
  const dotIndex = dotPath.indexOf(".");
  const head = dotIndex === -1 ? dotPath : dotPath.slice(0, dotIndex);
  const rest = dotIndex === -1 ? "" : dotPath.slice(dotIndex + 1);
  if (rest === "") {
    const { [head]: _removed, ...remaining } = root;
    return remaining;
  }
  const child = root[head];
  if (!isJsonObject(child)) {
    return root;
  }
  return { ...root, [head]: removeAtPath(child, rest) };
}

/**
 * Match inserted JSON to the document's existing indentation and newlines.
 * @param text - Existing strict JSON text
 * @returns Formatting policy used only around newly inserted syntax
 */
function inferFormatting(text: string): FormattingOptions {
  const indentation = /\n([ \t]+)"/u.exec(text)?.[1];
  const usesTabs = indentation?.includes("\t") ?? false;
  return {
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    insertSpaces: !usesTabs,
    tabSize: usesTabs ? 1 : Math.max(1, indentation?.length ?? 2),
  };
}
