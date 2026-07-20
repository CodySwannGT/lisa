/** Best-effort directory durability without hiding genuine I/O failures. */
import { open } from "node:fs/promises";

/** Minimal directory handle used by the production opener and focused tests. */
export interface DirectorySyncHandle {
  readonly sync: () => Promise<void>;
  readonly close: () => Promise<void>;
}

/** Injectable directory opener. */
export type OpenDirectory = (
  directory: string,
  flags: string
) => Promise<DirectorySyncHandle>;

const OPEN_UNSUPPORTED = new Set([
  "EISDIR",
  "EINVAL",
  "ENOTSUP",
  "EOPNOTSUPP",
  "ENOSYS",
]);
const SYNC_UNSUPPORTED = new Set([
  "EBADF",
  "EINVAL",
  "ENOTSUP",
  "EOPNOTSUPP",
  "ENOSYS",
]);

/**
 * Flush a containing directory when the host filesystem supports it.
 * Atomic rename protects ordinary crashes. A successful directory sync adds
 * power-loss durability; known platform-level lack of support is best effort.
 * Permission, device, and other real I/O failures remain fatal.
 * @param directory - Directory containing the renamed target
 * @param openDirectory - Injectable opener used by focused fault tests
 */
export async function syncContainingDirectory(
  directory: string,
  openDirectory: OpenDirectory = open
): Promise<void> {
  const handle = await tryOpenDirectory(directory, openDirectory);
  if (handle === undefined) return;
  try {
    await handle.sync();
  } catch (error) {
    if (!hasCode(error, SYNC_UNSUPPORTED)) throw error;
  } finally {
    await handle.close();
  }
}

/**
 * Open a directory or identify a host that does not expose directory opens.
 * @param directory - Directory to open
 * @param openDirectory - Platform directory opener
 * @returns Open handle, or undefined when directory opens are unsupported
 */
async function tryOpenDirectory(
  directory: string,
  openDirectory: OpenDirectory
): Promise<DirectorySyncHandle | undefined> {
  try {
    return await openDirectory(directory, "r");
  } catch (error) {
    if (hasCode(error, OPEN_UNSUPPORTED)) return undefined;
    throw error;
  }
}

/**
 * Match a Node-style error code against a closed unsupported-code set.
 * @param error - Candidate Node-style error
 * @param codes - Closed set of recognized codes
 * @returns Whether the error carries a recognized code
 */
function hasCode(error: unknown, codes: ReadonlySet<string>): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.has(error.code)
  );
}
