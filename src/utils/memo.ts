/**
 * @file memo.ts
 * @description A memo table for pure computations.
 *
 * Caching the answer of a pure function changes how long the answer takes,
 * never the answer, so the mutation is confined to this one class instead of
 * being spread through the modules that need a cache.
 * @module utils
 */

/** The subset of `Map`/`WeakMap` a memo table stores its answers in. */
export interface MemoStore<K, V> {
  /** Returns the remembered value for a key, if any. */
  get(key: K): V | undefined;
  /** Remembers a value for a key. */
  set(key: K, value: V): unknown;
}

/**
 * Remembers the result of a pure computation per key. A computation that
 * returns `undefined` is never remembered, so it runs again on the next call.
 */
export class Memo<K, V> {
  /**
   * Creates a memo table.
   * @param store - Where answers are kept; a `WeakMap` lets object keys be collected
   */
  constructor(private readonly store: MemoStore<K, V> = new Map<K, V>()) {}

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
