/**
 * A write-once observation from an event-driven fixture.
 *
 * Fixtures that watch a live child (a marker file appearing, a watchdog
 * firing, an observer failing) learn a fact at some unknown moment and read it
 * once the child closes. A latch holds that fact without a mutable variable:
 * the first {@link Latch.set} settles it, later calls are ignored, and
 * {@link Latch.read} returns the settled value or the caller's fallback.
 */
export interface Latch<T> {
  /** Record the fact; only the first call counts. */
  readonly set: (value: T) => void;
  /**
   * Read the fact as of now.
   * @param fallback - Value to return when nothing was recorded
   * @returns The first recorded value, else the fallback
   */
  readonly read: (fallback: T) => Promise<T>;
}

/** The ES2024 `Promise.withResolvers` shape. */
interface Resolvers<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/**
 * `Promise.withResolvers`, which every Node line Lisa runs on implements
 * (V8 12.4, Node 22+), typed here because the repository's shared compiler
 * library stops at ES2022 for the hosts it ships to.
 */
const withResolvers = (
  Promise as PromiseConstructor & {
    readonly withResolvers: <T>() => Resolvers<T>;
  }
).withResolvers.bind(Promise);

/**
 * Create an unsettled latch.
 * @returns A latch whose first `set` wins
 */
export function latch<T>(): Latch<T> {
  const { promise, resolve } = withResolvers<T>();
  return {
    set: resolve,
    // `resolve` fulfils synchronously, and a fulfilled promise listed first
    // queues its reaction first, so it wins this race; an unsettled one loses
    // to the already-fulfilled fallback.
    read: fallback => Promise.race([promise, Promise.resolve(fallback)]),
  };
}
