/**
 * The Bun install arguments every packed-host install shares
 * (CodySwannGT/lisa#4636).
 *
 * The hosts and the packed tool install Lisa through the same loopback
 * registry and the same shared cache. Deriving both argument lists from one
 * function makes that parity structural: neither can drift to another
 * registry or cache without the other.
 * @module tests/fixtures/shared-runtime-hosts/install-args
 */

/**
 * The hosts' Bun install arguments: the loopback registry, bounded network
 * concurrency and the shared cache.
 * @param registry - The loopback registry URL
 * @param cache - The shared install cache
 * @returns Arguments for `bun`
 */
export function hostInstallArgs(
  registry: string,
  cache: string
): readonly string[] {
  return [
    "install",
    "--registry",
    registry,
    "--network-concurrency",
    "8",
    "--cache-dir",
    cache,
  ];
}

/**
 * The packed tool's Bun install arguments: the hosts' own, with lifecycle
 * scripts kept off as the tool always installed.
 * @param registry - The loopback registry URL
 * @param cache - The shared install cache
 * @returns Arguments for `bun`
 */
export function toolInstallArgs(
  registry: string,
  cache: string
): readonly string[] {
  return [...hostInstallArgs(registry, cache), "--ignore-scripts"];
}
