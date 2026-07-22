import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeGitRemoteIdentity,
  readStandardsGitState,
  requireStandardsBaseCommit,
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

  // Test hardened to kill mutant M001 (Risk Factor: Reliability / diagnostic accuracy).
  it("preserves the parent-commit error for a true root commit", async () => {
    const repo = await repository();
    await expect(requireStandardsBaseCommit(repo)).rejects.toThrow(
      "Standards proof requires a parent commit for threshold comparison."
    );
  });

  // Test hardened to kill mutant M002 (Risk Factor: Correctness / threshold base selection).
  it("returns the parent commit when complete history is available", async () => {
    const repo = await repository();
    const parent = git(["rev-parse", "HEAD"]);
    await writeFile(path.join(repo, README), "second commit\n");
    git(["add", README]);
    git(["commit", "-qm", "second"]);
    await expect(requireStandardsBaseCommit(repo)).resolves.toBe(parent);
  });

  // Test hardened to kill mutant M003 (Risk Factor: Reliability / CI checkout recovery).
  it("gives fetch-depth guidance when the parent is hidden by a shallow clone", async () => {
    const source = await repository();
    await writeFile(path.join(source, README), "second commit\n");
    git(["add", README]);
    git(["commit", "-qm", "second"]);
    const shallow = `${source}-shallow`;
    try {
      execFileSync(
        GIT,
        ["clone", "-q", "--depth", "1", `file://${source}`, shallow],
        { encoding: "utf8" }
      );
      root = shallow;
      await expect(requireStandardsBaseCommit(shallow)).rejects.toThrow(
        "Run `git fetch --deepen=1` and retry."
      );
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(shallow, { recursive: true, force: true });
      root = undefined;
    }
  });
});
