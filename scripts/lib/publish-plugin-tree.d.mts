/**
 * Types for publish-plugin-tree.mjs (CodySwannGT/lisa#4583).
 * @module scripts/lib/publish-plugin-tree
 */

/**
 * Publish a staged plugin tree over the live one. The staged tree is consumed.
 * @param stagedDir - directory holding the complete new tree
 * @param liveDir - directory sessions are reading
 */
export function publishPluginTree(stagedDir: string, liveDir: string): void;
