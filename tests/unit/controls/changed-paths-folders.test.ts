/**
 * Whether a changed path is inside a part's folder (CodySwannGT/lisa#4988).
 *
 * The gate runner leaves a part out of a run when the change touches nothing
 * in its folder. A comparison that answers "not inside" when the path is
 * inside leaves a folder unchecked, so every doubtful comparison here has to
 * come out as "inside".
 * @module tests/unit/controls/changed-paths-folders
 */
import { describe, expect, it } from "vitest";

import {
  pathsOutside,
  touchesFolder,
} from "../../../all/copy-overwrite/scripts/lib/changed-paths.mjs";

const API = "api";
const NESTED_MAIN = "services/api/main.py";
const NESTED = "services/api";
const API_MAIN = "api/main.py";
const UPPER_MAIN = "API/main.py";
const UNUSUAL = "café menu";
const NESTED_REPOSITORY = "vendor/engine";
const INSIDE_NESTED = "vendor/engine/src";

describe("whether a changed path is inside a part's folder", () => {
  it("counts a file directly in the folder and one deeper inside it", () => {
    expect(touchesFolder([API_MAIN], [API])).toBe(true);
    expect(touchesFolder(["api/src/deep/module.py"], [API])).toBe(true);
  });

  it("does not count a folder whose name only starts the same way", () => {
    expect(
      touchesFolder(["api-v2/main.py", "apiary/hive.py", "apis.md"], [API])
    ).toBe(false);
  });

  it("does not count a folder of the same name somewhere else", () => {
    expect(touchesFolder([NESTED_MAIN], [API])).toBe(false);
    expect(touchesFolder([API_MAIN], [NESTED])).toBe(false);
  });

  it("compares a nested folder by whole segments too", () => {
    expect(touchesFolder([NESTED_MAIN], [NESTED])).toBe(true);
    expect(touchesFolder(["services/api-old/main.py"], [NESTED])).toBe(false);
  });

  it("counts a change to the folder's own path", () => {
    // What git reports when the folder is a link or another repository.
    expect(touchesFolder([API], [API])).toBe(true);
  });

  it("counts a change to a path the folder lies below", () => {
    // A nested repository, or a link above the folder: git names that one
    // path, and says nothing about what moved underneath it.
    expect(touchesFolder([NESTED_REPOSITORY], [INSIDE_NESTED])).toBe(true);
    expect(touchesFolder(["vendor"], [INSIDE_NESTED])).toBe(true);
    expect(touchesFolder(["VENDOR/Engine"], [INSIDE_NESTED])).toBe(true);
  });

  it("does not count a path that only starts the way the folder's own path does", () => {
    expect(touchesFolder(["vendor/eng"], [INSIDE_NESTED])).toBe(false);
    expect(touchesFolder(["vendor/engine-old"], [INSIDE_NESTED])).toBe(false);
    expect(touchesFolder(["vend"], [INSIDE_NESTED])).toBe(false);
  });

  it("matches a folder whose name holds a space and a non-ASCII character", () => {
    expect(touchesFolder([`${UNUSUAL}/today.md`], [UNUSUAL])).toBe(true);
    expect(touchesFolder(["café/today.md"], [UNUSUAL])).toBe(false);
  });

  it("treats an accented letter the same however it is composed", () => {
    const composed = UNUSUAL.normalize("NFC");
    const decomposed = UNUSUAL.normalize("NFD");
    expect(composed).not.toBe(decomposed);
    expect(touchesFolder([`${decomposed}/today.md`], [composed])).toBe(true);
    expect(touchesFolder([`${composed}/today.md`], [decomposed])).toBe(true);
  });

  it("ignores letter case, so a filesystem that does cannot hide a change", () => {
    expect(touchesFolder([UPPER_MAIN], [API])).toBe(true);
    expect(touchesFolder([API_MAIN], ["Api"])).toBe(true);
    expect(touchesFolder(["Straße/x"], ["STRASSE"])).toBe(true);
  });

  it("is touched when any of its spellings is", () => {
    expect(touchesFolder([NESTED_MAIN], [API, NESTED])).toBe(true);
    expect(touchesFolder(["web/index.ts"], [API, NESTED])).toBe(false);
  });

  it("is not touched by a change that has no paths", () => {
    expect(touchesFolder([], [API])).toBe(false);
  });
});

describe("which changed paths lie outside every one of a set of folders", () => {
  it("leaves out a path inside a folder, and the folder's own path", () => {
    expect(pathsOutside([API_MAIN, API, "api/src/deep.py"], [API])).toEqual([]);
  });

  it("keeps a path in no folder, in the order it was given", () => {
    expect(
      pathsOutside(["tools/b.js", API_MAIN, "README.md"], [API, NESTED])
    ).toEqual(["tools/b.js", "README.md"]);
  });

  it("keeps a path the folder lies below: the folder is only part of it", () => {
    // The other direction from `touchesFolder`, on purpose. A nested
    // repository that moved may have changed outside the folder inside it.
    expect(pathsOutside([NESTED_REPOSITORY], [INSIDE_NESTED])).toEqual([
      NESTED_REPOSITORY,
    ]);
  });

  it("compares whole segments, the way `touchesFolder` does", () => {
    const sameStart = "api-next/main.py";

    expect(pathsOutside([API_MAIN, sameStart], [API])).toEqual([sameStart]);
  });

  it("compares letter case exactly: `API` may be another folder than `api`", () => {
    // The other direction from `touchesFolder`, on purpose. Where a file
    // system tells the two apart, a path in `API` is in no part for `api`,
    // and calling it covered would stand a built-in check down for it.
    expect(pathsOutside([UPPER_MAIN], [API])).toEqual([UPPER_MAIN]);
    expect(pathsOutside([API_MAIN], ["Api"])).toEqual([API_MAIN]);
    expect(pathsOutside(["Straße/x"], ["STRASSE"])).toEqual(["Straße/x"]);
  });

  it("compares an accented letter exactly, however it is composed", () => {
    const composed = `${UNUSUAL.normalize("NFC")}/today.md`;
    const decomposed = UNUSUAL.normalize("NFD");

    expect(pathsOutside([composed], [decomposed])).toEqual([composed]);
    expect(pathsOutside([composed], [UNUSUAL.normalize("NFC")])).toEqual([]);
  });

  it("leaves out a path under any spelling the folder was given", () => {
    expect(pathsOutside([UPPER_MAIN, API_MAIN], [API, "API"])).toEqual([]);
  });

  it("keeps every path when there is no folder", () => {
    expect(pathsOutside([API_MAIN], [])).toEqual([API_MAIN]);
  });
});
