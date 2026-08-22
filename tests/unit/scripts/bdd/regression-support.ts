/**
 * Fixtures for the non-regression invariants that replaced the coverage-floor
 * ratchet.
 *
 * These fixtures deliberately commit a floor of **0** by default. With the
 * absolute bar flat on the ground the deleted number-based ratchet caught
 * nothing at all, so anything the tests using them refuse is refused by the
 * replacement invariants alone rather than by the floor happening to move.
 *
 * @module tests/unit/scripts/bdd/regression-support
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { CommittedProject } from "./support";
import {
  HOME_ID,
  HOME_SPEC,
  PLAYWRIGHT,
  RATIFIED,
  WEB,
  committedFixture,
  featureSource,
  healthyProject,
  readMap,
  writeMap,
} from "./support";

export type { CommittedProject };

export const EXTRA_ID = "BDD-EXTRA-001";
export const EXTRA_FEATURE_FILE = "extra.feature";
export const EXTRA_SPEC = "e2e/extra.spec.ts";
export const EXTRA_EVIDENCE = "renders the extra page";
export const EXTRA_KEY = `${EXTRA_ID}:${WEB}`;

/** Cache key for the two-scenario base revision. */
export const TWO_SCENARIO_BASE = "two-scenario";
export const HOME_KEY = `${HOME_ID}:${WEB}`;

/** The extra scenario's feature source. */
export const EXTRA_FEATURE = featureSource("Extra", [
  { id: EXTRA_ID, tags: [WEB, RATIFIED] },
]);

/** The extra scenario's evidence file body. */
export const EXTRA_SPEC_BODY = `test("${EXTRA_EVIDENCE}", async () => {});\n`;

/** A complete waiver for the extra scenario, so only authorization is at issue. */
export const EXTRA_WAIVER = {
  scenario: EXTRA_ID,
  platforms: [WEB],
  reason: "the runner cannot reach the third-party sign-in",
  owner: "cody",
  ticket: "TUN-9",
  recordedAt: "2026-08-01",
  expiresAt: "2099-01-01",
};

/** A complete retirement record for the extra scenario. */
export const EXTRA_RETIREMENT = {
  scenario: EXTRA_ID,
  reason: "capability removed from the product",
  ticket: "TUN-5",
  approvedBy: "cody",
  recordedAt: "2026-08-12",
};

/** The extra scenario's mapping. */
export const EXTRA_MAPPING = {
  scenario: EXTRA_ID,
  runner: PLAYWRIGHT,
  platforms: [WEB],
  file: EXTRA_SPEC,
  evidence: EXTRA_EVIDENCE,
  level: "behavioral",
};

/** The home scenario's mapping, restated so a fixture can drop the other one. */
export const HOME_MAPPING = {
  scenario: HOME_ID,
  runner: PLAYWRIGHT,
  platforms: [WEB],
  file: HOME_SPEC,
  evidence: "renders the home page",
  level: "behavioral",
};

/**
 * The head mapping list with the extra scenario's proof taken away — the move
 * every "coverage was given back" case is built from.
 */
export const HOME_ONLY_MAPPINGS = [HOME_MAPPING];

/**
 * Delete the extra scenario's spec from the head revision.
 *
 * Pairs with {@link HOME_ONLY_MAPPINGS} in any case asserting a fully clean
 * run: a spec left behind with nothing mapping it is independently an
 * undisclosed test, which is a different defect from the one under test.
 * @param root - Project root.
 * @returns Nothing.
 */
export function removeExtraSpec(root: string): void {
  fs.rmSync(path.join(root, EXTRA_SPEC));
}

/**
 * Lay down a project with two mapped scenarios and a floor of 0, commit it,
 * then apply a patch to the head revision.
 *
 * Two mappings, so a case can remove one without also tripping the separate
 * "enforced mode declares zero mappings" defect and clouding the assertion.
 * The patch is a shallow merge rather than a mutator, so each case reads as
 * the head state it wants rather than as a sequence of edits.
 *
 * Every caller commits identical content — the patch and the tree edits are
 * applied to the HEAD working tree, after the commit — so the repository is
 * built once per process and copied thereafter. Two specs together call this
 * twelve times; before, that was twelve `git init` runs producing twelve
 * identical revisions (lisa#2887).
 * @param patch - Shallow overrides applied to the head coverage map.
 * @param after - Head edits that touch files rather than the map.
 * @returns Project root and base SHA.
 */
export function twoScenarioProject(
  patch: Record<string, unknown> = {},
  after: (root: string) => void = () => undefined
): CommittedProject {
  const { root, base } = committedFixture(TWO_SCENARIO_BASE, () =>
    healthyProject(
      {
        coverageFloor: { [WEB]: 0 },
        mappings: [HOME_MAPPING, EXTRA_MAPPING],
      },
      {
        features: { [EXTRA_FEATURE_FILE]: EXTRA_FEATURE },
        files: { [EXTRA_SPEC]: EXTRA_SPEC_BODY },
      }
    )
  );
  writeMap(root, { ...readMap(root), ...patch });
  after(root);
  return { root, base };
}
