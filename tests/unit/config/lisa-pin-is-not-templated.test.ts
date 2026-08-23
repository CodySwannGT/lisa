/**
 * @file lisa-pin-is-not-templated.test.ts
 * @description No shipped template may carry a literal `@codyswann/lisa`
 * version (#2953).
 *
 * The pin has to equal the version that performed the apply, because the
 * templates that apply just wrote call into that package's own API. A literal
 * in a template cannot know that version, so it is wrong the moment it is
 * written and gets more wrong with every release: the templates shipped
 * `^2.106.0` while the package was releasing 3.x, a range that does not even
 * admit the version doing the applying.
 *
 * `alignLisaPin` owns the pin now. This spec is what stops a well-meaning edit
 * from putting a literal back and quietly reinstating the skew — the same
 * failure the reserved-base obligations in
 * `governed-script-composition-points.test.ts` are written to prevent.
 * @module tests/unit/config/lisa-pin-is-not-templated
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import type { PackageLisaTemplate } from "../../../src/strategies/package-lisa-types.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** The package whose version an apply owns rather than a template. */
const LISA = "@codyswann/lisa";

/** Every tracked `package.lisa.json`, keyed by its repo-relative path. */
const TEMPLATE_PATHS = [
  "package.lisa.json",
  "typescript/package-lisa/package.lisa.json",
  "expo/package-lisa/package.lisa.json",
  "nestjs/package-lisa/package.lisa.json",
  "cdk/package-lisa/package.lisa.json",
  "npm-package/package-lisa/package.lisa.json",
  "phaser/package-lisa/package.lisa.json",
  "harper-fabric/package-lisa/package.lisa.json",
] as const;

/** Sections whose keys are package names mapped to version specs. */
const VERSIONED_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
  "resolutions",
] as const;

/**
 * Every place a template states a version for Lisa itself.
 * @param relativePath - Repo-relative path to the template
 * @returns One `behaviour.section` label per literal found
 */
function literalLisaPins(relativePath: string): readonly string[] {
  const template = fs.readJsonSync(
    path.join(REPO_ROOT, relativePath)
  ) as PackageLisaTemplate & Record<string, unknown>;
  return ["force", "defaults", "merge", "adopt"].flatMap(behaviour => {
    const sections = (template[behaviour] ?? {}) as Record<string, unknown>;
    return VERSIONED_SECTIONS.filter(section => {
      const block = sections[section];
      return (
        typeof block === "object" &&
        block !== null &&
        !Array.isArray(block) &&
        LISA in (block as Record<string, unknown>)
      );
    }).map(section => `${behaviour}.${section}`);
  });
}

describe("the Lisa pin belongs to the apply, not to a template", () => {
  it.each(TEMPLATE_PATHS)("%s states no literal Lisa version", relativePath => {
    expect(literalLisaPins(relativePath)).toEqual([]);
  });

  it("proves the check reads real sections rather than passing vacuously", () => {
    // A guard that examined nothing would also report no findings. Every
    // template must be shown to declare at least one versioned section for the
    // walk above to have looked at anything at all.
    const withVersionedSections = TEMPLATE_PATHS.filter(relativePath => {
      const template = fs.readJsonSync(
        path.join(REPO_ROOT, relativePath)
      ) as Record<string, unknown>;
      return ["force", "defaults"].some(behaviour => {
        const sections = (template[behaviour] ?? {}) as Record<string, unknown>;
        return VERSIONED_SECTIONS.some(section => section in sections);
      });
    });

    expect(withVersionedSections).toEqual([...TEMPLATE_PATHS]);
  });
});
