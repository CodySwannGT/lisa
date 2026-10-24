/** Select a genuine compatible Bun for native inherited-host checks. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { satisfies } from "semver";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

/** Inherited Harper and Phaser hosts declare this Bun floor. */
const HOST_BUN_FLOOR = ">=1.3.11";

/**
 * Probe the Bun native host checks run on. `LISA_TEST_HOST_BUN` selects an
 * explicit executable; otherwise it is the Bun running this suite, since
 * Lisa's own pinned Bun meets the host floor. Either way the floor is checked
 * against the executable's own report, never assumed.
 * @returns Actual native path, observed version and executable digest
 */
export function qualifiedHostBun(): {
  readonly path: string;
  readonly version: string;
  readonly sha256: string;
} {
  const requested = process.env["LISA_TEST_HOST_BUN"];
  if (requested !== undefined && !isAbsolute(requested))
    throw new Error(
      `LISA_TEST_HOST_BUN must be an absolute Bun executable meeting the inherited host floor ${HOST_BUN_FLOOR}.`
    );
  const path = realpathSync(
    requested ??
      boundedExecFileSync({
        label: "locate the suite's own Bun",
        command: "bun",
        args: ["-p", "process.execPath"],
      }).trim()
  );
  const version = boundedExecFileSync({
    label: "probe actual native host Bun",
    command: path,
    args: ["--version"],
  }).trim();
  if (!satisfies(version, HOST_BUN_FLOOR))
    throw new Error(
      `Native host Bun floor is ${HOST_BUN_FLOOR}; observed ${version}`
    );
  return {
    path,
    version,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}
