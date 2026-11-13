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
 *
 * Only load-bearing phrases may be listed (CodySwannGT/lisa#4867): every
 * required-phrases entry must classify as MACHINE-TOKEN (a token a shipped
 * parser reads) or STRUCTURAL (a frontmatter line), per
 * `scripts/lib/phrase-tests/token-classes.mjs`. Pinning guidance prose makes
 * every rewording a test failure while proving nothing an agent does.
 * Guards on files that are not Markdown — workflows, hooks, scripts — live
 * in `tests/phrase-manifest/source-text-guards.json`, checked the same way.
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
  SOURCE_GUARDS_PATH,
  type Manifest,
} from "../../../scripts/lib/phrase-tests/manifest.mjs";
import {
  classifyCheck,
  LOAD_BEARING,
} from "../../../scripts/lib/phrase-tests/inventory.mjs";

/**
 * Parse one phrase file.
 * @param file - Repository-relative path
 * @returns The manifest
 */
const load = (file: string): Manifest =>
  JSON.parse(readFileSync(path.resolve(file), "utf8")) as Manifest;

/**
 * A manifest file's text, or undefined when it does not exist.
 * @param file - Repository-relative path
 * @returns The text, or undefined
 */
function readOptional(file: string): string | undefined {
  const absolute = path.resolve(file);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
}

/**
 * Every entry of a phrase file whose class is not allowed there.
 * @param manifest - The phrase file
 * @param allowed - The classes it may hold
 * @returns `<file>: <phrase> (<class>)` for each misplaced entry
 */
function misplaced(manifest: Manifest, allowed: readonly string[]): string[] {
  return manifestEntries(manifest).flatMap(check => {
    const { cls } = classifyCheck(check);
    return allowed.includes(cls)
      ? []
      : [`${check.file}: ${describePhrase(check)} (${cls})`];
  });
}

/**
 * One case per (file, phrase): the phrase holds in the file.
 * @param manifest - The phrase file
 */
function checkEveryPhrase(manifest: Manifest): void {
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
}

const manifest = load(MANIFEST_PATH);
const sourceGuards = load(SOURCE_GUARDS_PATH);

describe("the required-phrases manifest", () => {
  it("pins phrases", () => {
    expect(manifestEntries(manifest).length).toBeGreaterThan(0);
  });

  it("pins only MACHINE-TOKEN and STRUCTURAL phrases", () => {
    expect(
      misplaced(manifest, LOAD_BEARING),
      "these phrases are not load-bearing: delete WORDING, move NOT-MARKDOWN to source-text-guards.json, or add the token class and its parser to token-classes.mjs"
    ).toEqual([]);
  });

  checkEveryPhrase(manifest);
});

describe("the source-text guards", () => {
  it("guards only files that are not Markdown documents", () => {
    expect(
      misplaced(sourceGuards, ["NOT-MARKDOWN"]),
      "a Markdown phrase belongs in required-phrases.json, and only if it is load-bearing"
    ).toEqual([]);
  });

  checkEveryPhrase(sourceGuards);
});
