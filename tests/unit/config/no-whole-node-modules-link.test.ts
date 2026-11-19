/**
 * No test may link a whole `node_modules` directory (CodySwannGT/lisa#5028).
 *
 * A fixture that runs a real Vitest through such a link reaches the lender's
 * `node_modules/.vitest-cache`. The fixture has no lockfile, so Vitest's
 * lockfile-hash check never matches, and it clears the lender's cache. When
 * the lender is this checkout, that happens in the middle of the suite, and
 * every sibling test file still reading the cache fails with ENOENT.
 *
 * Whether a path held in a variable names a whole `node_modules` cannot be
 * told from the source text, so the rule does not read arguments at all. It
 * is structural: no file under tests/ calls `symlink` or `symlinkSync`
 * itself. Links go through `tests/support/borrowed-node-modules.mjs`, the one
 * module that creates them, the same single-accessor shape as one module
 * owning `process.env`. That module checks both ends of every link on
 * resolved paths at runtime, so a variable-bound path is refused as surely as
 * a literal one.
 * @module tests/unit/config/no-whole-node-modules-link
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { checkoutFiles } from "../../helpers/tracked-files.js";
import {
  createSymlink,
  linkForeignNodeModules,
  linkPackage,
} from "../../support/borrowed-node-modules.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** The one module under tests/ allowed to create links. */
const ACCESSOR = "tests/support/borrowed-node-modules.mjs";

/** Call names that create a link. */
const LINK_CALLS = new Set(["symlink", "symlinkSync"]);

/**
 * The called name of a call expression: `f(` or `object.f(`.
 * @param call - A call expression
 * @returns The name, or an empty string for any other callee
 */
function calledName(call: ts.CallExpression): string {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return "";
}

/**
 * Direct link calls in a file's syntax tree. Text inside strings and comments
 * is not a call, so a script embedded in a string is not counted.
 * @param file - Name used for the syntax tree
 * @param source - File text
 * @returns Each direct call's text, whitespace collapsed
 */
function directLinks(file: string, source: string): readonly string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && LINK_CALLS.has(calledName(node))) {
      found.push(node.getText(tree).replaceAll(/\s+/gu, " "));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/**
 * The call name, spelled so the samples below are not themselves calls in
 * this file's text, which the corpus case scans like any other.
 */
const LINK = ["sym", "link", "Sync"].join("");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A fresh directory outside this checkout.
 * @param prefix - Directory name prefix
 * @returns Its resolved path
 */
function scratch(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

describe("no whole node_modules link in a test", () => {
  it("recognises every direct link call, however its paths are spelled", () => {
    // The detector's own red. The last sample is the variable-bound shape a
    // reading of the arguments missed: the path is in a local, not the call.
    const before = [
      `${LINK}(NODE_MODULES, path.join(root, "node_modules"), "dir");`,
      `fs.${LINK}(\n  path.join(REPO_ROOT, "node_modules"),\n  path.join(root, "node_modules"),\n  "dir"\n);`,
      `await ${LINK.replace("Sync", "")}(\n    path.join(source, "node_modules"),\n    path.join(destination, "node_modules"),\n    "dir"\n  );`,
      `fs.${LINK}(path.join(source, entry), path.join(target, entry));`,
      `const source = path.join(REPO_ROOT, "node_modules");\nfs.${LINK}(source, target, "dir");`,
    ];
    for (const sample of before) {
      expect(directLinks("sample.ts", sample), sample).toHaveLength(1);
    }
  });

  it("does not count a call name inside a string or a comment", () => {
    const allowed = [
      `const script = "${LINK}(a, b)";`,
      `// ${LINK}(a, b)`,
      `createSymlink(path.join(source, entry), path.join(target, entry));`,
    ];
    for (const sample of allowed) {
      expect(directLinks("sample.ts", sample), sample).toEqual([]);
    }
  });

  it("refuses a variable-bound whole node_modules at runtime", () => {
    const root = scratch("lisa-link-whole-");
    const source = path.join(REPO_ROOT, "node_modules");
    const target = path.join(root, "node_modules");
    expect(() => createSymlink(source, target, "dir")).toThrow(
      /whole node_modules/u
    );
    expect(() =>
      createSymlink(path.join(REPO_ROOT, "package.json"), target)
    ).toThrow(/whole node_modules/u);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("refuses a tool's state directory inside node_modules", () => {
    const root = scratch("lisa-link-state-");
    fs.mkdirSync(path.join(root, "node_modules"));
    expect(() =>
      createSymlink(
        path.join(REPO_ROOT, "node_modules", ".vitest-cache"),
        path.join(root, "node_modules", ".vitest-cache"),
        "dir"
      )
    ).toThrow(/tool's state/u);
  });

  it("links one package entry, and refuses a whole node_modules as one", () => {
    const root = scratch("lisa-link-package-");
    const linked = linkPackage(
      path.join(REPO_ROOT, "node_modules", "vitest"),
      root,
      "vitest"
    );
    expect(fs.realpathSync(linked)).toBe(
      fs.realpathSync(path.join(REPO_ROOT, "node_modules", "vitest"))
    );
    expect(() =>
      linkPackage(path.join(REPO_ROOT, "node_modules"), root, "whole")
    ).toThrow(/whole node_modules/u);
    expect(() => linkPackage(REPO_ROOT, root, "..")).toThrow(
      /not a package name/u
    );
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

  it("refuses a link outside this checkout that points at its node_modules", () => {
    // The link itself stands outside, so only resolving the source (not just
    // its parent) shows it is this checkout's node_modules. Every helper here
    // refuses to make such a link, which is the point, so the fixture makes
    // it with `ln` rather than through a back door in the accessor.
    const owner = scratch("lisa-foreign-alias-");
    const alias = path.join(owner, "node_modules");
    execFileSync("/bin/ln", [
      "-s",
      path.join(REPO_ROOT, "node_modules"),
      alias,
    ]);
    const root = scratch("lisa-foreign-host-");
    expect(() => linkForeignNodeModules(alias, root)).toThrow(
      /inside this checkout/u
    );
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
  });

  it("finds no direct link call in any tracked test, fixture or support file", () => {
    const offenders = checkoutFiles(REPO_ROOT)
      .filter(
        file =>
          file.startsWith("tests/") &&
          file !== ACCESSOR &&
          /\.[cm]?[jt]s$/u.test(file)
      )
      .flatMap(file =>
        directLinks(
          file,
          fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
        ).map(call => `${file}: ${call}`)
      );

    expect(offenders).toEqual([]);
  });
});
