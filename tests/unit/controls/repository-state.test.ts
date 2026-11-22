/**
 * The measure the attest suites hold a repository to
 * (CodySwannGT/lisa#4996, CodySwannGT/lisa#4998).
 *
 * A finished `lisa controls attest` run writes three files and nothing else,
 * so the suites compare a repository before and after with those three paths
 * left out. A measure that left out more than it was told would pass a run
 * that wrote somewhere it should not. These cases show it leaves out exactly
 * the paths it is given.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildFNone } from "../../helpers/control-audit-fixtures.js";
import {
  ATTEST_RESULT_FILES,
  pathStandings,
  repositoryState,
} from "../../support/repository-state.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const EVIDENCE = ".lisa/controls/evidence.json";
const EXCEPT = { except: ATTEST_RESULT_FILES };

afterEach(() => {
  removeFixtures();
});

/**
 * Write a file in a repository, making its folder when it is not there.
 * @param repoPath - The repository
 * @param relative - The file, from the repository root
 * @param content - What it holds
 */
function write(repoPath: string, relative: string, content: string): void {
  mkdirSync(path.dirname(path.join(repoPath, relative)), { recursive: true });
  writeFileSync(path.join(repoPath, relative), content);
}

describe("a repository's state with the three files of results left out", () => {
  it("names exactly the evidence, the register and the verdict", () => {
    expect(ATTEST_RESULT_FILES).toEqual([
      EVIDENCE,
      ".lisa/controls/register.json",
      ".lisa/controls/verdict.json",
    ]);
  });

  it("is the same before and after one of the three is written", () => {
    const { repoPath } = keep(buildFNone());
    const before = repositoryState(repoPath);

    write(repoPath, EVIDENCE, "{}\n");

    expect(repositoryState(repoPath, EXCEPT)).toEqual(before);
    expect(repositoryState(repoPath)).not.toEqual(before);
  });

  it.each([
    ".lisa/controls/evidence.json.bak",
    ".lisa/controls/proofs/planted.patch",
    ".lisa/audit/report.json",
    "evidence.json",
  ])("still changes when %s is written beside them", other => {
    const { repoPath } = keep(buildFNone());
    const before = repositoryState(repoPath, EXCEPT);

    write(repoPath, other, "{}\n");

    expect(repositoryState(repoPath, EXCEPT).workingTree).not.toBe(
      before.workingTree
    );
  });

  it("leaves nothing out when a folder is named instead of a file", () => {
    const { repoPath } = keep(buildFNone());
    const before = repositoryState(repoPath, { except: [".lisa"] });

    write(repoPath, EVIDENCE, "{}\n");

    expect(
      repositoryState(repoPath, { except: [".lisa"] }).workingTree
    ).not.toBe(before.workingTree);
  });
});

describe("how a path stands in a repository", () => {
  it("tells a missing file, a new one, a changed one and an untouched one apart, without touching the index", () => {
    const { repoPath } = keep(buildFNone());
    write(repoPath, EVIDENCE, "{}\n");
    write(repoPath, "ruff.toml", "# changed\n");
    const before = repositoryState(repoPath);

    const standings = pathStandings(repoPath, [
      ".lisa/controls/verdict.json",
      EVIDENCE,
      "ruff.toml",
      "pyproject.toml",
    ]);

    expect(standings).toEqual({
      ".lisa/controls/verdict.json": "missing",
      [EVIDENCE]: "untracked",
      "ruff.toml": "modified",
      "pyproject.toml": "unchanged",
    });
    expect(repositoryState(repoPath)).toEqual(before);
  });
});
