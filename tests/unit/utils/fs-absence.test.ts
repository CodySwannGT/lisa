/**
 * The one definition of "this path is not there" the doctor checks share.
 *
 * Five checks each carried a private copy of the absent-errno set, and one copy
 * was corrected while four kept `ENAMETOOLONG` (CodySwannGT/lisa#4629). These
 * tests pin the shared definition both ways, so widening it fails here before
 * it reaches any check.
 * @module tests/unit/utils/fs-absence
 */
import { describe, expect, it } from "vitest";

import {
  errnoCode,
  isDefinitiveAbsence,
} from "../../../src/utils/fs-absence.js";
import {
  ABSENT_CODES,
  errnoFailure,
  UNDETERMINABLE_CODES,
} from "../../helpers/fs-errno.js";

describe("errnoCode", () => {
  it("returns the string code a filesystem error carries", () => {
    expect(errnoCode(errnoFailure("EACCES"))).toBe("EACCES");
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["a non-string code", { code: 13 }],
    ["null", null],
    ["a string", "ENOENT"],
    ["undefined", undefined],
  ])("returns undefined for %s", (_label, value) => {
    expect(errnoCode(value)).toBeUndefined();
  });
});

describe("isDefinitiveAbsence", () => {
  it.each(ABSENT_CODES)("reads %s as a path that is not there", code => {
    expect(isDefinitiveAbsence(errnoFailure(code))).toBe(true);
  });

  it.each(UNDETERMINABLE_CODES)(
    "reads %s as a probe that could not look",
    code => {
      expect(isDefinitiveAbsence(errnoFailure(code))).toBe(false);
    }
  );

  it.each([
    ["an error with no code", new Error("boom")],
    ["a non-object", "ENOENT"],
    ["null", null],
  ])("does not read %s as absence", (_label, value) => {
    expect(isDefinitiveAbsence(value)).toBe(false);
  });
});
