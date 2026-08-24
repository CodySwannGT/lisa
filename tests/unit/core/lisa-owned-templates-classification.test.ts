/**
 * Every shipped `copy-overwrite` template must land in exactly one of three
 * populations, and land there deliberately.
 *
 * `--yes` now treats them differently (CodySwannGT/lisa#3069):
 *
 * | population | recognised by | under `--yes` |
 * | --- | --- | --- |
 * | Lisa-owned enforcement | `isLisaOwnedTemplate` | refreshed, provenance-checked |
 * | declared replace-every-run | `declaresReplacedEveryRun` | refreshed |
 * | seeded-then-edited | neither | reported `stale` |
 *
 * The third is the default, which is the safe direction for a file nobody
 * classified — but it is silent. A NEW template meant to be replaced on every
 * run whose author forgets the header sentence lands in the third bucket and is
 * simply never delivered, at every version bump, with nothing in the output
 * saying so. That is #2374's undeliverable-fix incident, reachable through the
 * mechanism added to fix #3069.
 *
 * So these assertions pin the classification of the files whose category is
 * load-bearing, and prove the populations do not overlap.
 * @module tests/unit/core/lisa-owned-templates-classification
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  declaresReplacedEveryRun,
  isLisaOwnedTemplate,
} from "../../../src/core/lisa-owned-templates.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Every `<stack>/copy-overwrite` tree Lisa ships.
 * @returns Absolute paths of the copy-overwrite roots.
 */
function copyOverwriteTrees(): string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => path.join(REPO_ROOT, entry.name, "copy-overwrite"))
    .filter(candidate => fs.existsSync(candidate));
}

/**
 * Locate one shipped template by tree-relative path, in any stack tree.
 * @param relativePath Tree-relative path, e.g. "knip.json".
 * @returns Absolute paths of every stack's copy of that template.
 */
function shippedCopies(relativePath: string): string[] {
  return copyOverwriteTrees()
    .map(tree => path.join(tree, relativePath))
    .filter(candidate => fs.existsSync(candidate));
}

describe("copy-overwrite template classification", () => {
  it("ships copy-overwrite trees to classify", () => {
    expect(copyOverwriteTrees().length).toBeGreaterThan(0);
  });

  it("classifies eslint.config.ts as declared replace-every-run, in every stack that ships it", () => {
    // The control from #3069. This file is NOT Lisa-owned by the path
    // predicate, and it must still be replaced on every run — its own header
    // says so and points at `eslint.config.local.ts`. If the sentence is ever
    // edited out, this fails rather than the file silently freezing downstream.
    const copies = shippedCopies("eslint.config.ts");
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect(isLisaOwnedTemplate("eslint.config.ts")).toBe(false);
      expect(declaresReplacedEveryRun(fs.readFileSync(copy, "utf8"))).toBe(
        true
      );
    }
  });

  it("classifies knip.json as seeded-then-edited, in every stack that ships it", () => {
    // The file #3069 is about. Neither owned nor declared, so `--yes` reports
    // it stale and leaves the host's curated entry globs and ignore list alone.
    const copies = shippedCopies("knip.json");
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect(isLisaOwnedTemplate("knip.json")).toBe(false);
      expect(declaresReplacedEveryRun(fs.readFileSync(copy, "utf8"))).toBe(
        false
      );
    }
  });

  it("classifies tsconfig.json as seeded-then-edited, in every stack that ships it", () => {
    const copies = shippedCopies("tsconfig.json");
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect(isLisaOwnedTemplate("tsconfig.json")).toBe(false);
      expect(declaresReplacedEveryRun(fs.readFileSync(copy, "utf8"))).toBe(
        false
      );
    }
  });

  it("keeps the enforcement tree Lisa-owned", () => {
    // The population whose unprompted refresh is what makes a released guard
    // fix deliverable (#2374). #3069 must not narrow it.
    expect(isLisaOwnedTemplate("scripts/lisa-hooks/block-no-verify.sh")).toBe(
      true
    );
    expect(isLisaOwnedTemplate("scripts/check-bdd-coverage.mjs")).toBe(true);
  });
});
