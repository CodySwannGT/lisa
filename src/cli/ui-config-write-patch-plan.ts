/**
 * @file ui-config-write-patch-plan.ts
 * @description Deterministic non-overlapping patch planning for UI config JSON.
 * @module cli/ui-config-write-patch-plan
 */
import {
  findNodeAtLocation,
  type Edit as JsonTextEdit,
  type Node as JsonNode,
} from "jsonc-parser";
import {
  getAtPropertyPath,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";
import {
  planObjectPatchEdits,
  serializeConfigValue,
  type ConfigPatch,
  type ObjectPatchGroup,
} from "./ui-config-write-property-edits.js";

/** One requested semantic mutation in endpoint order. */
export type ConfigDocumentEdit =
  | { readonly kind: "remove"; readonly path: readonly string[] }
  | {
      readonly kind: "set";
      readonly path: readonly string[];
      readonly value: JsonValue;
    };

/**
 * Plan every changed path against one immutable original syntax tree.
 *
 * Missing descendants collapse to the first absent/non-object branch, so a
 * formatter never needs to borrow and replace an unrelated sibling for context.
 * @param text - Original strict JSON text
 * @param tree - Original syntax tree whose offsets refer to `text`
 * @param source - Original semantic document
 * @param prospective - Final semantic document after ordered edits
 * @param touched - Ordered edits that changed semantics
 * @returns Deterministic non-overlapping original-offset text edits
 */
export function planConfigTextEdits(
  text: string,
  tree: JsonNode,
  source: JsonObject,
  prospective: JsonObject,
  touched: readonly ConfigDocumentEdit[]
): readonly JsonTextEdit[] {
  const patches = collapseConfigPatches(source, prospective, touched);
  const planned = patches.reduce<{
    readonly replacements: readonly JsonTextEdit[];
    readonly groups: readonly ObjectPatchGroup[];
  }>((plan, patch) => planConfigPatch(tree, plan, patch), {
    replacements: [],
    groups: [],
  });
  return [
    ...planned.replacements,
    ...planned.groups.flatMap(group => planObjectPatchEdits(text, tree, group)),
  ];
}

/**
 * Collapse overlapping changes to the shallowest original source property.
 * @param source - Original semantic document
 * @param prospective - Final semantic document after ordered edits
 * @param touched - Ordered edits that actually changed semantics
 * @returns Stable property patches with no ancestor/descendant overlap
 */
function collapseConfigPatches(
  source: JsonObject,
  prospective: JsonObject,
  touched: readonly ConfigDocumentEdit[]
): readonly ConfigPatch[] {
  const candidates = touched.map((edit, order): ConfigPatch => {
    const requestedPath = edit.path;
    const path =
      edit.kind === "remove"
        ? requestedPath
        : findSetPatchPath(source, requestedPath);
    return { path, value: getAtPropertyPath(prospective, path), order };
  });
  const collapsed = [...candidates]
    .sort(
      (left, right) =>
        left.path.length - right.path.length || left.order - right.order
    )
    .reduce<readonly ConfigPatch[]>((patches, candidate) => {
      return patches.some(patch => isPathPrefix(patch.path, candidate.path))
        ? patches
        : [...patches, candidate];
    }, []);
  return [...collapsed].sort((left, right) => left.order - right.order);
}

/**
 * Find the shallowest property whose replacement can express a set operation.
 * @param node - Original value at the current path depth
 * @param segments - Remaining requested dot-path segments
 * @param prefix - Original path already proven to contain objects
 * @returns Existing leaf or first missing/non-object branch to replace
 */
function findSetPatchPath(
  node: JsonObject,
  segments: readonly string[],
  prefix: readonly string[] = []
): readonly string[] {
  const [head, ...rest] = segments;
  if (head === undefined) return prefix;
  const path = [...prefix, head];
  if (rest.length === 0) return path;
  const child = node[head];
  return isJsonObject(child) ? findSetPatchPath(child, rest, path) : path;
}

/**
 * Compare dot paths without joining them into ambiguous strings.
 * @param prefix - Candidate ancestor path
 * @param candidate - Candidate descendant path
 * @returns Whether every prefix segment matches the candidate
 */
function isPathPrefix(
  prefix: readonly string[],
  candidate: readonly string[]
): boolean {
  return (
    prefix.length <= candidate.length &&
    prefix.every((segment, index) => candidate[index] === segment)
  );
}

/**
 * Plan one patch as an existing value replacement or grouped child mutation.
 * @param tree - Original strict-JSON syntax tree
 * @param plan - Replacements and object groups accumulated so far
 * @param plan.replacements - Existing-value edits accumulated so far
 * @param plan.groups - Direct object-child mutations accumulated so far
 * @param patch - Collapsed semantic patch
 * @returns Plan including this patch
 */
function planConfigPatch(
  tree: JsonNode,
  plan: {
    readonly replacements: readonly JsonTextEdit[];
    readonly groups: readonly ObjectPatchGroup[];
  },
  patch: ConfigPatch
): {
  readonly replacements: readonly JsonTextEdit[];
  readonly groups: readonly ObjectPatchGroup[];
} {
  const valueNode = findNodeAtLocation(tree, [...patch.path]);
  if (valueNode !== undefined && patch.value !== undefined) {
    return {
      ...plan,
      replacements: [
        ...plan.replacements,
        {
          offset: valueNode.offset,
          length: valueNode.length,
          content: serializeConfigValue(patch.value),
        },
      ],
    };
  }
  const parentPath = patch.path.slice(0, -1);
  const key = patch.path.at(-1);
  if (key === undefined) {
    throw new Error("Config root replacement is not writable");
  }
  return {
    ...plan,
    groups: addObjectPatch(
      plan.groups,
      parentPath,
      key,
      patch,
      valueNode !== undefined
    ),
  };
}

/**
 * Add one insertion or removal to an immutable parent-object group.
 * @param groups - Groups accumulated for earlier patches
 * @param parentPath - Original object that owns the direct property
 * @param key - Direct property name
 * @param patch - Final insertion value and stable request order
 * @param removesExisting - Whether the original tree contains this property
 * @returns Groups including this mutation
 */
function addObjectPatch(
  groups: readonly ObjectPatchGroup[],
  parentPath: readonly string[],
  key: string,
  patch: ConfigPatch,
  removesExisting: boolean
): readonly ObjectPatchGroup[] {
  const existing = groups.find(group =>
    pathsEqual(group.parentPath, parentPath)
  );
  const next: ObjectPatchGroup = {
    parentPath,
    removals: removesExisting
      ? [...(existing?.removals ?? []), key]
      : (existing?.removals ?? []),
    insertions: removesExisting
      ? (existing?.insertions ?? [])
      : [...(existing?.insertions ?? []), patch],
  };
  return existing === undefined
    ? [...groups, next]
    : groups.map(group =>
        pathsEqual(group.parentPath, parentPath) ? next : group
      );
}

/**
 * Compare two syntax-tree paths exactly.
 * @param left - First path
 * @param right - Second path
 * @returns Whether both contain the same segments in the same order
 */
function pathsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => right[index] === segment)
  );
}
