/** Keep updater fixtures on their real qualified runtime under a Node24 suite. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { boundedExecFileSync } from "../helpers/io-latency-budget.js";
import { deferToCi, installedMiseRuntime, isCiRun } from "./ci-runtime.js";

const QUALIFIED_VERSION = "22.23.3";

// Off CI only (the CI workflow provisions it and exports the variable), and
// resolved at import, under the inherited PATH: some fixtures narrow PATH to
// prove a tool is absent before they ask for this runtime.
const LOCAL_MISE_UPDATER = isCiRun()
  ? undefined
  : installedMiseRuntime("node", QUALIFIED_VERSION, "node");

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
      : undefined) ??
    LOCAL_MISE_UPDATER;
  if (requested === undefined || !isAbsolute(requested)) {
    return deferToCi(
      `the qualified updater Node ${QUALIFIED_VERSION}`,
      `Run \`mise install node@${QUALIFIED_VERSION}\`, or set LISA_TEST_UPDATER_NODE to its absolute executable; the outer suite may use Node24.`
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
