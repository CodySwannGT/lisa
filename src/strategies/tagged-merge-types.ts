/**
 * @file tagged-merge-types.ts
 * @description Type definitions for the tagged-merge strategy
 * @module strategies
 */

/**
 * Behavior types for tagged sections, controlling how Lisa merges content
 * @remarks
 * - `force`: Lisa's values replace project's entirely (for governance-critical configs)
 * - `defaults`: Project can override, Lisa provides fallback (for sensible defaults)
 * - `merge`: Arrays combined from both sources with deduplication (for shared lists)
 */
export type BehaviorType = "force" | "defaults" | "merge";

/**
 * Parsed information about a tagged section in a JSON file
 * @remarks
 * Represents the boundaries and metadata for a single tagged region,
 * enabling the strategy to process each section according to its behavior type.
 */
export interface TagSection {
  /** Behavior type determining how this section is merged (force, defaults, or merge) */
  behavior: BehaviorType;
  /** Category name extracted from tag (e.g., "scripts" from `//lisa-force-scripts`) */
  category: string;
  /** Ordered array of JSON keys between opening and closing tags */
  contentKeys: string[];
  /** Closing tag key (e.g., `//end-lisa-force-scripts`) for boundary detection */
  closeKey: string;
}
