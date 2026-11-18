/**
 * @file memo.ts
 * @description A memo table for pure computations.
 *
 * Caching the answer of a pure function changes how long the answer takes,
 * never the answer, so the mutation is confined to this one class instead of
 * being spread through the modules that need a cache.
 * @module utils
 */

/**
 * Remembers the result of a pure computation per key. A computation that
 * returns `undefined` is never remembered, so it runs again on the next call.
 */
export class Memo<K, V> {
  /** Where answers are kept. */
  private readonly store = new Map<K, V>();

  /**
   * Returns the remembered answer for a key, computing and remembering it on a miss.
   * @param key - The input the answer depends on
   * @param compute - The pure computation that produces the answer
   * @returns The answer for `key`
   */
  resolve(key: K, compute: (key: K) => V): V {
    const remembered = this.store.get(key);
    if (remembered !== undefined) return remembered;
    const value = compute(key);
    this.store.set(key, value);
    return value;
  }
}
