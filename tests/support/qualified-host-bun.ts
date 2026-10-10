/** Select a genuine compatible Bun for native inherited-host checks. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { satisfies } from "semver";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

/**
 * Probe an explicitly supplied host executable rather than relabeling tooling.
 * @returns Actual native path, observed version and executable digest
 */
export function qualifiedHostBun(): {
  readonly path: string;
  readonly version: string;
  readonly sha256: string;
} {
  const requested = process.env["LISA_TEST_HOST_BUN"];
  if (requested === undefined || !isAbsolute(requested))
    throw new Error(
      "Set LISA_TEST_HOST_BUN to an absolute Bun executable meeting the inherited host floor >=1.3.11."
    );
  const path = realpathSync(requested);
  const version = boundedExecFileSync({
    label: "probe actual native host Bun",
    command: path,
    args: ["--version"],
  }).trim();
  if (!satisfies(version, ">=1.3.11"))
    throw new Error(`Native host Bun floor is >=1.3.11; observed ${version}`);
  return {
    path,
    version,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}
