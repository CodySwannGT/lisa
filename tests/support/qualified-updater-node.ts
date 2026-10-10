/** Keep updater fixtures on their real qualified runtime under a Node24 suite. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

const QUALIFIED_VERSION = "22.23.3";

/**
 * Resolve and probe the actual updater executable without fabricating identity.
 * @returns Native path, observed version and actual executable SHA256
 */
export function qualifiedUpdaterNode(): {
  readonly path: string;
  readonly version: string;
  readonly sha256: string;
} {
  const requested =
    process.env["LISA_TEST_UPDATER_NODE"] ??
    (process.versions.node === QUALIFIED_VERSION
      ? process.execPath
      : undefined);
  if (requested === undefined || !isAbsolute(requested)) {
    throw new Error(
      "Set LISA_TEST_UPDATER_NODE to the absolute qualified Node22.23.3 executable; the outer suite may use Node24."
    );
  }
  const path = realpathSync(requested);
  const version = boundedExecFileSync({
    label: "probe actual qualified updater Node",
    command: path,
    args: ["-p", "process.versions.node"],
  }).trim();
  if (version !== QUALIFIED_VERSION) {
    throw new Error(
      `Updater fixture requires ${QUALIFIED_VERSION}; observed ${version}`
    );
  }
  return {
    path,
    version,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}
