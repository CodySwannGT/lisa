/**
 * Boundary behaviour of the path-containment predicate (CodySwannGT/lisa#3808).
 *
 * The defect these cover is a containment test written as a bare string
 * prefix: `"/a/root-tmp/f".startsWith("/a/root")` is true, so a SIBLING whose
 * name extends the root's name reads as being inside it. The convention the
 * fleet follows — a scratch worktree at `<TMPDIR>/<name>` and its scratch
 * directory at `<TMPDIR>/<name>-tmp` — produces exactly that shape, which is
 * why the wrong answer is the common case rather than the exotic one.
 */
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { isPathInside } from "../../../src/utils/path-utils.js";

const ROOT = path.resolve(path.sep, "workspace", "land3716");
const PACKAGE_JSON = "package.json";

describe("isPathInside", () => {
  it("counts the root itself as inside", () => {
    expect(isPathInside(ROOT, ROOT)).toBe(true);
  });

  it("counts a direct child as inside", () => {
    expect(isPathInside(ROOT, path.join(ROOT, "fixture"))).toBe(true);
  });

  it("counts a deeply nested descendant as inside", () => {
    expect(isPathInside(ROOT, path.join(ROOT, "a", "b", "c.json"))).toBe(true);
  });

  it("counts a sibling whose name extends the root as OUTSIDE", () => {
    // The reported defect. `land3716-tmp` string-prefixes `land3716`.
    expect(isPathInside(ROOT, `${ROOT}-tmp`)).toBe(false);
    expect(isPathInside(ROOT, path.join(`${ROOT}-tmp`, "fixture"))).toBe(false);
  });

  it("ignores a trailing separator on either argument", () => {
    expect(isPathInside(`${ROOT}${path.sep}`, path.join(ROOT, "f"))).toBe(true);
    expect(isPathInside(ROOT, `${path.join(ROOT, "f")}${path.sep}`)).toBe(true);
    expect(isPathInside(`${ROOT}${path.sep}`, `${ROOT}-tmp`)).toBe(false);
  });

  it("resolves `..` traversal before judging containment", () => {
    expect(isPathInside(ROOT, path.join(ROOT, "..", "elsewhere"))).toBe(false);
    expect(isPathInside(ROOT, path.join(ROOT, "a", "..", "b"))).toBe(true);
  });

  it("counts the parent of the root as outside", () => {
    expect(isPathInside(ROOT, path.dirname(ROOT))).toBe(false);
  });

  it("resolves relative inputs against the working directory", () => {
    expect(isPathInside(process.cwd(), PACKAGE_JSON)).toBe(true);
    expect(isPathInside(".", PACKAGE_JSON)).toBe(true);
    expect(isPathInside(".", path.join("..", PACKAGE_JSON))).toBe(false);
  });

  it("reads an unusable argument as NOT contained", () => {
    // Fail closed: an answer of "inside" is the dangerous direction, so a path
    // that cannot be judged must never produce it.
    // Both would read as CONTAINED without the guard, because `path.resolve("")`
    // is the working directory and the two arguments then collapse onto it.
    expect(isPathInside("", process.cwd())).toBe(false);
    expect(isPathInside(process.cwd(), "")).toBe(false);
  });
});
