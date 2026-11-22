/**
 * The threshold check as a repository receives it: the three files Lisa ships
 * to every repository under `scripts/`, whatever its stack
 * (CodySwannGT/lisa#4985).
 *
 * The suites that use this install the shipped copies, not the source they
 * are built from, into a repository with no `package.json`. That is the only
 * honest way to claim the check works on a host with no supported project
 * type: it runs the bytes such a host has, with `node` and nothing else.
 * @module tests/integration/support/shipped-threshold-check
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Where Lisa keeps the files it ships to every repository. */
const SHIPPED_DIR = path.join(REPO_ROOT, "all", "copy-overwrite", "scripts");

/** The check and the two files it imports from beside itself. */
const SHIPPED = [
  "check-threshold-ratchet.mjs",
  "threshold-ratchet-compare.mjs",
  "threshold-ratchet-families.mjs",
] as const;

/** The check's path inside a repository it was shipped to. */
export const SHIPPED_CHECK = "scripts/check-threshold-ratchet.mjs";

/**
 * The shipped check as files to commit into a fixture repository.
 * @returns Repository-relative path to content, read from disk on every call
 */
export function shippedThresholdCheck(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    SHIPPED.map(name => [
      `scripts/${name}`,
      readFileSync(path.join(SHIPPED_DIR, name), "utf8"),
    ])
  );
}
