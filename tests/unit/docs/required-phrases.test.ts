/**
 * Every phrase the required-phrases manifest pins (CodySwannGT/lisa#4609).
 *
 * This one data-driven test replaces the phrase-only test files that each
 * read a skill doc (or another text file) and asserted wording was present
 * or absent. The phrases now live in
 * `tests/phrase-manifest/required-phrases.json`, keyed by the file they
 * protect; edit that file to change what is required. One case runs per
 * (file, phrase), so a failure names both, and a listed file that no longer
 * exists fails too.
 * @module tests/unit/docs/required-phrases
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  describePhrase,
  MANIFEST_PATH,
  manifestEntries,
  phraseFailure,
  type Manifest,
} from "../../../scripts/lib/phrase-tests/manifest.mjs";

const manifest = JSON.parse(
  readFileSync(path.resolve(MANIFEST_PATH), "utf8")
) as Manifest;

/**
 * A manifest file's text, or undefined when it does not exist.
 * @param file - Repository-relative path
 * @returns The text, or undefined
 */
function readOptional(file: string): string | undefined {
  const absolute = path.resolve(file);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
}

describe("the required-phrases manifest", () => {
  it("pins phrases", () => {
    expect(manifestEntries(manifest).length).toBeGreaterThan(0);
  });

  for (const file of Object.keys(manifest.files)) {
    describe(file, () => {
      const text = readOptional(file);
      const checks = manifestEntries({
        ...manifest,
        files: { [file]: manifest.files[file]! },
      });
      it.each(
        checks.map(
          check =>
            [`${check.polarity} ${describePhrase(check)}`, check] as const
        )
      )("%s", (_title, check) => {
        const failure = phraseFailure(text, check);
        expect(failure, failure).toBeUndefined();
      });
    });
  }
});
