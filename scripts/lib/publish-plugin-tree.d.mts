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

/** Whether the owner process is confirmed gone: only ESRCH confirms it. */
export function ownerGone(
  pid: number,
  probe?: (pid: number, signal: number) => unknown
): boolean;

/** Remove staging areas whose owning build is confirmed gone. */
export function clearStaleStages(
  pluginsDir: string,
  probe?: (pid: number, signal: number) => unknown
): readonly string[];

/** Run `work` while holding the checkout-wide publish lock. */
export function withPublishLock<T>(
  pluginsDir: string,
  work: () => T,
  options?: {
    waitMs?: number;
    probe?: (pid: number, signal: number) => unknown;
  }
): T;
