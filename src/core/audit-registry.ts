import { auditRecord } from "./audit-exclusions.js";

/** How the audit learns which versions the registry has published. */
export type PublishedVersions = (name: string) => Promise<readonly string[]>;

/** The public npm registry, which decides whether a fixed release exists. */
export const NPM_REGISTRY = "https://registry.npmjs.org";

/** Longest the audit waits for the registry before failing closed. */
export const REGISTRY_TIMEOUT_MS = 30_000;

/**
 * A registry lookup that fails closed instead of hanging: a registry that
 * does not answer within `timeoutMs` rejects, and the audit then refuses to
 * credit a patch it cannot prove is still needed.
 * @param base - Registry base URL
 * @param timeoutMs - Milliseconds before the lookup rejects
 * @returns A lookup of every published version of a package
 */
export function registryVersionsFrom(
  base: string,
  timeoutMs: number
): PublishedVersions {
  return async name => {
    const url = `${base}/${name.replace("/", "%2f")}`;
    const response = await fetch(url, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: unknown) => {
      const timedOut = (error as Error).name === "TimeoutError";
      throw new Error(
        timedOut
          ? `registry did not answer within ${timeoutMs}ms for ${name}`
          : `registry unreachable for ${name}: ${(error as Error).message}`
      );
    });
    if (!response.ok)
      throw new Error(`registry answered ${response.status} for ${name}`);
    const body: unknown = await response.json();
    if (!auditRecord(body) || !auditRecord(body.versions))
      throw new Error(`registry returned no versions for ${name}`);
    return Object.keys(body.versions);
  };
}

/** The default lookup: the public registry, bounded by REGISTRY_TIMEOUT_MS. */
export const registryVersions: PublishedVersions = registryVersionsFrom(
  NPM_REGISTRY,
  REGISTRY_TIMEOUT_MS
);
