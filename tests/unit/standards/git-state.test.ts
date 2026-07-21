import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeGitRemoteIdentity,
  readStandardsGitState,
} from "../../../src/standards/git-state.js";

let root: string | undefined;
const GIT = "/usr/bin/git";
const README = "README.md";
const NORMALIZED_IDENTITY = "github.com/acme/project";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/**
 * Create one committed repository with optional normalized origin.
 * @param withOrigin - Whether the fixture should configure origin
 * @returns Temporary repository root
 */
async function repository(withOrigin = true): Promise<string> {
  root = await mkdtemp(path.join(tmpdir(), "lisa-standards-git-"));
  git(["init", "-q"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.com"]);
  if (withOrigin) {
    git(["remote", "add", "origin", "git@GitHub.com:Acme/Project.git"]);
  }
  await writeFile(
    path.join(root, ".gitignore"),
    ".lisa/standards/latest.json\n"
  );
  await writeFile(path.join(root, README), "fixture\n");
  git(["add", "."]);
  git(["commit", "-qm", "initial"]);
  return root;
}

/**
 * Run fixed-system Git inside the current fixture.
 * @param args - Fixed Git arguments
 * @returns Trimmed stdout
 */
function git(args: readonly string[]): string {
  return execFileSync(GIT, args, { cwd: root, encoding: "utf8" }).trim();
}

describe("standards Git state", () => {
  it.each([
    ["git@GitHub.com:Acme/Project.git", NORMALIZED_IDENTITY],
    ["ssh://git@github.com:22/Acme/Project.git", NORMALIZED_IDENTITY],
    ["https://github.com:443/Acme/Project.git", NORMALIZED_IDENTITY],
    [
      "ssh://git@example.com:2222/Acme/Project",
      "example.com:2222/acme/project",
    ],
  ])("normalizes %s", (remote, expected) => {
    expect(normalizeGitRemoteIdentity(remote)).toBe(expected);
  });

  it("includes staged and nonignored untracked state but excludes the proof", async () => {
    const repo = await repository();
    expect((await readStandardsGitState(repo)).clean).toBe(true);
    await mkdir(path.join(repo, ".lisa/standards"), { recursive: true });
    await writeFile(path.join(repo, ".lisa/standards/latest.json"), "{}\n");
    expect((await readStandardsGitState(repo)).clean).toBe(true);
    await writeFile(path.join(repo, "untracked.txt"), "dirty\n");
    expect((await readStandardsGitState(repo)).clean).toBe(false);
    await rm(path.join(repo, "untracked.txt"));
    await writeFile(path.join(repo, README), "changed\n");
    git(["add", README]);
    expect((await readStandardsGitState(repo)).clean).toBe(false);
  });

  it("rejects a missing or ambiguous origin", async () => {
    const repo = await repository(false);
    await expect(readStandardsGitState(repo)).rejects.toThrow(
      "origin is missing"
    );
    git([
      "config",
      "--add",
      "remote.origin.url",
      "https://github.com/acme/one.git",
    ]);
    git([
      "config",
      "--add",
      "remote.origin.url",
      "https://github.com/acme/two.git",
    ]);
    await expect(readStandardsGitState(repo)).rejects.toThrow(
      "origin is ambiguous"
    );
  });
});
