/**
 * Binding a work item commits a pending Lisa auto-update FIRST, as its own
 * commit carrying that item (CodySwannGT/lisa#4337).
 *
 * Driven against a real temporary git repository, because the property is
 * about what git ends up holding: one update commit with the trailer, nothing
 * else swept into it, and no commit at all on a deploy branch.
 * @module tests/unit/scripts/lisa-work-item-pending-update
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { commitPendingLisaUpdate } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** The work item being bound. */
const REF = "o/r#7";
/** Version the pending update moves to. */
const TO = "4.68.0";
/** The manifest the update changes. */
const PKG = "package.json";
/** `git log` arguments printing the last commit's subject. */
const LAST_SUBJECT = ["log", "-1", "--format=%s"];
/** `git show` arguments listing the files the last commit touched. */
const HEAD_FILES = ["show", "--name-only", "--format=", "HEAD"];
/** Subject of the first fixture commit. */
const INITIAL = "init";
/** An unrelated feature edit sitting beside the pending update. */
const FEATURE_FILE = "feature.ts";

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
  return boundedExecFileSync({
    label: `git ${args[0] ?? ""}`,
    command: "git",
    args,
    cwd,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();
}

/**
 * The identity the auto-update records for a working-tree file: its git mode
 * and blob id.
 * @param root - Repository
 * @param file - Repo-relative path
 * @returns `"<mode> <blob>"`
 */
function blobOf(root: string, file: string): string {
  const mode =
    statSync(path.join(root, file)).mode & 0o111 ? "100755" : "100644";
  return `${mode} ${git(root, ["hash-object", "--", file])}`;
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
  // Repository-local identity: the commit under test runs with the real
  // environment, and CI runners carry no global git identity.
  git(root, ["config", "user.name", "t"]);
  git(root, ["config", "user.email", "t@example.com"]);
  writeFileSync(path.join(root, PKG), "{}\n");
  writeFileSync(path.join(root, FEATURE_FILE), "export {};\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "--quiet", "-m", INITIAL]);
  if (branch !== "main") git(root, ["checkout", "--quiet", "-b", branch]);
  writeFileSync(path.join(root, PKG), '{"v":1}\n');
  writeFileSync(path.join(root, FEATURE_FILE), "export const x = 1;\n");
  mkdirSync(path.join(root, ".git", "lisa"), { recursive: true });
  writeMarker(root, { [PKG]: blobOf(root, PKG) });
  return root;
}

/**
 * Write the pending marker for package.json.
 * @param root - Repository root
 * @param digests - Recorded digests, or undefined for a legacy marker
 */
function writeMarker(
  root: string,
  digests: Record<string, string | null> | undefined
): void {
  writeFileSync(
    markerFile(root),
    JSON.stringify({
      from: "4.66.5",
      to: TO,
      files: [PKG],
      ...(digests ? { digests } : {}),
    })
  );
}

/**
 * Run the commit, capturing what it printed to stderr.
 * @param root - Repository root
 * @returns The stderr text
 */
function commitCapturingErrors(root: string): string {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    lines.push(args.map(String).join(" "));
  };
  try {
    commitPendingLisaUpdate(REF, CONTRACT, root);
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

/** A contract whose only deploy branch is main. */
const CONTRACT = { deployBranches: new Map([["main", "production"]]) };

describe("lisa-work-item: a pending Lisa update is committed first", () => {
  it("keeps a feature edit the user already staged out of the update commit", () => {
    const root = repoWithPendingUpdate("feat/x");
    git(root, ["add", FEATURE_FILE]);
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, HEAD_FILES)).toBe(PKG);
    // Still staged, still the user's, still uncommitted.
    expect(git(root, ["diff", "--cached", "--name-only"])).toBe(FEATURE_FILE);
  });

  it("commits only the update's files, with the bound item's trailer", () => {
    const root = repoWithPendingUpdate("feat/x");
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, LAST_SUBJECT)).toBe(`chore(deps): update Lisa to ${TO}`);
    expect(git(root, ["log", "-1", "--format=%B"])).toContain(
      `Work-Item: ${REF}`
    );
    expect(git(root, HEAD_FILES)).toBe(PKG);
    // The feature edit stays out of the update commit.
    expect(git(root, ["status", "--porcelain"])).toBe("M feature.ts");
    expect(existsSync(markerFile(root))).toBe(false);
  });

  it("never commits on a deploy branch", () => {
    const root = repoWithPendingUpdate("main");
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, LAST_SUBJECT)).toBe(INITIAL);
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

  it("does not sweep an edit made after the update into the update commit", () => {
    const root = repoWithPendingUpdate("feat/x");
    writeFileSync(path.join(root, PKG), '{"v":1,"mine":true}\n');
    const errors = commitCapturingErrors(root);
    expect(git(root, LAST_SUBJECT)).toBe(INITIAL);
    expect(existsSync(markerFile(root))).toBe(true);
    expect(errors).toContain(PKG);
    expect(errors).toContain("NOT committed automatically");
    expect(readFileSync(path.join(root, PKG), "utf8")).toBe(
      '{"v":1,"mine":true}\n'
    );
  });

  it("leaves an executable-bit change alone for a human", () => {
    const root = repoWithPendingUpdate("feat/x");
    chmodSync(path.join(root, PKG), 0o755);
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, LAST_SUBJECT)).not.toBe(
      `chore(deps): update Lisa to ${TO}`
    );
    expect(existsSync(markerFile(root))).toBe(true);
  });

  it("leaves a symlink retargeted at identical bytes alone for a human", () => {
    const root = repoWithPendingUpdate("feat/x");
    writeFileSync(path.join(root, "a.txt"), "same\n");
    writeFileSync(path.join(root, "b.txt"), "same\n");
    symlinkSync("a.txt", path.join(root, "link.txt"));
    writeFileSync(
      markerFile(root),
      JSON.stringify({
        from: "4.66.5",
        to: TO,
        files: ["link.txt"],
        digests: { "link.txt": "120000 link:a.txt" },
      })
    );
    rmSync(path.join(root, "link.txt"));
    symlinkSync("b.txt", path.join(root, "link.txt"));
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, LAST_SUBJECT)).not.toBe(
      `chore(deps): update Lisa to ${TO}`
    );
    expect(existsSync(markerFile(root))).toBe(true);
  });

  it("leaves a legacy marker without digests for a human", () => {
    const root = repoWithPendingUpdate("feat/x");
    writeMarker(root, undefined);
    const errors = commitCapturingErrors(root);
    expect(git(root, LAST_SUBJECT)).toBe(INITIAL);
    expect(existsSync(markerFile(root))).toBe(true);
    expect(errors).toContain("cannot be proved unchanged");
  });

  it("restores what the user had staged when the commit fails", () => {
    const root = repoWithPendingUpdate("feat/x");
    // The user staged an earlier version of package.json before binding.
    writeFileSync(path.join(root, PKG), '{"v":0}\n');
    git(root, ["add", PKG]);
    const staged = git(root, ["rev-parse", `:${PKG}`]);
    writeFileSync(path.join(root, PKG), '{"v":1}\n');
    // A pending file that was never in the index.
    const fresh = "fresh.json";
    writeFileSync(path.join(root, fresh), "{}\n");
    writeFileSync(
      markerFile(root),
      JSON.stringify({
        from: "4.66.5",
        to: TO,
        files: [PKG, fresh],
        digests: {
          [PKG]: blobOf(root, PKG),
          [fresh]: blobOf(root, fresh),
        },
      })
    );
    const hook = path.join(root, ".git", "hooks", "pre-commit");
    mkdirSync(path.dirname(hook), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    // Repository-local, so a global hooksPath on the runner cannot bypass it.
    git(root, [
      "config",
      "core.hooksPath",
      hook.slice(0, -"/pre-commit".length),
    ]);
    const errors = commitCapturingErrors(root);
    expect(errors).toContain("could not be committed");
    expect(errors).not.toContain("also failed");
    expect(git(root, LAST_SUBJECT)).toBe(INITIAL);
    expect(git(root, ["rev-parse", `:${PKG}`])).toBe(staged);
    expect(git(root, ["ls-files", "--", fresh])).toBe("");
  });

  it("does nothing when no update is pending", () => {
    const root = repoWithPendingUpdate("feat/x");
    commitPendingLisaUpdate(REF, CONTRACT, root);
    const head = git(root, ["rev-parse", "HEAD"]);
    commitPendingLisaUpdate(REF, CONTRACT, root);
    expect(git(root, ["rev-parse", "HEAD"])).toBe(head);
  });
});
