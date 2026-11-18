/**
 * Reading the commit a repository is at, for the evidence records that name
 * it (CodySwannGT/lisa#4998).
 *
 * A folder that is not a git repository and a repository with no commit yet
 * both have no such commit. Neither is a reason to stop an attest run: the
 * record then says `null`.
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readHeadCommit } from "../../../src/controls/head-commit.js";
import {
  buildFNone,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const folders: string[] = [];

/**
 * Make an empty temporary folder that is removed after the case.
 * @returns Its real path
 */
function emptyFolder(): string {
  const folder = realpathSync(
    mkdtempSync(path.join(tmpdir(), "lisa-head-commit-"))
  );
  folders.push(folder);
  return folder;
}

afterEach(() => {
  removeFixtures();
  folders.splice(0).forEach(folder => {
    rmSync(folder, { force: true, recursive: true });
  });
});

describe("the commit a repository is at", () => {
  it("is the full hash of HEAD", async () => {
    const { repoPath } = keep(buildFNone());

    expect(await readHeadCommit(repoPath)).toBe(
      runControlAuditGit(repoPath, ["rev-parse", "HEAD"])
    );
    expect(await readHeadCommit(repoPath)).toMatch(/^[0-9a-f]{40}$/u);
  });

  it("is nothing in a folder that is not a git repository", async () => {
    expect(await readHeadCommit(emptyFolder())).toBeNull();
  });

  it("is nothing in a repository with no commit yet", async () => {
    const folder = emptyFolder();
    runControlAuditGit(folder, ["init", "--quiet"]);

    expect(await readHeadCommit(folder)).toBeNull();
  });

  it("is not read from a repository the folder happens to sit inside", async () => {
    const { repoPath } = keep(buildFNone());

    expect(await readHeadCommit(path.join(repoPath, "src"))).toBeNull();
  });
});
