/**
 * How `lisa controls install-carriers` names a path in what it prints
 * (CodySwannGT/lisa#4989).
 *
 * A result is saved, handed to the enforce report and shown to people, so a
 * path in it is never a path of the operator's machine: it is written from
 * the repository root, from git's shared folder, or by its file name alone.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  GIT_COMMON_FOLDER_SHOWN,
  OUTSIDE_SHOWN,
  shownPath,
} from "../../../src/controls/carrier-owner.js";

const ROOT = path.resolve("/work/linked-tree");
const COMMON = path.resolve("/work/main/.git");

describe("a path as a result names it", () => {
  it("is written from the repository root when it is inside the checkout", () => {
    expect(shownPath(ROOT, path.join(ROOT, ".husky/pre-commit"), COMMON)).toBe(
      ".husky/pre-commit"
    );
    expect(shownPath(ROOT, path.join(ROOT, ".git/hooks/pre-push"))).toBe(
      ".git/hooks/pre-push"
    );
  });

  it("is written from git's shared folder when it is a hook of a linked working tree", () => {
    const shown = shownPath(
      ROOT,
      path.join(COMMON, "hooks/pre-commit"),
      COMMON
    );

    expect(shown).toBe(`${GIT_COMMON_FOLDER_SHOWN}/hooks/pre-commit`);
    expect(shown).toBe("<git-common-dir>/hooks/pre-commit");
  });

  it.each([
    ["a folder git's shared folder does not hold", COMMON],
    ["git's shared folder is not known", null],
  ])("is its file name alone when %s", (_name, commonFolder) => {
    const shown = shownPath(
      ROOT,
      path.resolve("/home/someone/hooks/pre-commit"),
      commonFolder
    );

    expect(shown).toBe(`${OUTSIDE_SHOWN}/pre-commit`);
    expect(shown).not.toContain("someone");
  });

  it("does not take a folder whose name only starts like the root for the root", () => {
    expect(
      shownPath(ROOT, path.resolve("/work/linked-tree-2/hooks/pre-commit"))
    ).toBe("<outside the checkout>/pre-commit");
  });
});
