/**
 * Binding a work item commits a pending Lisa auto-update FIRST, as its own
 * commit carrying that item (CodySwannGT/lisa#4337).
 *
 * Driven against a real temporary git repository, because the property is
 * about what git ends up holding: one update commit with the trailer, nothing
 * else swept into it, and no commit at all on a deploy branch.
 * @module tests/unit/scripts/lisa-work-item-pending-update
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { commitPendingLisaUpdate } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

/** The work item being bound. */
const REF = "o/r#7";
/** Version the pending update moves to. */
const TO = "4.68.0";
/** The manifest the update changes. */
const PKG = "package.json";
/** `git log` arguments printing the last commit's subject. */
const LAST_SUBJECT = ["log", "-1", "--format=%s"];

/**
 * The pending-update marker inside a fixture repository.
 * @param root - Repository root
 * @returns Absolute marker path
 */
function markerFile(root: string): string {
  return path.join(root, ".git", "lisa", "pending-update.json");
}

/**
 * Run git in a repository with hooks and global config isolated.
 * @param cwd - Repository
 * @param args - git arguments
 * @returns Trimmed stdout
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();
}

/**
 * A repository on `branch` with a pending update to package.json and an
 * unrelated feature edit alongside it.
 * @param branch - Branch to sit on
 * @returns Repository root
 */
function repoWithPendingUpdate(branch: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-pending-update-"));
  git(root, ["init", "--quiet", "--initial-branch", "main"]);
  writeFileSync(path.join(root, PKG), "{}\n");
  writeFileSync(path.join(root, "feature.ts"), "export {};\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", "init"]);
  if (branch !== "main") git(root, ["checkout", "--quiet", "-b", branch]);
  writeFileSync(path.join(root, PKG), '{"v":1}\n');
  writeFileSync(path.join(root, "feature.ts"), "export const x = 1;\n");
  mkdirSync(path.join(root, ".git", "lisa"), { recursive: true });
  writeFileSync(
    markerFile(root),
    JSON.stringify({ from: "4.66.5", to: TO, files: [PKG] })
  );
  return root;
}

/** A contract whose only deploy branch is main. */
const CONTRACT = { deployBranches: new Map([["main", "production"]]) };

describe("lisa-work-item: a pending Lisa update is committed first", () => {
  it("commits only the update's files, with the bound item's trailer", () => {
    const root = repoWithPendingUpdate("feat/x");
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, LAST_SUBJECT)).toBe(`chore(deps): update Lisa to ${TO}`);
    expect(git(root, ["log", "-1", "--format=%B"])).toContain(
      `Work-Item: ${REF}`
    );
    expect(git(root, ["show", "--name-only", "--format=", "HEAD"])).toBe(PKG);
    // The feature edit stays out of the update commit.
    expect(git(root, ["status", "--porcelain"])).toBe("M feature.ts");
    expect(existsSync(markerFile(root))).toBe(false);
  });

  it("never commits on a deploy branch", () => {
    const root = repoWithPendingUpdate("main");
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, LAST_SUBJECT)).toBe("init");
    expect(existsSync(markerFile(root))).toBe(true);
  });

  it("drops a marker whose files were already committed", () => {
    const root = repoWithPendingUpdate("feat/x");
    git(root, ["add", PKG]);
    git(root, ["commit", "--quiet", "-m", "by hand"]);
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, LAST_SUBJECT)).toBe("by hand");
    expect(existsSync(markerFile(root))).toBe(false);
  });

  it("does nothing when no update is pending", () => {
    const root = repoWithPendingUpdate("feat/x");
    commitPendingLisaUpdate(REF, CONTRACT, root);
    const head = git(root, ["rev-parse", "HEAD"]);
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, ["rev-parse", "HEAD"])).toBe(head);
  });
});
