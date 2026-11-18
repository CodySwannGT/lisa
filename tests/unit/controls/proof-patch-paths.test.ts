/**
 * What a proof's change touches is read from the patch, not from what git
 * staged.
 *
 * Git stages nothing at a path the repository ignores. A rule that asked
 * git what was staged therefore never saw a file a patch dropped at such a
 * path, and that is the one place a program can be put where the check's
 * command finds it and no commit holds it. These cases read real patches of
 * a real repository.
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyProofPatch,
  ignoredPaths,
  patchPaths,
} from "../../../src/controls/proof-patch.js";
import {
  changeRuleRepository,
  git,
  IGNORED_TOOL,
  NEW_SOURCE,
  OTHER_SOURCE,
  patchOf,
  SOURCE,
  TRACKED_IN_IGNORED,
  write,
} from "./support/change-rule-repository.js";
import { removeFixtures } from "./support/report-check-run.js";

const MOVED = "src/moved.txt";
const CACHED = ".cache/x";

afterEach(() => {
  removeFixtures();
});

describe("the paths a patch touches, read from the patch itself", () => {
  it("are every file it adds, edits and removes, each once and in order", () => {
    const repo = changeRuleRepository();
    const patch = patchOf(repo, () => {
      write(repo, SOURCE, "one\nmore\n");
      write(repo, NEW_SOURCE, "new\n");
      rmSync(path.join(repo, OTHER_SOURCE));
    });

    expect(patchPaths(repo, patch)).toEqual({
      problem: null,
      paths: [SOURCE, NEW_SOURCE, OTHER_SOURCE],
    });
  });

  it("include both names of a file it renames", () => {
    const repo = changeRuleRepository();
    const patch = patchOf(repo, () => {
      git(repo, "mv", SOURCE, MOVED);
    });

    expect(patchPaths(repo, patch)).toEqual({
      problem: null,
      paths: [SOURCE, MOVED],
    });
  });

  it("include a path the repository ignores, which git does not stage", () => {
    const repo = changeRuleRepository();
    const patch = patchOf(repo, () => {
      write(repo, IGNORED_TOOL, "#!/bin/sh\necho planted\n");
    });

    expect(patchPaths(repo, patch)).toEqual({
      problem: null,
      paths: [IGNORED_TOOL],
    });
    expect(applyProofPatch(repo, patch)).toEqual({ problem: null });
    git(repo, "add", "--all");
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
  });

  it("are read whole when a name holds a blank or a tab", () => {
    const repo = changeRuleRepository();
    const names = ["src/sp ace.txt", "src/ta\tb.txt"];
    const patch = patchOf(repo, () => {
      names.forEach(name => {
        write(repo, name, "x\n");
      });
    });

    expect(patchPaths(repo, patch)).toEqual({ problem: null, paths: names });
  });

  it("are the same whether the patch is read in the repository or in a folder with no repository", () => {
    const repo = changeRuleRepository();
    const patch = patchOf(repo, () => {
      git(repo, "mv", SOURCE, MOVED);
      write(repo, IGNORED_TOOL, "x\n");
    });

    expect(patchPaths(path.dirname(repo), patch)).toEqual(
      patchPaths(repo, patch)
    );
  });

  it("are not named for text that is not a patch", () => {
    const read = patchPaths(changeRuleRepository(), "this is not a patch\n");

    expect(read.problem).toEqual(expect.any(String));
  });
});

describe("the paths of a change the repository ignores", () => {
  it("are the ones no commit would hold, and never a file that is tracked", () => {
    const repo = changeRuleRepository();
    write(repo, IGNORED_TOOL, "x\n");
    write(repo, CACHED, "x\n");
    write(repo, NEW_SOURCE, "x\n");

    expect(
      ignoredPaths(repo, [
        IGNORED_TOOL,
        TRACKED_IN_IGNORED,
        NEW_SOURCE,
        CACHED,
        SOURCE,
      ])
    ).toEqual({ problem: null, paths: [IGNORED_TOOL, CACHED] });
  });

  it("are none when no path is given", () => {
    expect(ignoredPaths(changeRuleRepository(), [])).toEqual({
      problem: null,
      paths: [],
    });
  });

  it("take a name that begins like a pattern's options as a name", () => {
    const repo = changeRuleRepository();

    expect(
      ignoredPaths(repo, ["src/*.txt", ":(glob)src/*", ":!src", "-n"])
    ).toEqual({ problem: null, paths: [] });
  });

  it("follow an ignore file written after the last commit", () => {
    const repo = changeRuleRepository();
    write(repo, "src/.gitignore", "generated/\n");

    expect(ignoredPaths(repo, ["src/generated/out.txt", SOURCE])).toEqual({
      problem: null,
      paths: ["src/generated/out.txt"],
    });
  });
});
