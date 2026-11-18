/**
 * Whether a changed path is inside a part's folder (CodySwannGT/lisa#4988).
 *
 * The gate runner leaves a part out of a run when the change touches nothing
 * in its folder. A comparison that answers "not inside" when the path is
 * inside leaves a folder unchecked, so every doubtful comparison here has to
 * come out as "inside".
 * @module tests/unit/scripts/changed-paths-folders
 */
import { describe, expect, it } from "vitest";

import { touchesFolder } from "../../../all/copy-overwrite/scripts/lib/changed-paths.mjs";

const API = "api";
const NESTED_MAIN = "services/api/main.py";
const NESTED = "services/api";
const API_MAIN = "api/main.py";
const UNUSUAL = "café menu";

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
    expect(touchesFolder(["API/main.py"], [API])).toBe(true);
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
