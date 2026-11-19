/**
 * No test may link a whole `node_modules` directory (CodySwannGT/lisa#5028).
 *
 * A fixture that runs a real Vitest through such a link reaches the lender's
 * `node_modules/.vitest-cache`. The fixture has no lockfile, so Vitest's
 * lockfile-hash check never matches, and it clears the lender's cache. When
 * the lender is this checkout, that happens in the middle of the suite, and
 * every sibling test file still reading the cache fails with ENOENT. Whether
 * a source variable names this checkout cannot be told from its spelling, so
 * the rule does not try. Every whole-directory link is refused, and fixtures
 * go through `tests/support/borrowed-node-modules.mjs` instead:
 * `borrowNodeModules` links installed entries one by one, and
 * `linkForeignNodeModules` (for a case whose subject is a linked
 * `node_modules`) refuses at runtime a source inside this checkout.
 * @module tests/unit/config/no-whole-node-modules-link
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { checkoutFiles } from "../../helpers/tracked-files.js";
import { linkForeignNodeModules } from "../../support/borrowed-node-modules.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** A call that creates a link: `symlinkSync(`, `symlink(`, `fs.symlink(`. */
const LINK_CALL = /\bsymlink(?:Sync)?\(/gu;

/** An argument naming a whole `node_modules` directory, whitespace removed. */
const WHOLE_MODULES_ARGUMENT: readonly RegExp[] = [
  /["'`]node_modules["'`]\)$/u,
  /^["'`][^"'`]*node_modules["'`]$/u,
  /NODE_MODULES$/u,
];

/** Each opening bracket and the character that closes it. */
const CLOSERS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

/**
 * Where one argument ends: the next top-level `,` or the call's `)`.
 * @param source - File text
 * @param from - Index where the argument starts
 * @returns The index of the terminating character
 */
function argumentEnd(source: string, from: number): number {
  const stack: string[] = [];
  for (let index = from; index < source.length; index++) {
    const char = source.charAt(index);
    if (char in CLOSERS) stack.push(CLOSERS[char] ?? "");
    else if (stack.length > 0 && char === stack.at(-1)) stack.pop();
    else if (stack.length === 0 && (char === "," || char === ")")) return index;
  }
  return source.length;
}

/**
 * The call's first two arguments.
 * @param source - File text
 * @param start - Index just past the call's opening parenthesis
 * @returns The arguments' text, whitespace removed
 */
function leadingArguments(source: string, start: number): readonly string[] {
  const firstEnd = argumentEnd(source, start);
  const first = source.slice(start, firstEnd).replaceAll(/\s+/gu, "");
  if (source.charAt(firstEnd) !== ",") return [first];
  const second = source.slice(firstEnd + 1, argumentEnd(source, firstEnd + 1));
  return [first, second.replaceAll(/\s+/gu, "")];
}

/**
 * Whether an argument names a whole `node_modules` directory.
 * @param argument - The argument's text, whitespace removed
 * @returns True for a whole-directory path
 */
function namesWholeModules(argument: string): boolean {
  return WHOLE_MODULES_ARGUMENT.some(pattern => pattern.test(argument));
}

/**
 * Link calls in a file whose source or destination is a whole `node_modules`.
 * @param source - File text
 * @returns Each offending call's first two arguments
 */
function wholeModulesLinks(source: string): readonly string[] {
  return [...source.matchAll(LINK_CALL)]
    .map(match => leadingArguments(source, match.index + match[0].length))
    .filter(args => args.some(namesWholeModules))
    .map(args => args.join(", "));
}

/**
 * The call name, spelled so the samples below are not themselves links in
 * this file's text, which the corpus case scans like any other.
 */
const LINK = ["sym", "link", "Sync"].join("");

describe("no whole node_modules link in a test", () => {
  it("recognises each form the fixtures used before the fix", () => {
    // The detector's own red: every shape that linked a whole node_modules,
    // including the two whose source was this checkout under a lower-case
    // local name (`repo`, `source`) and the fixture-to-fixture form.
    const before = [
      `${LINK}(NODE_MODULES, path.join(root, "node_modules"), "dir");`,
      `fs.${LINK}(\n  path.join(REPO_ROOT, "node_modules"),\n  path.join(root, "node_modules"),\n  "dir"\n);`,
      `${LINK}(path.resolve("node_modules"), path.join(root, "node_modules"));`,
      `fs.${LINK}(\n    path.join(repo, "node_modules"),\n    path.join(checkout, "node_modules"),\n    "dir"\n  );`,
      `await ${LINK.replace("Sync", "")}(\n    path.join(source, "node_modules"),\n    path.join(destination, "node_modules"),\n    "dir"\n  );`,
      `${LINK}(\n  path.join(other, "node_modules"),\n  path.join(root, "node_modules")\n);`,
    ];
    for (const sample of before) {
      expect(wholeModulesLinks(sample), sample).toHaveLength(1);
    }
  });

  it("allows links to single entries inside node_modules", () => {
    const allowed = [
      `fs.${LINK}(REPO_ROOT, path.join(cwd, "node_modules/@codyswann/lisa"));`,
      `fs.${LINK}(path.join(REPO_ROOT, "node_modules/vitest"), path.join(cwd, "node_modules/vitest"));`,
      `fs.${LINK}(path.join(source, entry), path.join(target, entry));`,
    ];
    for (const sample of allowed) {
      expect(wholeModulesLinks(sample), sample).toEqual([]);
    }
  });

  it("refuses a foreign link whose source is inside this checkout", () => {
    expect(() =>
      linkForeignNodeModules(path.join(REPO_ROOT, "node_modules"), REPO_ROOT)
    ).toThrow(/inside this checkout/u);
  });

  it("refuses a source in a checkout child whose name begins with ..", () => {
    // `..probe-x` is a child of this checkout, not a step out of it; a test
    // of the relative path's first two characters read it as outside.
    const child = fs.mkdtempSync(path.join(REPO_ROOT, "..lisa-foreign-probe-"));
    try {
      expect(() =>
        linkForeignNodeModules(path.join(child, "node_modules"), child)
      ).toThrow(/inside this checkout/u);
      expect(fs.existsSync(path.join(child, "node_modules"))).toBe(false);
    } finally {
      fs.rmSync(child, { recursive: true, force: true });
    }
  });

  it("finds none in any tracked test, fixture or support file", () => {
    const offenders = checkoutFiles(REPO_ROOT)
      .filter(file => file.startsWith("tests/") && /\.[cm]?[jt]s$/u.test(file))
      .flatMap(file =>
        wholeModulesLinks(
          fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
        ).map(args => `${file}: symlink(${args}, …)`)
      );

    expect(offenders).toEqual([]);
  });
});
