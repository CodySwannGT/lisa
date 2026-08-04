/**
 * Fixtures shared by the workstation suites.
 * @module tests/unit/workstation/fixtures
 */

/** A path that stands in for "installed, somewhere ordinary". */
export const ANY_PATH = "/usr/local/bin";

/** The directory pinned, checksummed binaries land in. */
export const BIN_DIR = "/root/.local/bin";

/** A home directory to expand `~` against in assertions. */
export const HOME = "/root";

/** The install kind whose artifacts are fetched from a vendor script. */
export const VENDOR_SCRIPT = "vendor-script";

/** A stand-in installer URL; never fetched, only asserted on. */
export const SCRIPT_URL = "https://example.invalid/install.sh";

/**
 * Build probes that report a fixed set of tools as present.
 * @param present Map of tool name to the path it resolves at.
 * @returns Injectable probes.
 */
export const probes = (present: Record<string, string> = {}) => ({
  locate: (name: string) => present[name] ?? null,
  version: () => "1.2.3",
});

/** Where a base image's own git lives; the canonical "system" provenance. */
export const SYSTEM_GIT = "/usr/bin/git";

/** Where a base image's own node lives. */
export const SYSTEM_NODE = "/usr/bin/node";
