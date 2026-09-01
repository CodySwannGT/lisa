/**
 * Fixtures for the enforcement fleet census.
 *
 * Checkouts are built on disk rather than mocked, because the census's whole
 * claim is that it reads what is actually there. A mocked filesystem would let
 * the suite agree with a census that had stopped looking — the failure mode the
 * census exists to end (CodySwannGT/lisa#3490).
 * @module tests/helpers/enforcement-census-fixtures
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ENFORCEMENT_GUARDS } from "../../src/core/enforcement-coverage.js";

/** Every guard the dispatcher looks for, so a fixture can resolve all of them. */
export const ALL_GUARDS = [...ENFORCEMENT_GUARDS];

/** How a fixture checkout should be built. */
export interface CheckoutSpec {
  /** Directory name under the fleet root. */
  readonly name: string;
  /** Guards to write into `scripts/lisa-hooks/`. */
  readonly hostGuards?: readonly string[];
  /** Guards to write into `plugins/lisa/hooks/`. */
  readonly pluginGuards?: readonly string[];
  /** Version to record in `.lisa/apply-receipt.json`, when any. */
  readonly receiptVersion?: string;
  /** Version to record in the plugin manifest, when any. */
  readonly pluginVersion?: string;
  /** Range to declare in `package.json`, when any. */
  readonly declared?: string;
  /** Version to place under `node_modules/@codyswann/lisa`, when any. */
  readonly installed?: string;
}

/** A fleet built on disk, plus the roster naming it. */
export interface Fleet {
  /** Directory holding every checkout. */
  readonly root: string;
  /** Roster file naming the checkouts that were built. */
  readonly rosterPath: string;
  /** Absolute path of one built checkout. */
  readonly checkoutPath: (name: string) => string;
  /** Remove everything. */
  readonly cleanup: () => void;
}

/**
 * Write one guard tree.
 * @param root - Checkout root
 * @param relative - Tree location relative to the root
 * @param guards - Guards to write
 */
function writeGuards(
  root: string,
  relative: string,
  guards: readonly string[]
): void {
  if (guards.length === 0) return;
  const tree = path.join(root, relative);
  mkdirSync(tree, { recursive: true });
  for (const guard of guards) {
    writeFileSync(
      path.join(tree, `${guard}.sh`),
      "#!/usr/bin/env bash\nexit 0\n"
    );
  }
}

/**
 * Build one checkout.
 * @param root - Fleet root
 * @param spec - What to build
 * @returns The checkout path
 */
export function buildCheckout(root: string, spec: CheckoutSpec): string {
  const checkout = path.join(root, spec.name);
  mkdirSync(checkout, { recursive: true });
  writeGuards(
    checkout,
    path.join("scripts", "lisa-hooks"),
    spec.hostGuards ?? []
  );
  writeGuards(
    checkout,
    path.join("plugins", "lisa", "hooks"),
    spec.pluginGuards ?? []
  );
  if (spec.receiptVersion !== undefined) {
    mkdirSync(path.join(checkout, ".lisa"), { recursive: true });
    writeFileSync(
      path.join(checkout, ".lisa", "apply-receipt.json"),
      `${JSON.stringify({
        schema_version: 1,
        lisa_version: spec.receiptVersion,
        applied_at: "2026-01-01T00:00:00.000Z",
        harness: "fleet",
        apply_mode: "full",
        stale_paths: [],
      })}\n`
    );
  }
  if (spec.pluginVersion !== undefined) {
    const manifestDir = path.join(
      checkout,
      "plugins",
      "lisa",
      ".claude-plugin"
    );
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      path.join(manifestDir, "plugin.json"),
      `${JSON.stringify({ name: "lisa", version: spec.pluginVersion })}\n`
    );
  }
  if (spec.declared !== undefined) {
    writeFileSync(
      path.join(checkout, "package.json"),
      `${JSON.stringify({
        name: "fixture",
        dependencies: { "@codyswann/lisa": spec.declared },
      })}\n`
    );
  }
  if (spec.installed !== undefined) {
    const installedDir = path.join(
      checkout,
      "node_modules",
      "@codyswann",
      "lisa"
    );
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(
      path.join(installedDir, "package.json"),
      `${JSON.stringify({ name: "@codyswann/lisa", version: spec.installed })}\n`
    );
  }
  return checkout;
}

/**
 * Build a fleet and the roster naming it.
 *
 * The roster is written in the shape already on disk in this monorepo — an
 * object mapping checkout path to target branch — so the fixture exercises the
 * real reader rather than a convenience format.
 * @param specs - Checkouts to build
 * @param extraRosterPaths - Paths to name on the roster without building them
 * @returns The built fleet
 */
export function buildFleet(
  specs: readonly CheckoutSpec[],
  extraRosterPaths: readonly string[] = []
): Fleet {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-census-"));
  const built = specs.map(spec => buildCheckout(root, spec));
  const roster = Object.fromEntries(
    [...built, ...extraRosterPaths].map(entry => [entry, "main"])
  );
  const rosterPath = path.join(root, "roster.json");
  writeFileSync(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);
  return {
    root,
    rosterPath,
    checkoutPath: (name: string) => path.join(root, name),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
