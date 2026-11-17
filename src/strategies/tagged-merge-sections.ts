/**
 * @file tagged-merge-sections.ts
 * @description Pure tag parsing for the tagged-merge strategy: recognising
 * `//lisa-<behavior>-<category>` keys and locating the section each one opens.
 * @module strategies
 */
import type { BehaviorType, TagSection } from "./tagged-merge-types.js";

/**
 * Regex pattern for parsing opening tags
 * @remarks Captures behavior (force|defaults|merge) and category name for routing to appropriate merge logic
 */
const TAG_PATTERN = /^\/\/lisa-(force|defaults|merge)-(.+)$/;

/** An opening tag's parsed behavior and category. */
export interface ParsedTag {
  readonly behavior: BehaviorType;
  readonly category: string;
}

/**
 * Parse an opening tag key into its behavior and category.
 * @param key - JSON key to parse
 * @returns The tag's behavior and category, or undefined when the key is not
 *   an opening tag
 */
export function parseOpeningTag(key: string): ParsedTag | undefined {
  const match = TAG_PATTERN.exec(key);
  if (!match || !match[2]) return undefined;
  return { behavior: match[1] as BehaviorType, category: match[2] };
}

/**
 * Test if a key is an opening tag (matches `//lisa-<behavior>-<category>` format)
 * @param key - JSON key to test
 * @returns True if key matches the opening tag pattern
 */
export function isOpeningTag(key: string): boolean {
  return TAG_PATTERN.test(key);
}

/**
 * Test if a key is any tag-like comment key (starts with `//`)
 * @param key - JSON key to test
 * @returns True if key is a JSON comment (convention used for documentation/tags)
 */
export function isTagKey(key: string): boolean {
  return key.startsWith("//");
}

/**
 * Check if a value is a plain object (not array, null, or primitive)
 * @param value - Value to check
 * @returns True if value is a plain object
 */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if an object contains any nested tags
 * @param obj - Object to check
 * @returns True if object has opening tags as properties
 */
export function hasNestedTags(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some(isOpeningTag);
}

/**
 * Get the destination object for a key, or empty object if not found
 * @param dest - Destination object
 * @param key - Key to look for
 * @returns Destination object or empty object
 */
export function getDestinationObject(
  dest: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const destValue = dest[key];
  return isPlainObject(destValue) ? destValue : {};
}

/**
 * Parse JSON object to extract all tagged sections with their boundaries
 * @param obj - JSON object to parse for tag markers
 * @returns Map of opening tag keys to section info (behavior, category, content keys, close key)
 * @remarks
 * Relies on JSON key ordering being preserved (standard in modern JS engines).
 * Skips sections without matching closing tags to handle malformed input gracefully.
 */
export function parseTaggedSections(
  obj: Record<string, unknown>
): Map<string, TagSection> {
  const keys: string[] = Object.keys(obj);
  return new Map(
    keys.flatMap((key, i) => {
      const tag = parseOpeningTag(key);
      if (tag === undefined) return [];
      const closeKey = `//end-lisa-${tag.behavior}-${tag.category}`;
      const closeIndex = keys.indexOf(closeKey);
      if (closeIndex === -1) return [];
      const contentKeys = keys.slice(i + 1, closeIndex);
      return [[key, { ...tag, contentKeys, closeKey }] as const];
    })
  );
}

/**
 * Locate and extract the matching tagged section from destination JSON
 * @param dest - Project JSON to search for matching tags
 * @param section - Source section info containing behavior type
 * @param category - Tag category name to match
 * @returns Extracted section info if found, undefined if project lacks the section
 */
export function findAndExtractDestinationSection(
  dest: Record<string, unknown>,
  section: TagSection,
  category: string
): TagSection | undefined {
  const startKey = `//lisa-${section.behavior}-${category}`;
  return startKey in dest
    ? extractSectionContent(dest, startKey, section.behavior, category)
    : undefined;
}

/**
 * Extract section boundaries and content keys between opening and closing tags
 * @param obj - Object containing the tagged section
 * @param startKey - Opening tag key that marks section start
 * @param behavior - Tag behavior type (for constructing close key)
 * @param category - Tag category name (for constructing close key)
 * @returns Complete section info including content keys between tags
 */
function extractSectionContent(
  obj: Record<string, unknown>,
  startKey: string,
  behavior: BehaviorType,
  category: string
): TagSection {
  const closeKey = `//end-lisa-${behavior}-${category}`;
  const keys: string[] = Object.keys(obj);
  const startIndex = keys.indexOf(startKey);
  const closeIndex = keys.indexOf(closeKey);
  const contentKeys =
    startIndex === -1 || closeIndex === -1 || startIndex >= closeIndex
      ? []
      : keys.slice(startIndex + 1, closeIndex);
  return { behavior, category, contentKeys, closeKey };
}
