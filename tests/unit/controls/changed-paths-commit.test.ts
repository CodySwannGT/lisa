/**
 * What a commit changes, as the gate runner reads it (CodySwannGT/lisa#4988).
 *
 * At commit the change is what is staged. The runner narrows the parts it
 * runs to that list, so the list has to be exactly what git will commit —
 * and whenever it cannot be read with certainty, the answer has to be "not
 * known", which runs every part.
 * @module tests/unit/controls/changed-paths-commit
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { changeAt } from "../../../all/copy-overwrite/scripts/lib/changed-paths.mjs";
import {
  buildFMixed,
  type ControlAuditFixture,
  controlAuditGitEnv,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import {
  type Change,
  changeIn,
  stage,
  stageDeletion,
  writeIn,
} from "../../support/part-scope-change.js";

const COMMIT = "commit";
const API_FILE = "api/src/fixture_mixed_api/new_module.py";
const WEB_FILE = "web/src/new.ts";
const WEB_INDEX = "web/src/index.ts";
const UNUSUAL_FILE = "café menu/today's specials.md";
const EVERY_PART = "Every part runs at commit";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-mixed and remove it when the case ends.
 * @returns The repository
 */
function mixed(): ControlAuditFixture {
  const fixture = buildFMixed();
  cleanups.push(fixture.cleanup);
  return fixture;
}

/**
 * A folder that is not a repository, removed when the case ends.
 * @returns The folder
 */
function plainFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-no-git-"));
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  return folder;
}

describe("the paths a commit changes", () => {
  it("is the staged files, written from the repository root", () => {
    const { repoPath } = mixed();
    stage(repoPath, [API_FILE]);

    const change = changeIn(repoPath, COMMIT);

    expect(change.paths).toEqual([API_FILE]);
    expect(change.note).toContain("1 path");
  });

  it("leaves out a file that was changed and not staged", () => {
    const { repoPath } = mixed();
    stage(repoPath, [API_FILE]);
    writeIn(repoPath, WEB_INDEX, "export const changed = true;\n");

    expect(changeIn(repoPath, COMMIT).paths).toEqual([API_FILE]);
  });

  it("counts both the old and the new path of a rename", () => {
    const { repoPath } = mixed();
    runControlAuditGit(repoPath, ["mv", WEB_INDEX, "api/moved.ts"]);

    expect(changeIn(repoPath, COMMIT).paths).toEqual([
      "api/moved.ts",
      WEB_INDEX,
    ]);
  });

  it("counts a deleted file", () => {
    const { repoPath } = mixed();
    stageDeletion(repoPath, WEB_INDEX);

    expect(changeIn(repoPath, COMMIT).paths).toEqual([WEB_INDEX]);
  });

  it("reports a name with a space, a quote and a non-ASCII letter as it is", () => {
    const { repoPath } = mixed();
    stage(repoPath, [UNUSUAL_FILE]);

    expect(changeIn(repoPath, COMMIT).paths).toEqual([UNUSUAL_FILE]);
  });

  it("reads the staged files of a repository that has no commit yet", () => {
    const folder = plainFolder();
    runControlAuditGit(folder, ["init", "--quiet"]);
    stage(folder, ["api/first.py"]);

    expect(changeIn(folder, COMMIT).paths).toEqual(["api/first.py"]);
  });

  it("reads the index git names for this commit, as `git commit -a` does", () => {
    const { repoPath } = mixed();
    stage(repoPath, [API_FILE]);
    const index = path.join(repoPath, ".git", "next-index-1.lock");
    runControlAuditGit(repoPath, [
      "read-tree",
      `--index-output=${index}`,
      "HEAD",
    ]);

    // That index holds the last commit and nothing else, so the commit git is
    // about to make changes nothing — whatever the ordinary index says.
    const change = changeIn(repoPath, COMMIT, {
      env: { GIT_INDEX_FILE: index },
    });

    expect(change.paths).toBeNull();
    expect(change.note).toContain("nothing is staged");
    expect(changeIn(repoPath, COMMIT).paths).toEqual([API_FILE]);
  });

  it("reads the staged files of a linked worktree", () => {
    const { repoPath } = mixed();
    const linked = path.join(plainFolder(), "linked");
    runControlAuditGit(repoPath, [
      "worktree",
      "add",
      "--quiet",
      "-b",
      "other",
      linked,
    ]);
    stage(linked, [API_FILE]);

    expect(changeIn(linked, COMMIT).paths).toEqual([API_FILE]);
  });
});

describe("a commit whose changed paths are not known", () => {
  /**
   * Assert that a change is "not known", for a stated reason.
   * @param change - What the runner knows
   * @param reason - Words the operator must be given
   */
  function expectEveryPart(change: Change, reason: string): void {
    expect(change.paths).toBeNull();
    expect(change.note).toContain(EVERY_PART);
    expect(change.note).toContain(reason);
  }

  it("is every part when nothing is staged", () => {
    const { repoPath } = mixed();

    expectEveryPart(changeIn(repoPath, COMMIT), "nothing is staged");
  });

  it("is every part in a folder that is not a git repository", () => {
    expectEveryPart(
      changeIn(plainFolder(), COMMIT),
      "not the top of a git repository"
    );
  });

  it("is every part when started from a folder inside the repository", () => {
    const { repoPath } = mixed();
    stage(repoPath, [API_FILE]);

    expectEveryPart(
      changeIn(path.join(repoPath, "api"), COMMIT),
      "not the top of a git repository"
    );
  });

  it("is every part when git is pointed at another repository", () => {
    const { repoPath } = mixed();
    const other = mixed();
    stage(other.repoPath, [WEB_FILE]);

    expectEveryPart(
      changeIn(repoPath, COMMIT, {
        env: { GIT_DIR: path.join(other.repoPath, ".git") },
      }),
      "a different repository"
    );
  });

  it("is every part when git is handed another repository's index", () => {
    const { repoPath } = mixed();
    const other = mixed();
    stage(other.repoPath, [WEB_FILE]);

    expectEveryPart(
      changeIn(repoPath, COMMIT, {
        env: { GIT_INDEX_FILE: path.join(other.repoPath, ".git", "index") },
      }),
      "a different repository"
    );
  });

  it("is every part when git does not answer", () => {
    const { repoPath } = mixed();
    stage(repoPath, [API_FILE]);

    const change = changeAt({
      env: controlAuditGitEnv(),
      git: () => null,
      moment: COMMIT,
      root: repoPath,
    }) as Change;

    expectEveryPart(change, "git could not be asked");
  });

  it("is every part when the change edits the declaration itself", () => {
    const { repoPath } = mixed();
    stage(repoPath, [API_FILE, ".lisa.config.json"]);

    expectEveryPart(changeIn(repoPath, COMMIT), ".lisa.config.json");
  });
});

describe("a moment the runner does not narrow", () => {
  it.each(["pull-request", "post-tool", "pre-deploy:production", "continuous"])(
    "runs every part at %s and says nothing extra",
    moment => {
      const { repoPath } = mixed();
      stage(repoPath, [API_FILE]);

      expect(changeIn(repoPath, moment)).toEqual({ note: null, paths: null });
    }
  );
});
