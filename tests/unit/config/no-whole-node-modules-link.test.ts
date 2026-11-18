/**
 * No test may link a whole `node_modules` directory into a fixture
 * (CodySwannGT/lisa#5028).
 *
 * A fixture that runs a real Vitest through such a link reaches this
 * checkout's `node_modules/.vitest-cache`. The fixture has no lockfile, so
 * Vitest's lockfile-hash check never matches, and it clears the checkout's
 * cache in the middle of the suite. Every sibling test file still reading it
 * then fails with ENOENT. Fixtures borrow packages through
 * `tests/helpers/borrowed-node-modules.ts` instead, which links installed
 * entries one by one and leaves tool state behind.
 * @module tests/unit/config/no-whole-node-modules-link
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { checkoutFiles } from "../../helpers/tracked-files.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** A call that creates a link: `symlinkSync(`, `symlink(`, `fs.symlink(`. */
const LINK_CALL = /\bsymlink(?:Sync)?\(/gu;

/**
 * A link source naming this checkout's whole `node_modules`: a path literal
 * ending in it, `path.resolve("node_modules")` (a test's working directory is
 * this checkout), `path.join(<CONSTANT>, "node_modules")` where an upper-case
 * module constant names this checkout's root (`REPO_ROOT`, `ROOT`), or a
 * constant named for it. A link from one fixture's tree to another's, such as
 * a case whose subject is a linked `node_modules`, names a local variable and
 * never reaches this checkout.
 */
const WHOLE_MODULES_SOURCES: readonly RegExp[] = [
  /^["'`][^"'`]*node_modules["'`]$/u,
  /^path\.resolve\(["'`]node_modules["'`]\)$/u,
  /^path\.join\([A-Z][A-Z0-9_]*,["'`]node_modules["'`]\)$/u,
  /^[A-Z_]*NODE_MODULES$/u,
];

/**
 * Whether a link's first argument names this checkout's whole `node_modules`.
 * @param argument - The argument's source text
 * @returns True for a whole-directory source
 */
function namesWholeModules(argument: string): boolean {
  const compact = argument.replaceAll(/\s+/gu, "");
  return WHOLE_MODULES_SOURCES.some(pattern => pattern.test(compact));
}

/**
 * The text of a call's first argument, up to the first top-level comma.
 * @param source - File text
 * @param start - Index just past the call's opening parenthesis
 * @returns The trimmed first argument
 */
function firstArgument(source: string, start: number): string {
  const closers: Readonly<Record<string, string>> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };
  const stack: string[] = [];
  for (let index = start; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char in closers) stack.push(closers[char] ?? "");
    else if (stack.length > 0 && char === stack.at(-1)) stack.pop();
    else if (stack.length === 0 && (char === "," || char === ")")) {
      return source.slice(start, index).trim();
    }
  }
  return source.slice(start).trim();
}

/**
 * Link sources in a file that name a whole `node_modules`.
 * @param source - File text
 * @returns The offending first arguments
 */
function wholeModulesLinks(source: string): readonly string[] {
  return [...source.matchAll(LINK_CALL)]
    .map(match => firstArgument(source, match.index + match[0].length))
    .filter(namesWholeModules);
}

/**
 * The call name, spelled so the samples below are not themselves links in
 * this file's text, which the corpus case scans like any other.
 */
const LINK = ["sym", "link", "Sync"].join("");

describe("no whole node_modules link in a test fixture", () => {
  it("recognises each form the fixtures used before the fix", () => {
    // The detector's own red: these are the exact shapes that wiped the
    // checkout's cache. A detector that misses one guards nothing.
    const before = [
      `${LINK}(NODE_MODULES, path.join(root, "node_modules"), "dir");`,
      `fs.${LINK}(\n  path.join(REPO_ROOT, "node_modules"),\n  path.join(root, "node_modules"),\n  "dir"\n);`,
      `${LINK}(path.resolve("node_modules"), path.join(root, "node_modules"));`,
    ];
    for (const sample of before) {
      expect(wholeModulesLinks(sample), sample).toHaveLength(1);
    }
  });

  it("allows single-package links and links between two fixtures' trees", () => {
    const allowed = [
      `fs.${LINK}(REPO_ROOT, path.join(cwd, "node_modules/@codyswann/lisa"));`,
      `fs.${LINK}(path.join(REPO_ROOT, "node_modules/vitest"), path.join(cwd, "node_modules/vitest"));`,
      `fs.${LINK}(path.join(source, entry), path.join(target, entry));`,
      `${LINK}(\n  path.join(other, "node_modules"),\n  path.join(root, "node_modules")\n);`,
    ];
    for (const sample of allowed) {
      expect(wholeModulesLinks(sample), sample).toEqual([]);
    }
  });

  it("finds none in any tracked test or helper file", () => {
    const offenders = checkoutFiles(REPO_ROOT)
      .filter(file => file.startsWith("tests/") && /\.[cm]?[jt]s$/u.test(file))
      .flatMap(file =>
        wholeModulesLinks(
          fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
        ).map(argument => `${file}: symlink(${argument}, …)`)
      );

    expect(offenders).toEqual([]);
  });
});
